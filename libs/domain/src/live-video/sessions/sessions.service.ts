import { randomUUID } from 'node:crypto';

import {
  LIVE_PROVIDER_TIMEOUT_MS,
  LIVE_PUBLISH_CONSTRAINTS,
  LIVE_PUBLISH_WINDOW_MS,
  LIVE_VIEW_TOKEN_TTL_MS,
  type LiveRefusal,
  type LiveSessionStartedDto,
  type LiveViewCredentialDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { countLiveSession, countViewToken } from './sessions.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import { featureOn } from '../../garages/features/feature-on';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import type { JobStatus } from '../../generated/prisma/enums';
import { said } from '../../quotes/refusals';
import {
  LIVE_VIDEO_PROVIDER,
  type LiveInput,
  type LiveVideoProvider,
} from '../providers/live-video.provider';

type Tx = Prisma.TransactionClient;
type Words = Parameters<typeof said>[0];

interface LockedJob {
  id: string;
  garage_id: string;
  driver_id: string;
  mechanic_id: string | null;
  mechanic_account: string | null;
  status: JobStatus;
}

const UNAVAILABLE: Words = {
  en: 'Live is not available now. You can send photos and clips.',
  ro: 'Transmisia live nu e disponibilă acum. Poți trimite fotografii și clipuri.',
};
const JOB_CLOSED: Words = {
  en: 'The job is closed',
  ro: 'Lucrarea este închisă',
};
const LIVE_ENDED: Words = {
  en: 'The live stream has ended',
  ro: 'Transmisia live s-a încheiat',
};
const alreadyLive = (name: string | undefined): Words =>
  name
    ? { en: `${name} is already live`, ro: `${name} transmite deja` }
    : { en: 'Someone is already live', ro: 'Cineva transmite deja' };

const FEATURE = 'live_media';

// A job's live stream: the owner or the job's mechanic starts it; they and
// the job's driver watch it. Anyone else, and any garage with live media
// off, finds nothing there.
@Injectable()
export class LiveSessionsService {
  private readonly logger = new Logger('LiveSessions');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    @Inject(LIVE_VIDEO_PROVIDER) private readonly provider: LiveVideoProvider,
  ) {}

  async start(actor: Actor, jobId: string): Promise<LiveSessionStartedDto> {
    const id = randomUUID();
    await this.refusing(jobId, () =>
      this.prisma.$transaction((tx) => this.judge(tx, actor, jobId)),
    );
    const input = await this.openInput(actor, id, jobId);
    const startedAt = await this.refusing(jobId, () =>
      this.prisma
        .$transaction(async (tx) => {
          const job = await this.judge(tx, actor, jobId);
          const row = await tx.liveSession.create({
            data: {
              garageId: job.garage_id,
              id,
              jobId,
              provider:
                this.provider.name === 'cloudflare' ? 'cloudflare' : 'fake',
              providerInputId: input.inputId,
              startedBy: actor.accountId,
            },
          });
          await this.audit.record(tx, {
            action: 'create',
            actorId: actor.accountId,
            actorRole: actor.role,
            garageId: job.garage_id,
            jobId,
            newValue: 'live',
            subjectId: id,
            subjectType: 'live_session',
          });
          await this.events.record(tx, {
            audience: {
              driverAccountId: job.driver_id,
              garageId: job.garage_id,
              mechanicId: job.mechanic_id,
              type: 'job',
            },
            kind: 'live.started',
            payload: { jobId, liveSessionId: id },
            subjectId: jobId,
          });
          return row.startedAt;
        })
        .catch(async (error: unknown) => {
          await this.close(input.inputId);
          throw isUniqueClash(error)
            ? await this.alreadyOn(this.prisma, actor, jobId)
            : error;
        }),
    );
    countLiveSession('started');
    return {
      liveSessionId: id,
      publish: {
        constraints: LIVE_PUBLISH_CONSTRAINTS,
        expiresAt: new Date(
          startedAt.getTime() + LIVE_PUBLISH_WINDOW_MS,
        ).toISOString(),
        url: input.publishUrl,
      },
      startedAt: startedAt.toISOString(),
    };
  }

  async view(
    actor: Actor,
    liveSessionId: string,
  ): Promise<LiveViewCredentialDto> {
    const [session] = await this.prisma.$queryRaw<
      (LockedJob & { provider_input_id: string; stopped: boolean })[]
    >`
      SELECT j.id, j.garage_id, j.driver_id, j.mechanic_id,
             m.account_id AS mechanic_account, j.status,
             s.provider_input_id, s.stopped_at IS NOT NULL AS stopped
      FROM live_session s
      JOIN job j ON j.id = s.job_id
      LEFT JOIN mechanic m ON m.id = j.mechanic_id
      WHERE s.id = ${liveSessionId}::uuid`;
    if (
      !session ||
      !(await featureOn(this.prisma, session.garage_id, FEATURE)) ||
      !(mayStart(actor, session) || isDriver(actor, session))
    ) {
      countViewToken('refused');
      this.logger.warn(`live view refused: not_found session ${liveSessionId}`);
      throw new NotFoundException();
    }
    if (session.stopped) {
      countViewToken('ended');
      throw refused(HttpStatus.CONFLICT, 'live_ended', LIVE_ENDED, actor);
    }
    const expiresAt = new Date(Date.now() + LIVE_VIEW_TOKEN_TTL_MS);
    let url: string;
    try {
      url = this.provider.viewUrl(session.provider_input_id, expiresAt);
    } catch (error) {
      countViewToken('unavailable');
      this.logger.warn(
        `live view refused: live_unavailable ${error instanceof Error ? error.name : 'error'} session ${liveSessionId}`,
      );
      throw refused(
        HttpStatus.SERVICE_UNAVAILABLE,
        'live_unavailable',
        UNAVAILABLE,
        actor,
      );
    }
    countViewToken('issued');
    return { expiresAt: expiresAt.toISOString(), url };
  }

  // Locks the job so starts on it run one after the other, and says why the
  // caller may not start one now.
  private async judge(tx: Tx, actor: Actor, jobId: string): Promise<LockedJob> {
    const [job] = await tx.$queryRaw<LockedJob[]>`
      SELECT j.id, j.garage_id, j.driver_id, j.mechanic_id,
             m.account_id AS mechanic_account, j.status
      FROM job j LEFT JOIN mechanic m ON m.id = j.mechanic_id
      WHERE j.id = ${jobId}::uuid
      FOR UPDATE OF j`;
    if (!job || job.garage_id !== actor.garageId) throw new NotFoundException();
    // Holds off the live media switch, which locks the garage before it stops
    // the garage's sessions, until this start is committed and can be seen.
    await tx.$queryRaw`SELECT id FROM garage WHERE id = ${job.garage_id}::uuid FOR KEY SHARE`;
    if (!(await featureOn(tx, job.garage_id, FEATURE)) || !mayStart(actor, job))
      throw new NotFoundException();
    if (job.status === 'done' || job.status === 'cancelled')
      throw refused(HttpStatus.CONFLICT, 'job_closed', JOB_CLOSED, actor);
    const clash = await this.alreadyOn(tx, actor, jobId);
    if (clash) throw clash;
    return job;
  }

  // A provider that has not answered in time is a refusal; an input it opens
  // later is closed again.
  private async openInput(actor: Actor, id: string, jobId: string) {
    const pending: Promise<LiveInput> = this.provider
      .createInput({ id })
      .catch((error: unknown) => ({
        unavailable: error instanceof Error ? error.name : 'error',
      }));
    const timedOut = { unavailable: 'timeout' };
    let timer: NodeJS.Timeout | undefined;
    const input = await Promise.race([
      pending,
      new Promise<LiveInput>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), LIVE_PROVIDER_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (input === timedOut)
      void pending.then(async (late) => {
        if ('inputId' in late) await this.close(late.inputId);
      });
    if (!('unavailable' in input)) return input;
    countLiveSession(
      input.unavailable === 'not_configured'
        ? 'unavailable'
        : 'provider_failed',
    );
    this.logger.warn(
      `live start refused: live_unavailable ${input.unavailable} job ${jobId}`,
    );
    throw refused(
      HttpStatus.SERVICE_UNAVAILABLE,
      'live_unavailable',
      UNAVAILABLE,
      actor,
    );
  }

  // The refusal when someone is live on the job already, naming them.
  private async alreadyOn(
    db: Pick<Tx, 'liveSession'>,
    actor: Actor,
    jobId: string,
  ) {
    const live = await db.liveSession.findFirst({
      select: { starter: { select: { name: true } } },
      where: { jobId, stoppedAt: null },
    });
    return (
      live &&
      refused(
        HttpStatus.CONFLICT,
        'live_already_on',
        alreadyLive(live.starter?.name?.trim()),
        actor,
      )
    );
  }

  // Counts and logs a refused start by its code and the job's id alone.
  private async refusing<T>(jobId: string, run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      countLiveSession('refused');
      const code =
        error instanceof NotFoundException
          ? 'not_found'
          : error instanceof HttpException
            ? ((error.getResponse() as { code?: string }).code ?? 'error')
            : 'error';
      this.logger.warn(`live start refused: ${code} job ${jobId}`);
      throw error;
    }
  }

  private async close(inputId: string) {
    await this.provider.closeInput(inputId).catch((error: unknown) => {
      this.logger.warn(
        `live input not closed: ${inputId} ${error instanceof Error ? error.name : 'error'}`,
      );
    });
  }
}

const isUniqueClash = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const mayStart = (actor: Actor, job: LockedJob) =>
  job.garage_id === actor.garageId &&
  (actor.role === 'garage' ||
    (actor.role === 'mechanic' && job.mechanic_account === actor.accountId));

const isDriver = (actor: Actor, job: LockedJob) =>
  actor.role === 'driver' && job.driver_id === actor.accountId;

const refused = (
  status: HttpStatus,
  code: LiveRefusal,
  words: Words,
  actor: Actor,
) => refusal(status, code, said(words, actor));

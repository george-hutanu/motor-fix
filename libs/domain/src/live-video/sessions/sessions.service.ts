import { randomUUID } from 'node:crypto';

import {
  LIVE_PROVIDER_TIMEOUT_MS,
  LIVE_PUBLISH_CONSTRAINTS,
  LIVE_PUBLISH_WINDOW_MS,
  LIVE_VIEW_TOKEN_TTL_MS,
  type LiveRecordingKeepDto,
  type LiveRefusal,
  type LiveSessionStartedDto,
  type LiveSessionStoppedDto,
  type LiveStopRequestDto,
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

import {
  countLiveRecording,
  countLiveSession,
  countViewToken,
} from './sessions.metrics';
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
import { stopLiveSessions } from '../stop-sessions';

type Tx = Prisma.TransactionClient;

interface LockedSession extends LockedJob {
  session_id: string;
  provider_input_id: string;
  keep_recording: boolean;
  stopped: boolean;
}
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

  // One transaction: the caller's viewer row, the driver's first view and
  // the peak move with the credential, or not at all. The session row alone
  // is locked, so concurrent viewers count one after another.
  async view(
    actor: Actor,
    liveSessionId: string,
  ): Promise<LiveViewCredentialDto> {
    const credential = await this.prisma.$transaction(async (tx) => {
      const [session] = await tx.$queryRaw<
        (LockedJob & { provider_input_id: string; stopped: boolean })[]
      >`
        SELECT j.id, j.garage_id, j.driver_id, j.mechanic_id,
               m.account_id AS mechanic_account, j.status,
               s.provider_input_id, s.stopped_at IS NOT NULL AS stopped
        FROM live_session s
        JOIN job j ON j.id = s.job_id
        LEFT JOIN mechanic m ON m.id = j.mechanic_id
        WHERE s.id = ${liveSessionId}::uuid
        FOR UPDATE OF s`;
      if (
        !session ||
        !(await featureOn(tx, session.garage_id, FEATURE)) ||
        !(mayStart(actor, session) || isDriver(actor, session))
      ) {
        countViewToken('refused');
        this.logger.warn(
          `live view refused: not_found session ${liveSessionId}`,
        );
        throw new NotFoundException();
      }
      if (session.stopped) {
        countViewToken('ended');
        throw refused(HttpStatus.CONFLICT, 'live_ended', LIVE_ENDED, actor);
      }
      const now = new Date();
      await this.watched(tx, actor, liveSessionId, now);
      const expiresAt = new Date(now.getTime() + LIVE_VIEW_TOKEN_TTL_MS);
      return {
        expiresAt,
        url: this.sign(
          actor,
          liveSessionId,
          session.provider_input_id,
          expiresAt,
        ),
      };
    });
    countViewToken('issued');
    return {
      expiresAt: credential.expiresAt.toISOString(),
      url: credential.url,
    };
  }

  // A provider that cannot sign answers 503 and rolls the view back.
  private sign(
    actor: Actor,
    liveSessionId: string,
    providerInputId: string,
    expiresAt: Date,
  ) {
    try {
      return this.provider.viewUrl(providerInputId, expiresAt);
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
  }

  // Records the caller as a viewer at `now`, the driver's first view, and
  // the peak: accounts whose last credential has not yet expired.
  private async watched(
    tx: Tx,
    actor: Actor,
    liveSessionId: string,
    now: Date,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO live_viewer
        (live_session_id, account_id, first_viewed_at, last_viewed_at)
      VALUES (${liveSessionId}::uuid, ${actor.accountId}::uuid, ${now}, ${now})
      ON CONFLICT (live_session_id, account_id)
      DO UPDATE SET last_viewed_at = EXCLUDED.last_viewed_at`;
    const since = new Date(now.getTime() - LIVE_VIEW_TOKEN_TTL_MS);
    await tx.$executeRaw`
      UPDATE live_session s SET
        viewed_by_driver_at = CASE WHEN ${actor.role === 'driver'}
          THEN COALESCE(s.viewed_by_driver_at, ${now})
          ELSE s.viewed_by_driver_at END,
        peak_viewers = GREATEST(s.peak_viewers, (
          SELECT count(*)::int FROM live_viewer v
          WHERE v.live_session_id = s.id AND v.last_viewed_at > ${since}))
      WHERE s.id = ${liveSessionId}::uuid`;
  }

  async setKeep(
    actor: Actor,
    liveSessionId: string,
    body: LiveRecordingKeepDto,
  ): Promise<LiveRecordingKeepDto> {
    await this.refusingOn('keep', liveSessionId, () =>
      this.prisma.$transaction(async (tx) => {
        const session = await this.lockLive(tx, actor, liveSessionId);
        await this.applyKeep(tx, actor, session, body.keep);
      }),
    );
    return { keep: body.keep };
  }

  // The stop is written in one transaction; a discarded recording is deleted
  // at the provider after the commit, and a delete that fails or hangs is
  // left to be retried later without changing the answer.
  async stop(
    actor: Actor,
    liveSessionId: string,
    body: LiveStopRequestDto,
  ): Promise<LiveSessionStoppedDto> {
    const stopped = await this.refusingOn('stop', liveSessionId, () =>
      this.prisma.$transaction(async (tx) => {
        const session = await this.lockLive(tx, actor, liveSessionId);
        if (body.keep !== undefined)
          await this.applyKeep(tx, actor, session, body.keep);
        const [row] = await stopLiveSessions(
          tx,
          this.audit,
          { sessionId: liveSessionId },
          'sender',
          actor,
        );
        if (!row) throw new Error(`live session ${liveSessionId} not stopped`);
        return row;
      }),
    );
    countLiveSession('stopped');
    if (!stopped.keep)
      await this.discard(liveSessionId, stopped.providerInputId);
    return {
      keep: stopped.keep,
      liveSessionId,
      peakViewers: stopped.peakViewers,
      recordingMediaId: stopped.recordingMediaId,
      seconds: stopped.seconds,
      stoppedAt: stopped.stoppedAt.toISOString(),
      viewedByDriverAt: stopped.viewedByDriverAt?.toISOString() ?? null,
    };
  }

  // Locks the session so a stop and a keep change on it run one after the
  // other; the second stop then finds it ended. The garage and the job are
  // taken first, in the order every live write takes them, so a stop never
  // deadlocks with a job close or the live media switch.
  private async lockLive(
    tx: Tx,
    actor: Actor,
    liveSessionId: string,
  ): Promise<LockedSession> {
    const [owner] = await tx.$queryRaw<{ job_id: string; garage_id: string }[]>`
      SELECT job_id, garage_id FROM live_session
      WHERE id = ${liveSessionId}::uuid`;
    if (!owner) throw new NotFoundException();
    await tx.$queryRaw`SELECT id FROM garage WHERE id = ${owner.garage_id}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM job WHERE id = ${owner.job_id}::uuid FOR KEY SHARE`;
    const [session] = await tx.$queryRaw<LockedSession[]>`
      SELECT j.id, j.garage_id, j.driver_id, j.mechanic_id,
             m.account_id AS mechanic_account, j.status,
             s.id AS session_id, s.provider_input_id, s.keep_recording,
             s.stopped_at IS NOT NULL AS stopped
      FROM live_session s
      JOIN job j ON j.id = s.job_id
      LEFT JOIN mechanic m ON m.id = j.mechanic_id
      WHERE s.id = ${liveSessionId}::uuid
      FOR UPDATE OF s`;
    if (
      !session ||
      !(await featureOn(tx, session.garage_id, FEATURE)) ||
      !mayStart(actor, session)
    )
      throw new NotFoundException();
    if (session.stopped)
      throw refused(HttpStatus.CONFLICT, 'live_ended', LIVE_ENDED, actor);
    return session;
  }

  private async applyKeep(
    tx: Tx,
    actor: Actor,
    session: LockedSession,
    keep: boolean,
  ) {
    if (session.keep_recording === keep) return;
    await tx.liveSession.update({
      data: { keepRecording: keep },
      where: { id: session.session_id },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'keep_recording',
      garageId: session.garage_id,
      jobId: session.id,
      newValue: keep,
      oldValue: session.keep_recording,
      subjectId: session.session_id,
      subjectType: 'live_session',
    });
  }

  private async discard(liveSessionId: string, inputId: string) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.provider.deleteRecording(inputId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout')),
            LIVE_PROVIDER_TIMEOUT_MS,
          );
        }),
      ]);
      countLiveRecording('discarded');
    } catch (error) {
      countLiveRecording('discard_failed');
      this.logger.warn(
        `live recording not discarded: session ${liveSessionId} input ${inputId} ${error instanceof Error ? error.name : 'error'}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Locks the job so starts on it run one after the other, and says why the
  // caller may not start one now.
  private async judge(tx: Tx, actor: Actor, jobId: string): Promise<LockedJob> {
    const [owner] = await tx.$queryRaw<{ garage_id: string }[]>`
      SELECT garage_id FROM job WHERE id = ${jobId}::uuid`;
    if (!owner || owner.garage_id !== actor.garageId)
      throw new NotFoundException();
    // Holds off the live media switch, which locks the garage before it stops
    // the garage's sessions, until this start is committed and can be seen;
    // taken before the job, the order the switch takes them in.
    await tx.$queryRaw`SELECT id FROM garage WHERE id = ${owner.garage_id}::uuid FOR SHARE`;
    const [job] = await tx.$queryRaw<LockedJob[]>`
      SELECT j.id, j.garage_id, j.driver_id, j.mechanic_id,
             m.account_id AS mechanic_account, j.status
      FROM job j LEFT JOIN mechanic m ON m.id = j.mechanic_id
      WHERE j.id = ${jobId}::uuid
      FOR UPDATE OF j`;
    if (!job) throw new NotFoundException();
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
      this.logger.warn(`live start refused: ${codeOf(error)} job ${jobId}`);
      throw error;
    }
  }

  // Logs a refused stop or keep change by its code and the session's id.
  private async refusingOn<T>(
    what: 'stop' | 'keep',
    liveSessionId: string,
    run: () => Promise<T>,
  ) {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(
        `live ${what} refused: ${codeOf(error)} session ${liveSessionId}`,
      );
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

const codeOf = (error: unknown) =>
  error instanceof NotFoundException
    ? 'not_found'
    : error instanceof HttpException
      ? ((error.getResponse() as { code?: string }).code ?? 'error')
      : 'error';

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

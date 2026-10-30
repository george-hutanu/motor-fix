import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import {
  type RepairFromJobOutcome,
  recordRepairFromJob,
} from './repair-from-job.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { NOTIFICATIONS_PRISMA } from '../../notifications/notifications.service';
import { jobNames, liveOwner } from '../history/history';

export const REPAIR_FROM_JOB_QUEUE = 'repair-from-job';

const RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

const KINDS: readonly EventKind[] = [
  'job.handed_over',
  'job.final_price_corrected',
];

export const REPAIR_FROM_JOB_CONSUMER = {
  jobs: RUN,
  kinds: KINDS,
  queue: REPAIR_FROM_JOB_QUEUE,
};

export interface RepairFromJobEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  subjectId?: string;
}

// What a job with no quoted job left is called in the history.
const NO_JOB_NAMES = 'Lucrare MotorFix';

const JOB_SELECT = {
  booking: {
    select: {
      quote: {
        select: {
          jobs: {
            select: {
              requestJob: {
                select: {
                  jobType: { select: { nameEn: true, nameRo: true } },
                  position: true,
                },
              },
            },
            where: { included: true },
          },
        },
      },
    },
  },
  car: {
    select: {
      ownerships: {
        select: { account: { select: { status: true } }, accountId: true },
        where: { toDate: null },
      },
    },
  },
  carId: true,
  finalPriceBani: true,
  finishedAt: true,
  garage: { select: { name: true } },
  garageId: true,
  handedOverAt: true,
  id: true,
  odometerKm: true,
} satisfies Prisma.JobSelect;

type HandedOverJob = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

// Keeps a handed-over job's MotorFix repair in step with the job: the
// handover creates it, a price correction updates its cost. The job is read
// afresh, never the event, so a run in any order or twice leaves the same row.
@Injectable()
export class RepairFromJob {
  private readonly logger = new Logger('RepairFromJob');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async onEvent(job: Pick<Job<RepairFromJobEvent>, 'data'>) {
    const { kind, subjectId } = job.data;
    if (!KINDS.includes(kind as EventKind) || !subjectId) return;
    await this.syncFromJob(subjectId);
  }

  async syncFromJob(jobId: string): Promise<RepairFromJobOutcome> {
    const job = await this.prisma.job.findUnique({
      select: JOB_SELECT,
      where: { id: jobId },
    });
    // A job not handed over is no repair yet; one gone will not come back,
    // so neither is retried.
    if (!job?.handedOverAt) {
      this.done(jobId, null, 'job_missing');
      return 'job_missing';
    }
    const { outcome, repairId } = await this.write(job, job.handedOverAt).catch(
      (error) => {
        if (!isUniqueViolation(error)) throw error;
        return { outcome: 'unchanged' as const, repairId: null };
      },
    );
    this.done(jobId, repairId, outcome);
    return outcome;
  }

  private write(job: HandedOverJob, handedOverAt: Date) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair WHERE job_id = ${job.id}::uuid FOR UPDATE`;
      const existing = await tx.repair.findUnique({
        select: { costBani: true, id: true },
        where: { jobId: job.id },
      });
      const scope = {
        actorId: null,
        actorRole: 'system' as const,
        carId: job.carId,
        garageId: job.garageId,
        jobId: job.id,
        subjectType: 'repair',
      };
      if (!existing) {
        const values = {
          carId: job.carId,
          costBani: job.finalPriceBani,
          doneOn: localDay(job.finishedAt ?? handedOverAt),
          garageId: job.garageId,
          garageName: job.garage.name,
          jobId: job.id,
          odometerKm: job.odometerKm,
          source: 'motorfix' as const,
          what: jobNames(job.booking.quote.jobs, 'ro') || NO_JOB_NAMES,
        };
        const repair = await tx.repair.create({
          data: { ...values, doneOn: new Date(`${values.doneOn}T00:00:00Z`) },
          select: { id: true },
        });
        await this.audit.record(tx, {
          ...scope,
          action: 'create',
          newValue: values,
          subjectId: repair.id,
        });
        await this.announce(tx, job, repair.id, ['created']);
        return { outcome: 'created' as const, repairId: repair.id };
      }
      if (existing.costBani === job.finalPriceBani) {
        return { outcome: 'unchanged' as const, repairId: existing.id };
      }
      await tx.repair.update({
        data: { costBani: job.finalPriceBani },
        where: { id: existing.id },
      });
      await this.audit.record(tx, {
        ...scope,
        action: 'update',
        field: 'cost_bani',
        newValue: job.finalPriceBani,
        oldValue: existing.costBani,
        subjectId: existing.id,
      });
      await this.announce(tx, job, existing.id, ['costBani']);
      return { outcome: 'cost_updated' as const, repairId: existing.id };
    });
  }

  // The garage made the change, so only the owner's screens hear of it.
  private announce(
    tx: Prisma.TransactionClient,
    job: HandedOverJob,
    repairId: string,
    changed: string[],
  ) {
    const ownerId = liveOwner(job.car);
    return this.events.record(tx, {
      audience: {
        ownerAccountId: ownerId,
        sharedGarageId: null,
        type: 'repair',
      },
      kind: 'repair.updated',
      payload: {
        by: 'system',
        carId: job.carId,
        changed,
        garageId: job.garageId,
        ownerId,
        repairId,
      },
      subjectId: repairId,
    });
  }

  private done(
    jobId: string,
    repairId: string | null,
    outcome: RepairFromJobOutcome,
  ) {
    recordRepairFromJob(outcome);
    this.logger.log(`job ${jobId}: repair ${repairId ?? 'none'} ${outcome}`);
  }
}

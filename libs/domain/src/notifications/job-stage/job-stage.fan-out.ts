import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import { featureOn } from '../../garages/features/feature-on';
import type { PrismaClient } from '../../generated/prisma/client';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const JOB_STAGE_QUEUE = 'job-stage';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const JOB_STAGE_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const JOB_STAGE_CONSUMER = {
  jobs: JOB_STAGE_RUN,
  kinds: ['job.started', 'job.done'] as readonly EventKind[],
  queue: JOB_STAGE_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's, `subjectId` the
// job's.
export interface JobStageEvent {
  id: string;
  kind: string;
  subjectId: string;
}

interface StartedRow {
  car: { brand: { name: string }; model: string };
  driver: { language: string };
  garage: { name: string };
  garageId: string;
  mechanic: { name: string } | null;
  mechanicId: string | null;
}

const firstName = (name: string | undefined) =>
  name?.trim().split(/\s+/)[0] || null;

// The car as a whole phrase in the driver's language; never the plate.
function carPhrase(brand: string, model: string, language: string): string {
  const name = [brand, model]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  if (language === 'en') return name ? `the ${name}` : 'your car';
  return name || 'mașina ta';
}

// Tells the driver the garage started work on the car, and that the car is
// ready. The outbox event id keeps a retry or a second relay from building
// anything twice; a pause or a resume is not listened to at all.
@Injectable()
export class JobStageFanOut {
  private readonly logger = new Logger('JobStage');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(job: Pick<Job<JobStageEvent>, 'data'>): Promise<void> {
    const { id: eventId, kind, subjectId: jobId } = job.data;
    const row = await this.prisma.job.findUnique({
      select: {
        booking: { select: { requestId: true } },
        car: { select: { brand: { select: { name: true } }, model: true } },
        driver: { select: { language: true } },
        driverId: true,
        garage: { select: { name: true } },
        garageId: true,
        mechanic: { select: { name: true } },
        mechanicId: true,
        status: true,
      },
      where: { id: jobId },
    });
    const ready = kind === 'job.done';
    // Reopened, cancelled or gone before the message went out.
    if (!row || (ready ? row.status !== 'done' : row.status === 'cancelled')) {
      this.logger.log(
        `job ${jobId} ${kind} not announced: ${row?.status ?? 'missing'}`,
      );
      return;
    }
    const link = `${this.config.webUrl}/app/driver/requests/${row.booking.requestId}`;
    const type = ready ? 'JOB_READY' : 'JOB_STARTED';
    const queued = await this.notifications.notify({
      eventId,
      kind: type,
      params: ready
        ? { garage: row.garage.name, link }
        : { ...(await this.started(row)), link },
      recipients: [row.driverId],
      subjectId: jobId,
    });
    this.logger.log(`job ${jobId} ${type} to its driver, ${queued} queued`);
  }

  // Who started the work and on which car: the mechanic's first name when the
  // garage runs a team, else the garage.
  private async started(row: StartedRow) {
    const team =
      row.mechanicId !== null &&
      (await featureOn(this.prisma, row.garageId, 'team_mechanics'));
    return {
      actor: (team && firstName(row.mechanic?.name)) || row.garage.name,
      car: carPhrase(row.car.brand.name, row.car.model, row.driver.language),
    };
  }
}

import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';
import { isUUID } from 'class-validator';

import type { PrismaClient } from '../../generated/prisma/client';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const CATALOGUE_JOB_PENDING_QUEUE = 'catalogue-job-pending';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const CATALOGUE_JOB_PENDING_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const CATALOGUE_JOB_PENDING_CONSUMER = {
  jobs: CATALOGUE_JOB_PENDING_RUN,
  kinds: ['catalogue_job.proposed'] as readonly EventKind[],
  queue: CATALOGUE_JOB_PENDING_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface CatalogueJobPendingEvent {
  id: string;
  // Unchecked: the relay passes the payload through as recorded.
  payload: { garageId?: unknown; jobTypeId?: unknown };
}

// Tells every active admin that a garage proposed a job for the catalogue,
// whichever write saved the proposal. The event carries ids only; the names
// are read here, and the event id keeps a retry from building anything twice.
@Injectable()
export class CatalogueJobPendingFanOut {
  private readonly logger = new Logger('CatalogueJobs');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(
    job: Pick<Job<CatalogueJobPendingEvent>, 'data'>,
  ): Promise<void> {
    const { id: eventId, payload } = job.data;
    const { jobTypeId } = payload;
    if (typeof jobTypeId !== 'string' || !isUUID(jobTypeId)) {
      this.untold('?');
      return;
    }
    const proposed = await this.prisma.jobType.findUnique({
      select: { nameRo: true, proposedBy: { select: { name: true } } },
      where: { id: jobTypeId },
    });
    const admins = proposed?.proposedBy
      ? await this.prisma.account.findMany({
          select: { id: true },
          where: { roles: { some: { role: 'admin' } }, status: 'active' },
        })
      : [];
    if (!proposed?.proposedBy || admins.length === 0) {
      this.untold(jobTypeId);
      return;
    }
    await this.notifications.notify({
      eventId,
      kind: 'ADMIN_CATALOGUE_JOB_PENDING',
      params: {
        dashboard: `${this.config.webUrl}/app/admin`,
        garage: proposed.proposedBy.name,
        job: proposed.nameRo,
      },
      recipients: admins.map(({ id }) => id),
      subjectId: jobTypeId,
    });
    this.logger.log(
      `catalogue job ${jobTypeId} proposed: told to ${admins.length} admins`,
    );
  }

  private untold(jobTypeId: string): void {
    this.logger.log(`catalogue job ${jobTypeId} proposed: nobody told`);
  }
}

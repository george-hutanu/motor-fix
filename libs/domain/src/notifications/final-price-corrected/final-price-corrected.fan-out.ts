import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const FINAL_PRICE_CORRECTED_QUEUE = 'final-price-corrected';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const FINAL_PRICE_CORRECTED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const FINAL_PRICE_CORRECTED_CONSUMER = {
  jobs: FINAL_PRICE_CORRECTED_RUN,
  kinds: ['job.final_price_corrected'] as readonly EventKind[],
  queue: FINAL_PRICE_CORRECTED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's, `subjectId` the
// job's.
export interface FinalPriceCorrectedEvent {
  id: string;
  payload: { newBani: number };
  subjectId: string;
}

// Tells the driver the garage corrected the final price, with the garage and
// the price the correction set: the event's, not the row's, so a later
// correction does not rewrite an earlier message. The outbox event id keeps a
// retry or a second relay from building anything twice.
@Injectable()
export class FinalPriceCorrectedFanOut {
  private readonly logger = new Logger('FinalPriceCorrected');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(
    job: Pick<Job<FinalPriceCorrectedEvent>, 'data'>,
  ): Promise<void> {
    const { id: eventId, payload, subjectId: jobId } = job.data;
    const found = await this.prisma.job.findUnique({
      select: {
        booking: { select: { driverId: true, requestId: true } },
        garage: { select: { name: true } },
      },
      where: { id: jobId },
    });
    if (!found) {
      this.logger.log(`job ${jobId} gone before its correction went out`);
      return;
    }
    const queued = await this.notifications.notify({
      eventId,
      kind: 'FINAL_PRICE_CORRECTED',
      params: {
        garage: found.garage.name,
        link: `${this.config.webUrl}/app/driver/requests/${found.booking.requestId}`,
        price: payload.newBani,
      },
      recipients: [found.booking.driverId],
      subjectId: jobId,
    });
    this.logger.log(
      `job ${jobId} final price correction to its driver, ${queued} queued`,
    );
  }
}

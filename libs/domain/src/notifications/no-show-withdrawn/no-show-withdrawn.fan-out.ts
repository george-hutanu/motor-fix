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

export const NO_SHOW_WITHDRAWN_QUEUE = 'no-show-withdrawn';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const NO_SHOW_WITHDRAWN_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const NO_SHOW_WITHDRAWN_CONSUMER = {
  jobs: NO_SHOW_WITHDRAWN_RUN,
  kinds: ['booking.no_show_withdrawn'] as readonly EventKind[],
  queue: NO_SHOW_WITHDRAWN_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface NoShowWithdrawnEvent {
  id: string;
  payload: { bookingId: string };
}

// Tells the driver alone that the garage withdrew the no-show and the booking
// stands; a booking no longer confirmed is not told. The outbox event id keeps
// a retry or a second relay from building anything twice.
@Injectable()
export class NoShowWithdrawnFanOut {
  private readonly logger = new Logger('NoShowWithdrawn');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(job: Pick<Job<NoShowWithdrawnEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const booking = await this.prisma.booking.findUnique({
      select: {
        driverId: true,
        garage: { select: { name: true } },
        requestId: true,
        startsAt: true,
        status: true,
      },
      where: { id: payload.bookingId },
    });
    if (booking?.status !== 'confirmed') {
      this.logger.log(
        `booking ${payload.bookingId} no-show withdrawal not told: ${booking?.status ?? 'missing'}`,
      );
      return;
    }
    const queued = await this.notifications.notify({
      eventId,
      kind: 'NO_SHOW_WITHDRAWN',
      params: {
        garage: booking.garage.name,
        link: `${this.config.webUrl}/app/driver/requests/${booking.requestId}`,
        slot: booking.startsAt.toISOString(),
      },
      recipients: [booking.driverId],
      subjectId: payload.bookingId,
    });
    this.logger.log(
      `booking ${payload.bookingId} no-show withdrawal told to its driver, ${queued} queued`,
    );
  }
}

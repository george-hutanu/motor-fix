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

export const BOOKING_CONFIRMED_QUEUE = 'booking-confirmed';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const BOOKING_CONFIRMED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const BOOKING_CONFIRMED_CONSUMER = {
  jobs: BOOKING_CONFIRMED_RUN,
  kinds: ['booking.confirmed'] as readonly EventKind[],
  queue: BOOKING_CONFIRMED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface BookingConfirmedEvent {
  id: string;
  payload: { bookingId: string };
}

// Tells the driver the garage confirmed the booking, with the garage and the
// slot. The outbox event id keeps a retry or a second relay from building
// anything twice.
@Injectable()
export class BookingConfirmedFanOut {
  private readonly logger = new Logger('BookingConfirmed');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(job: Pick<Job<BookingConfirmedEvent>, 'data'>): Promise<void> {
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
    // Cancelled, or gone, before the message went out.
    if (booking?.status !== 'confirmed') {
      this.logger.log(
        `booking ${payload.bookingId} not announced: ${booking?.status ?? 'missing'}`,
      );
      return;
    }
    const queued = await this.notifications.notify({
      eventId,
      kind: 'BOOKING_CONFIRMED',
      params: {
        garage: booking.garage.name,
        link: `${this.config.webUrl}/app/driver/requests/${booking.requestId}`,
        slot: booking.startsAt.toISOString(),
      },
      recipients: [booking.driverId],
      subjectId: payload.bookingId,
    });
    this.logger.log(
      `booking ${payload.bookingId} confirmed to its driver, ${queued} queued`,
    );
  }
}

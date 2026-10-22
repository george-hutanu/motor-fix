import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import { loadGarageAccess } from '../../events/garage-access';
import type { PrismaClient } from '../../generated/prisma/client';
import { shortName } from '../../quotes/reads';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const BOOKING_CANCELLED_QUEUE = 'booking-cancelled';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const BOOKING_CANCELLED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export const BOOKING_CANCELLED_CONSUMER = {
  jobs: BOOKING_CANCELLED_RUN,
  kinds: ['booking.cancelled'] as readonly EventKind[],
  queue: BOOKING_CANCELLED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface BookingCancelledEvent {
  id: string;
  payload: { bookingId: string; reason?: unknown };
}

// The cancellations this fan-out announces; the driver's and the garage's
// own are their stories', which write their own texts.
const ANNOUNCED = 'driver_account_closed';

// Tells the garage's owners and receptionists, and the booking's mechanic
// when the mechanic has an account, that a closed account's booking is
// cancelled; the driver is never told. The outbox event id keeps a retry or a
// second relay from building anything twice.
@Injectable()
export class BookingCancelledFanOut {
  private readonly logger = new Logger('BookingCancelled');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<BookingCancelledEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    if (payload.reason !== ANNOUNCED) {
      this.logger.log(
        `booking ${payload.bookingId} cancelled for ${payload.reason}: not this fan-out's`,
      );
      return;
    }
    const booking = await this.prisma.booking.findUnique({
      select: {
        driver: { select: { name: true } },
        garageId: true,
        mechanic: { select: { accountId: true } },
        request: { select: { carBrand: true, carModel: true } },
        startsAt: true,
      },
      where: { id: payload.bookingId },
    });
    if (!booking) {
      this.logger.log(`booking ${payload.bookingId} missing; nobody told`);
      return;
    }
    const { owners, receptionists } = await this.access(booking.garageId);
    const mechanic = booking.mechanic?.accountId;
    const recipients = [
      ...new Set([
        ...owners,
        ...receptionists,
        ...(mechanic ? [mechanic] : []),
      ]),
    ];
    const queued = recipients.length
      ? await this.notifications.notify({
          eventId,
          garageId: booking.garageId,
          kind: 'BOOKING_CANCELLED',
          params: {
            car: `${booking.request.carBrand} ${booking.request.carModel}`,
            driver: shortName(booking.driver.name),
            link: `${this.config.webUrl}/app/garage/schedule`,
            reason: ANNOUNCED,
            slot: booking.startsAt.toISOString(),
          },
          recipients,
          subjectId: payload.bookingId,
        })
      : 0;
    this.logger.log(
      `booking ${payload.bookingId} cancellation told to ${recipients.length} people, ${queued} queued`,
    );
  }
}

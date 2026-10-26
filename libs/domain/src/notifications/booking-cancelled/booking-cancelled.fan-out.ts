import {
  DRIVER_CANCEL_REASONS,
  type DriverCancelReasonCode,
  type EventKind,
} from '@motor-fix/contracts';
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
  payload: { bookingId: string; reason?: unknown; side?: unknown };
}

// A closed account's cancellation; the garage's own is its story's, which
// writes its own texts.
const ACCOUNT_CLOSED = 'driver_account_closed';

// The driver's reason as the event carries it; anything unknown reads as other.
const driverReason = (reason: unknown): DriverCancelReasonCode =>
  DRIVER_CANCEL_REASONS.find((code) => code === reason) ?? 'other';

// Tells the garage's owners and receptionists, and the booking's mechanic
// when the mechanic has an account, that a booking is cancelled, either
// because the driver's account closed or because the driver cancelled it; the
// driver is never told. The outbox event id keeps a retry or a second relay
// from building anything twice.
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
    const byDriver = payload.side === 'driver';
    if (!byDriver && payload.reason !== ACCOUNT_CLOSED) {
      this.logger.log(
        `booking ${payload.bookingId} cancelled for ${payload.reason}: not this fan-out's`,
      );
      return;
    }
    const booking = await this.prisma.booking.findUnique({
      select: {
        cancelNote: true,
        driver: { select: { name: true } },
        garageId: true,
        lateCancellation: true,
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
            slot: booking.startsAt.toISOString(),
            ...this.why(byDriver, payload.reason, booking),
          },
          recipients,
          subjectId: payload.bookingId,
        })
      : 0;
    this.logger.log(
      `booking ${payload.bookingId} cancellation told to ${recipients.length} people, ${queued} queued`,
    );
  }

  // The driver's own cancel sends the garage to its requests with the reason,
  // the note and the late text; a closed account's to its schedule.
  private why(
    byDriver: boolean,
    reason: unknown,
    booking: { cancelNote: string | null; lateCancellation: boolean },
  ) {
    if (!byDriver) {
      return {
        link: `${this.config.webUrl}/app/garage/schedule`,
        reason: ACCOUNT_CLOSED,
      };
    }
    return {
      link: `${this.config.webUrl}/app/garage/requests`,
      note: booking.cancelNote ?? '',
      reason: driverReason(reason),
      variant: booking.lateCancellation ? 'driver_late' : 'driver',
    };
  }
}

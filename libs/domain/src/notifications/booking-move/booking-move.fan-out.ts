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

export const BOOKING_MOVE_QUEUE = 'booking-move';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const BOOKING_MOVE_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const BOOKING_MOVE_CONSUMER = {
  jobs: BOOKING_MOVE_RUN,
  kinds: [
    'booking.move_proposed',
    'booking.move_lapsed',
  ] as readonly EventKind[],
  queue: BOOKING_MOVE_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface BookingMoveEvent {
  id: string;
  kind: string;
  payload: { bookingId: string; moveId: string };
}

// Tells the garage's owners and receptionists that a driver asks to move a
// booking, and the driver that the garage let the ask lapse; mechanics are
// never told. A booking that is no longer confirmed tells nobody. The outbox
// event id keeps a retry or a second relay from building anything twice.
@Injectable()
export class BookingMoveFanOut {
  private readonly logger = new Logger('BookingMove');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<BookingMoveEvent>, 'data'>): Promise<void> {
    const { id: eventId, kind, payload } = job.data;
    const [booking, move] = await Promise.all([
      this.prisma.booking.findUnique({
        select: {
          driver: { select: { name: true } },
          driverId: true,
          garage: { select: { name: true } },
          garageId: true,
          request: { select: { carBrand: true, carModel: true } },
          requestId: true,
          startsAt: true,
          status: true,
        },
        where: { id: payload.bookingId },
      }),
      this.prisma.bookingMove.findUnique({
        select: { newStartsAt: true },
        where: { id: payload.moveId },
      }),
    ]);
    if (booking?.status !== 'confirmed' || !move) {
      this.logger.log(
        `booking ${payload.bookingId} ${kind} not announced: ${move ? (booking?.status ?? 'missing') : 'move missing'}`,
      );
      return;
    }
    if (kind === 'booking.move_lapsed') {
      const queued = await this.notifications.notify({
        eventId,
        kind: 'BOOKING_MOVE_LAPSED',
        params: {
          garage: booking.garage.name,
          link: `${this.config.webUrl}/app/driver/requests/${booking.requestId}`,
          slot: booking.startsAt.toISOString(),
        },
        recipients: [booking.driverId],
        subjectId: payload.moveId,
      });
      this.logger.log(
        `move ${payload.moveId} lapse told to its driver, ${queued} queued`,
      );
      return;
    }
    const { owners, receptionists } = await this.access(booking.garageId);
    const staff = [...new Set([...owners, ...receptionists])];
    const queued = staff.length
      ? await this.notifications.notify({
          eventId,
          garageId: booking.garageId,
          kind: 'BOOKING_MOVE_REQUESTED',
          params: {
            car: `${booking.request.carBrand} ${booking.request.carModel}`,
            driver: shortName(booking.driver.name),
            link: `${this.config.webUrl}/app/garage/requests`,
            slot: booking.startsAt.toISOString(),
            to: move.newStartsAt.toISOString(),
          },
          recipients: staff,
          subjectId: payload.moveId,
        })
      : 0;
    this.logger.log(
      `move ${payload.moveId} ask told to ${staff.length} staff, ${queued} queued`,
    );
  }
}

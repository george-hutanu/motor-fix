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

export const BOOKING_LAPSED_QUEUE = 'booking-lapsed';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const BOOKING_LAPSED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const BOOKING_LAPSED_CONSUMER = {
  jobs: BOOKING_LAPSED_RUN,
  kinds: ['booking.lapsed'] as readonly EventKind[],
  queue: BOOKING_LAPSED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface BookingLapsedEvent {
  id: string;
  payload: { bookingId: string };
}

// Tells the driver to choose another quote, and the garage's owners and
// receptionists whose booking lapsed; mechanics are never told. The outbox
// event id keeps a retry or a second relay from building anything twice.
@Injectable()
export class BookingLapsedFanOut {
  private readonly logger = new Logger('BookingLapsed');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<BookingLapsedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const booking = await this.prisma.booking.findUnique({
      select: {
        driver: { select: { name: true } },
        driverId: true,
        garage: { select: { name: true } },
        garageId: true,
        request: { select: { carBrand: true, carModel: true } },
        status: true,
      },
      where: { id: payload.bookingId },
    });
    if (booking?.status !== 'lapsed') {
      this.logger.log(
        `booking ${payload.bookingId} lapse not announced: ${booking?.status ?? 'missing'}`,
      );
      return;
    }
    const driver = await this.notifications.notify({
      eventId,
      kind: 'BOOKING_LAPSED',
      params: {
        garage: booking.garage.name,
        link: `${this.config.webUrl}/app/requests`,
        side: 'driver',
      },
      recipients: [booking.driverId],
      subjectId: payload.bookingId,
    });
    const { owners, receptionists } = await this.access(booking.garageId);
    const staff = [...new Set([...owners, ...receptionists])];
    const garage = staff.length
      ? await this.notifications.notify({
          eventId,
          garageId: booking.garageId,
          kind: 'BOOKING_LAPSED',
          params: {
            car: `${booking.request.carBrand} ${booking.request.carModel}`,
            driver: shortName(booking.driver.name),
            link: `${this.config.webUrl}/app/garage/requests`,
            side: 'garage',
          },
          recipients: staff,
          subjectId: payload.bookingId,
        })
      : 0;
    this.logger.log(
      `booking ${payload.bookingId} lapse told to its driver and ${staff.length} staff, ${driver + garage} queued`,
    );
  }
}

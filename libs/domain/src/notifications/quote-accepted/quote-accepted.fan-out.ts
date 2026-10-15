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

export const QUOTE_ACCEPTED_QUEUE = 'quote-accepted';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const QUOTE_ACCEPTED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const QUOTE_ACCEPTED_CONSUMER = {
  jobs: QUOTE_ACCEPTED_RUN,
  kinds: ['quote.accepted'] as readonly EventKind[],
  queue: QUOTE_ACCEPTED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface QuoteAcceptedEvent {
  id: string;
  payload: { quoteId: string; bookingId: string };
}

// Tells the garage's owners and receptionists that a driver accepted its
// quote and the booking waits for their confirmation; mechanics are never
// told. The service applies each person's mute for that garage, the garage's
// WhatsApp switch and the no-device fallback; the outbox event id keeps a
// retry or a second relay from building anything twice.
@Injectable()
export class QuoteAcceptedFanOut {
  private readonly logger = new Logger('QuoteAccepted');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<QuoteAcceptedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const booking = await this.prisma.booking.findUnique({
      select: {
        driver: { select: { name: true } },
        garageId: true,
        request: { select: { carBrand: true, carModel: true } },
        startsAt: true,
        status: true,
      },
      where: { id: payload.bookingId },
    });
    // Confirmed, lapsed or cancelled before the message went out.
    if (booking?.status !== 'awaiting_confirmation') {
      this.logger.log(
        `quote ${payload.quoteId} not announced: booking ${booking?.status ?? 'missing'}`,
      );
      return;
    }
    const { owners, receptionists } = await this.access(booking.garageId);
    const staff = [...new Set([...owners, ...receptionists])];
    const queued = staff.length
      ? await this.notifications.notify({
          eventId,
          garageId: booking.garageId,
          kind: 'QUOTE_ACCEPTED',
          params: {
            car: `${booking.request.carBrand} ${booking.request.carModel}`,
            driver: shortName(booking.driver.name),
            link: `${this.config.webUrl}/app/garage/requests`,
            slot: booking.startsAt.toISOString(),
          },
          recipients: staff,
          subjectId: payload.quoteId,
        })
      : 0;
    this.logger.log(
      `quote ${payload.quoteId} announced to ${staff.length} staff, ${queued} queued`,
    );
  }
}

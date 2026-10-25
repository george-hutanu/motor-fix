import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import { loadGarageAccess } from '../../events/garage-access';
import type { PrismaClient } from '../../generated/prisma/client';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const QUOTE_LOST_QUEUE = 'quote-lost';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const QUOTE_LOST_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export const QUOTE_LOST_CONSUMER = {
  jobs: QUOTE_LOST_RUN,
  kinds: ['quote.closed'] as readonly EventKind[],
  queue: QUOTE_LOST_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface QuoteClosedEvent {
  id: string;
  payload: { quoteIds: string[]; requestId: string };
}

// Tells the owners and receptionists of each garage whose quote closed as
// the driver confirmed another garage's that the customer chose another
// garage; mechanics, the winning garage and garages that never quoted are
// not told. The outbox event id keeps a retry or a second relay from
// building anything twice.
@Injectable()
export class QuoteLostFanOut {
  private readonly logger = new Logger('QuoteLost');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<QuoteClosedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const quotes = payload.quoteIds.length
      ? await this.prisma.quote.findMany({
          select: {
            garageId: true,
            id: true,
            request: { select: { carBrand: true, carModel: true } },
          },
          where: { id: { in: payload.quoteIds } },
        })
      : [];
    let told = 0;
    let queued = 0;
    for (const quote of quotes) {
      const { owners, receptionists } = await this.access(quote.garageId);
      const staff = [...new Set([...owners, ...receptionists])];
      if (!staff.length) continue;
      told += staff.length;
      queued += await this.notifications.notify({
        eventId,
        garageId: quote.garageId,
        kind: 'QUOTE_LOST',
        params: {
          car: `${quote.request.carBrand} ${quote.request.carModel}`,
          link: `${this.config.webUrl}/app/garage/requests`,
        },
        recipients: staff,
        subjectId: quote.id,
      });
    }
    this.logger.log(
      `request ${payload.requestId}: ${quotes.length} lost quotes told to ${told} people, ${queued} queued`,
    );
  }
}

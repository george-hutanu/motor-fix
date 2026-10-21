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

export const QUOTE_DECLINED_QUEUE = 'quote-declined';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const QUOTE_DECLINED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const QUOTE_DECLINED_CONSUMER = {
  jobs: QUOTE_DECLINED_RUN,
  kinds: ['quote.declined_by_driver'] as readonly EventKind[],
  queue: QUOTE_DECLINED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface QuoteDeclinedEvent {
  id: string;
  payload: { quoteId: string };
}

// Tells the garage's owners, receptionists and the mechanics who may answer
// quotes that the driver declined its quote. The service applies each
// person's mute for that garage, the garage's WhatsApp switch and the
// no-device fallback; the outbox event id keeps a retry from building
// anything twice.
@Injectable()
export class QuoteDeclinedFanOut {
  private readonly logger = new Logger('QuoteDeclined');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<QuoteDeclinedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const quote = await this.prisma.quote.findUnique({
      select: {
        garageId: true,
        request: {
          select: {
            carBrand: true,
            carModel: true,
            driver: { select: { name: true } },
          },
        },
        status: true,
      },
      where: { id: payload.quoteId },
    });
    if (quote?.status !== 'declined_by_driver') {
      this.logger.log(
        `quote ${payload.quoteId} not announced: ${quote?.status ?? 'missing'}`,
      );
      return;
    }
    const { mechanics, owners, receptionists } = await this.access(
      quote.garageId,
    );
    const answering = [...mechanics]
      .filter(([, permissions]) => permissions.canAnswerQuotes)
      .map(([accountId]) => accountId);
    const staff = [...new Set([...owners, ...receptionists, ...answering])];
    const queued = staff.length
      ? await this.notifications.notify({
          eventId,
          garageId: quote.garageId,
          kind: 'QUOTE_DECLINED_BY_DRIVER',
          params: {
            car: `${quote.request.carBrand} ${quote.request.carModel}`,
            driverShortName: shortName(quote.request.driver.name),
            link: `${this.config.webUrl}/app/garage/requests`,
          },
          recipients: staff,
          subjectId: payload.quoteId,
        })
      : 0;
    this.logger.log(
      `quote ${payload.quoteId} declined, told ${staff.length} staff, ${queued} queued`,
    );
  }
}

import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import { countQuoteReceived } from '../../metrics/product-counters';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const QUOTE_RECEIVED_QUEUE = 'quote-received';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const QUOTE_RECEIVED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const QUOTE_RECEIVED_CONSUMER = {
  jobs: QUOTE_RECEIVED_RUN,
  kinds: ['quote.sent'] as readonly EventKind[],
  queue: QUOTE_RECEIVED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface QuoteSentEvent {
  id: string;
  payload: { quoteId: string };
}

const BANI_PER_LEU = 100;

// Tells the driver that a garage quoted their request. The service applies
// the driver's mute, the no-device fallback and the never-SMS rule; the
// outbox event id keeps a retry or a second relay from building anything
// twice. The message names the garage and the range, nothing else.
@Injectable()
export class QuoteReceivedFanOut {
  private readonly logger = new Logger('QuoteReceived');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(job: Pick<Job<QuoteSentEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const quote = await this.prisma.quote.findUnique({
      select: {
        fromBani: true,
        garage: { select: { name: true } },
        request: { select: { driverId: true } },
        requestId: true,
        status: true,
        toBani: true,
      },
      where: { id: payload.quoteId },
    });
    // Withdrawn or answered before the message went out: nothing to tell.
    if (quote?.status !== 'waiting') return;
    const range = `${quote.fromBani / BANI_PER_LEU}–${quote.toBani / BANI_PER_LEU}`;
    const queued = await this.notifications.notify({
      eventId,
      kind: 'QUOTE_RECEIVED',
      params: {
        garage: quote.garage.name,
        link: `${this.config.webUrl}/app/driver/requests/${quote.requestId}`,
        range,
      },
      recipients: [quote.request.driverId],
      subjectId: payload.quoteId,
    });
    // Nothing queued: the driver muted every outside channel.
    const outcome = queued > 0 ? 'built' : 'muted';
    countQuoteReceived(outcome);
    this.logger.log(`quote ${payload.quoteId} announced to driver: ${outcome}`);
  }
}

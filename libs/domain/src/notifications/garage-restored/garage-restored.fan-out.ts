import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import { countGarageRestoredNotice } from '../../metrics/product-counters';
import type { EmailConfig } from '../email-config';
import { ownersByLanguage } from '../garage-suspended/garage-suspended.fan-out';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const GARAGE_RESTORED_QUEUE = 'garage-restored';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const GARAGE_RESTORED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const GARAGE_RESTORED_CONSUMER = {
  jobs: GARAGE_RESTORED_RUN,
  kinds: ['garage.restored'] as readonly EventKind[],
  queue: GARAGE_RESTORED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface GarageRestoredEvent {
  id: string;
  // Unchecked: the relay passes the payload through as recorded.
  payload: { garageId?: unknown };
}

// Tells a restored garage's owners it is back on the map, each in their own
// language. It names the garage only: the cause and the admin's note stay in
// the history. The service sends the e-mail and the bell whatever they
// muted; the event id keeps a retry from building anything twice.
@Injectable()
export class GarageRestoredFanOut {
  private readonly logger = new Logger('GarageRestored');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(job: Pick<Job<GarageRestoredEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const garageId = payload?.garageId;
    if (typeof garageId !== 'string') {
      this.untold(garageId);
      return;
    }
    // Suspended again before this job ran: the suspended notice is the last
    // word, never a late "back on the map".
    const garage = await this.prisma.garage.findFirst({
      select: { name: true },
      where: { id: garageId, status: 'approved' },
    });
    const people = garage
      ? await ownersByLanguage(this.prisma, garageId)
      : new Map();
    if (!garage || people.size === 0) {
      this.untold(garageId);
      return;
    }
    let told = 0;
    for (const recipients of people.values()) {
      await this.notifications.notify({
        eventId,
        garageId,
        kind: 'GARAGE_RESTORED',
        params: {
          garage: garage.name,
          link: `${this.config.webUrl}/app/garage`,
        },
        recipients,
        subjectId: garageId,
      });
      told += recipients.length;
    }
    countGarageRestoredNotice('built');
    this.logger.log(`restored notices garage=${garageId} owners=${told}`);
  }

  private untold(garageId: unknown): void {
    countGarageRestoredNotice('skipped');
    this.logger.log(
      `restored notices garage=${typeof garageId === 'string' ? garageId : '?'} owners=0`,
    );
  }
}

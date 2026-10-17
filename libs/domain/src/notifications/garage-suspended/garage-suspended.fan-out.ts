import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import { countGarageSuspendedNotice } from '../../metrics/product-counters';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';
import { nextStep } from '../templates/garage-suspended';

export const GARAGE_SUSPENDED_QUEUE = 'garage-suspended';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const GARAGE_SUSPENDED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const GARAGE_SUSPENDED_CONSUMER = {
  jobs: GARAGE_SUSPENDED_RUN,
  kinds: ['garage.suspended'] as readonly EventKind[],
  queue: GARAGE_SUSPENDED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface GarageSuspendedEvent {
  id: string;
  // Unchecked: the relay passes the payload through as recorded.
  payload: { cause?: unknown; garageId?: unknown };
}

// Tells a suspended garage's owners why and what to do, each in their own
// language. The cause and the reason are read from the open suspension, so a
// suspension already lifted tells nobody. The service sends the e-mail and
// the bell whatever they muted; the event id keeps a retry from building
// anything twice.
@Injectable()
export class GarageSuspendedFanOut {
  private readonly logger = new Logger('GarageSuspended');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(job: Pick<Job<GarageSuspendedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const { garageId } = payload;
    if (typeof garageId !== 'string') {
      this.untold(garageId);
      return;
    }
    const suspension = await this.prisma.garageSuspension.findFirst({
      orderBy: { fromTime: 'desc' },
      select: { cause: true, garage: { select: { name: true } }, reason: true },
      where: { garageId, untilTime: null },
    });
    const owners = suspension ? await this.owners(garageId) : new Map();
    if (!suspension || owners.size === 0) {
      this.untold(garageId);
      return;
    }
    let told = 0;
    for (const [language, people] of owners) {
      await this.notifications.notify({
        eventId,
        garageId,
        kind: 'GARAGE_SUSPENDED',
        params: {
          garage: suspension.garage.name,
          link: `${this.config.webUrl}/app/garage`,
          next: nextStep(suspension.cause, language),
          reason: suspension.reason,
        },
        recipients: people,
        subjectId: garageId,
      });
      told += people.length;
    }
    countGarageSuspendedNotice('built');
    this.logger.log(
      `garage ${garageId} suspended (${suspension.cause}) told to ${told} owners`,
    );
  }

  private untold(garageId: unknown): void {
    countGarageSuspendedNotice('skipped');
    this.logger.log(
      `garage ${typeof garageId === 'string' ? garageId : '?'} suspended: nobody told`,
    );
  }

  // The garage's owners whose accounts still stand, by language.
  private async owners(garageId: string): Promise<Map<string, string[]>> {
    const accounts = await this.prisma.account.findMany({
      select: { id: true, language: true },
      where: {
        memberships: { some: { garageId, role: 'owner' } },
        status: { not: 'deleted' },
      },
    });
    const groups = new Map<string, string[]>();
    for (const { id, language } of accounts) {
      groups.set(language, [...(groups.get(language) ?? []), id]);
    }
    return groups;
  }
}

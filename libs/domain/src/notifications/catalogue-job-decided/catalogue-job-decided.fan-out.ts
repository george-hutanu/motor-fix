import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';
import { isUUID } from 'class-validator';

import type { PrismaClient } from '../../generated/prisma/client';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const CATALOGUE_JOB_DECIDED_QUEUE = 'catalogue-job-decided';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const CATALOGUE_JOB_DECIDED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const CATALOGUE_JOB_DECIDED_CONSUMER = {
  jobs: CATALOGUE_JOB_DECIDED_RUN,
  kinds: ['catalogue_job.decided'] as readonly EventKind[],
  queue: CATALOGUE_JOB_DECIDED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface CatalogueJobDecidedEvent {
  id: string;
  // Unchecked: the relay passes the payload through as recorded.
  payload: { jobTypeId?: unknown };
}

interface Decided {
  nameEn: string;
  nameRo: string;
  rejectionReason: string | null;
  status: string;
}

// Tells the owner of the garage that proposed a job what an admin decided,
// in their own language. The decision, the names and the reason are read
// from the job, so one still pending tells nobody, and so does one whose
// garage is gone; the event id keeps a retry from building anything twice.
@Injectable()
export class CatalogueJobDecidedFanOut {
  private readonly logger = new Logger('CatalogueJobs');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(
    job: Pick<Job<CatalogueJobDecidedEvent>, 'data'>,
  ): Promise<void> {
    const { id: eventId, payload } = job.data;
    const { jobTypeId } = payload;
    if (typeof jobTypeId !== 'string' || !isUUID(jobTypeId)) {
      this.untold('?');
      return;
    }
    const decided = await this.prisma.jobType.findFirst({
      select: {
        nameEn: true,
        nameRo: true,
        proposedByGarageId: true,
        rejectionReason: true,
        status: true,
      },
      where: { id: jobTypeId, status: { in: ['approved', 'rejected'] } },
    });
    const garageId = decided?.proposedByGarageId;
    const owners = garageId ? await this.owners(garageId) : [];
    if (!decided || !garageId || owners.length === 0) {
      this.untold(jobTypeId);
      return;
    }
    const { status: decision } = decided;
    for (const language of ['ro', 'en'] as const) {
      const recipients = owners
        .filter((owner) => (owner.language === 'en') === (language === 'en'))
        .map(({ id }) => id);
      if (recipients.length === 0) continue;
      await this.notifications.notify({
        eventId,
        garageId,
        kind: 'CATALOGUE_JOB_DECIDED',
        params: this.params(decided, language),
        recipients,
        subjectId: jobTypeId,
      });
    }
    this.logger.log(
      `catalogue job ${jobTypeId} ${decision}: told to ${owners.length} owners`,
    );
  }

  // The job in the owner's language; a rejection also carries its reason.
  private params(decided: Decided, language: 'en' | 'ro') {
    return {
      decision: decided.status,
      job: language === 'en' ? decided.nameEn : decided.nameRo,
      prices: `${this.config.webUrl}/app/garage/prices`,
      ...(decided.status === 'rejected' && {
        reason: decided.rejectionReason ?? '',
      }),
    };
  }

  // The garage's owners whose accounts still stand.
  private owners(garageId: string) {
    return this.prisma.account.findMany({
      select: { id: true, language: true },
      where: {
        memberships: { some: { garageId, role: 'owner' } },
        status: { not: 'deleted' },
      },
    });
  }

  private untold(jobTypeId: string): void {
    this.logger.log(`catalogue job ${jobTypeId} decided: nobody told`);
  }
}

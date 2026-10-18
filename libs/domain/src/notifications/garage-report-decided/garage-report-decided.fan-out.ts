import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';
import { isUUID } from 'class-validator';

import type { PrismaClient } from '../../generated/prisma/client';
import { countReportDecidedNotice } from '../../metrics/product-counters';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';
import { REPORT_DECISIONS } from '../templates/garage-report-decided';

export const GARAGE_REPORT_DECIDED_QUEUE = 'garage-report-decided';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const GARAGE_REPORT_DECIDED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const GARAGE_REPORT_DECIDED_CONSUMER = {
  jobs: GARAGE_REPORT_DECIDED_RUN,
  kinds: ['garage_report.decided'] as readonly EventKind[],
  queue: GARAGE_REPORT_DECIDED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface GarageReportDecidedEvent {
  id: string;
  // Unchecked: the relay passes the payload through as recorded.
  payload: { decision?: unknown; garageId?: unknown; reporterIds?: unknown };
}

// Tells each driver who reported a garage what MotorFix made of it, in their
// own language and by the channels they chose. The event carries ids only;
// the garage's name and profile are read here, and the event id keeps a
// retry from building anything twice. The garage's own people hear nothing
// from this: a suspension tells them itself.
@Injectable()
export class GarageReportDecidedFanOut {
  private readonly logger = new Logger('GarageReports');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(
    job: Pick<Job<GarageReportDecidedEvent>, 'data'>,
  ): Promise<void> {
    const { id: eventId, payload } = job.data;
    const { decision, garageId, reporterIds } = payload;
    if (
      typeof garageId !== 'string' ||
      !isUUID(garageId) ||
      !REPORT_DECISIONS.has(decision) ||
      !Array.isArray(reporterIds)
    ) {
      this.untold(garageId);
      return;
    }
    const garage = await this.prisma.garage.findUnique({
      select: { name: true, slug: true },
      where: { id: garageId },
    });
    // Anything but an account id is left out, never looked up.
    const ids = reporterIds.filter(
      (id): id is string => typeof id === 'string' && isUUID(id),
    );
    const reporters = garage ? await this.reporters(ids) : new Map();
    if (!garage || reporters.size === 0) {
      this.untold(garageId);
      return;
    }
    let told = 0;
    for (const [language, people] of reporters) {
      const path = language === 'en' ? 'en' : 'ro';
      await this.notifications.notify({
        eventId,
        kind: 'GARAGE_REPORT_DECIDED',
        params: {
          decision,
          garage: garage.name,
          profile: `${this.config.webUrl}/${path}/garages/${garage.slug}`,
        },
        recipients: people,
        subjectId: garageId,
      });
      told += people.length;
    }
    countReportDecidedNotice('built');
    this.logger.log(
      `garage ${garageId} reports ${String(decision)} told to ${told} reporters`,
    );
  }

  private untold(garageId: unknown): void {
    countReportDecidedNotice('skipped');
    this.logger.log(
      `garage ${typeof garageId === 'string' ? garageId : '?'} reports decided: nobody told`,
    );
  }

  // The distinct reporters whose accounts still stand, by language.
  private async reporters(ids: string[]): Promise<Map<string, string[]>> {
    const accounts = await this.prisma.account.findMany({
      select: { id: true, language: true },
      where: { id: { in: [...new Set(ids)] }, status: { not: 'deleted' } },
    });
    const groups = new Map<string, string[]>();
    for (const { id, language } of accounts) {
      groups.set(language, [...(groups.get(language) ?? []), id]);
    }
    return groups;
  }
}

import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import { loadGarageAccess } from '../../events/garage-access';
import type { PrismaClient } from '../../generated/prisma/client';
import { countRequestReceived } from '../../metrics/product-counters';
import { firstLine } from '../../quotes/reads';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';

export const REQUEST_RECEIVED_QUEUE = 'request-received';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const REQUEST_RECEIVED_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const REQUEST_RECEIVED_CONSUMER = {
  jobs: REQUEST_RECEIVED_RUN,
  kinds: ['request.created'] as readonly EventKind[],
  queue: REQUEST_RECEIVED_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface RequestCreatedEvent {
  id: string;
  payload: { requestId: string };
}

// A request with no job is named by its description's first line, cut short
// so the rest of what the driver wrote stays on the request page.
const JOB_NAME_LENGTH = 40;

// Tells each garage's staff who may answer quotes that a request arrived.
// The service applies each person's mute for that garage, the garage's
// WhatsApp switch, the no-device fallback and the never-SMS rule; the outbox
// event id keeps a retry or a second relay from building anything twice.
@Injectable()
export class RequestReceivedFanOut {
  private readonly logger = new Logger('RequestReceived');
  private readonly access: ReturnType<typeof loadGarageAccess>;

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {
    this.access = loadGarageAccess(prisma);
  }

  async handle(job: Pick<Job<RequestCreatedEvent>, 'data'>): Promise<void> {
    const { id: eventId, payload } = job.data;
    const request = await this.prisma.quoteRequest.findUnique({
      select: {
        carBrand: true,
        carModel: true,
        description: true,
        jobs: {
          orderBy: { position: 'asc' },
          select: { jobType: { select: { nameEn: true, nameRo: true } } },
          take: 1,
        },
        recipients: {
          select: {
            garage: { select: { status: true } },
            garageId: true,
            status: true,
          },
        },
      },
      where: { id: payload.requestId },
    });
    if (!request) return;
    const [first] = request.jobs;
    const described = firstLine(request.description?.trim() || null);
    const jobName = (language: string) =>
      first
        ? language === 'en'
          ? first.jobType.nameEn
          : first.jobType.nameRo
        : (described ?? '').slice(0, JOB_NAME_LENGTH);
    const car = `${request.carBrand} ${request.carModel}`;
    const link = `${this.config.webUrl}/app/garage/requests`;
    let told = 0;
    for (const recipient of request.recipients) {
      if (
        recipient.garage.status === 'suspended' ||
        recipient.status !== 'waiting'
      ) {
        countRequestReceived('skipped');
        continue;
      }
      const staff = await this.staff(recipient.garageId);
      let queued = 0;
      for (const [language, people] of await this.byLanguage(staff)) {
        queued += await this.notifications.notify({
          eventId,
          garageId: recipient.garageId,
          kind: 'REQUEST_RECEIVED',
          params: { car, job: jobName(language), link },
          recipients: people,
          subjectId: payload.requestId,
        });
      }
      told += staff.length;
      // Nothing queued: everyone who may answer muted it, or nobody may.
      countRequestReceived(queued > 0 ? 'built' : 'muted');
    }
    this.logger.log(`request ${payload.requestId} announced to ${told} staff`);
  }

  private async staff(garageId: string): Promise<string[]> {
    const { mechanics, owners, receptionists } = await this.access(garageId);
    const answering = [...mechanics]
      .filter(([, permissions]) => permissions.canAnswerQuotes)
      .map(([accountId]) => accountId);
    return [...new Set([...owners, ...receptionists, ...answering])];
  }

  private async byLanguage(
    accountIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const accounts = await this.prisma.account.findMany({
      select: { id: true, language: true },
      where: { id: { in: [...accountIds] } },
    });
    const groups = new Map<string, string[]>();
    for (const { id, language } of accounts) {
      groups.set(language, [...(groups.get(language) ?? []), id]);
    }
    return groups;
  }
}

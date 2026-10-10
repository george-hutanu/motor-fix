import type { EventKind } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

import type { PrismaClient } from '../../generated/prisma/client';
import { countVerificationResult } from '../../metrics/product-counters';
import type { EmailConfig } from '../email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from '../notifications.service';
import { DECISIONS, reasonLabel } from '../templates/verification-result';

export const VERIFICATION_RESULT_QUEUE = 'verification-result';

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const VERIFICATION_RESULT_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

// No requeue: a job an emptied Redis lost is one message lost, not a run.
export const VERIFICATION_RESULT_CONSUMER = {
  jobs: VERIFICATION_RESULT_RUN,
  kinds: ['verification.decided'] as readonly EventKind[],
  queue: VERIFICATION_RESULT_QUEUE,
};

// A job as the relay queues it: `id` is the outbox event's.
export interface VerificationDecidedEvent {
  id: string;
  payload: { decision?: string; fileId: string; garageId: string };
}

// Tells a garage's owners how its verification was decided, each in their
// own language. The service sends the e-mail and the bell whatever they
// muted, and applies the device and WhatsApp rules; the outbox event id keeps
// a retry or a second relay from building anything twice. The file is read,
// never written.
@Injectable()
export class VerificationResultFanOut {
  private readonly logger = new Logger('VerificationResult');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async handle(
    job: Pick<Job<VerificationDecidedEvent>, 'data'>,
  ): Promise<void> {
    const { id: eventId, payload } = job.data;
    const { decision = '', fileId, garageId } = payload;
    // The file must be the named garage's: its owners are the ones told, and
    // its reason and note are what they read.
    const file =
      DECISIONS.has(decision) &&
      typeof fileId === 'string' &&
      typeof garageId === 'string'
        ? await this.prisma.verificationFile.findFirst({
            select: {
              garage: { select: { slug: true } },
              reasonCode: true,
              reasonNote: true,
            },
            where: { garageId, id: fileId },
          })
        : null;
    const owners = file ? await this.owners(garageId) : new Map();
    if (!file || owners.size === 0) {
      countVerificationResult('skipped');
      this.logger.log(`verification file ${fileId} ${decision}: nobody told`);
      return;
    }
    let told = 0;
    for (const [language, people] of owners) {
      const params = this.params(decision, language, file);
      await this.notifications.notify({
        eventId,
        garageId,
        kind: 'VERIFICATION_RESULT',
        params,
        recipients: people,
        subjectId: fileId,
      });
      told += people.length;
    }
    countVerificationResult('built');
    this.logger.log(
      `verification file ${fileId} ${decision} told to ${told} owners`,
    );
  }

  // What the template fills in: the dashboard link for every decision, the
  // public profile for an approval, the reason and the admin's note otherwise.
  private params(
    decision: string,
    language: string,
    file: {
      garage: { slug: string };
      reasonCode: string | null;
      reasonNote: string | null;
    },
  ): Record<string, string> {
    const link = `${this.config.webUrl}/app/garage`;
    if (decision === 'approved') {
      const path = language === 'en' ? 'en' : 'ro';
      return {
        decision,
        link,
        profile: `${this.config.webUrl}/${path}/garages/${file.garage.slug}`,
      };
    }
    return {
      decision,
      link,
      note: file.reasonNote ?? '',
      reason: reasonLabel(file.reasonCode, language),
    };
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

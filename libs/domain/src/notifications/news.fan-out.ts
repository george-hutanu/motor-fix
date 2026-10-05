import type { SendNewsDto } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JobsOptions } from 'bullmq';

import type { EmailConfig } from './email-config';
import { newsLinks, unsubscribeToken } from './news';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from './notifications.service';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import type { Actor } from '../auth/policy';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

export const NEWS_QUEUE = 'news';
export const NEWS_JOBS = Symbol('NEWS_JOBS');
// The key the unsubscribe links are signed with: the API's token secret.
export const NEWS_TOKEN_SECRET = Symbol('NEWS_TOKEN_SECRET');

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later. The
// job is removed once it has run or failed for good, so a month given back
// can be sent again under the same id.
export const NEWS_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export interface NewsRun extends Pick<SendNewsDto, 'text' | 'title'> {
  month: string;
  sentBy: Pick<Actor, 'accountId' | 'role'>;
}

interface Attempt {
  data: NewsRun;
  attemptsMade: number;
  opts: { attempts?: number };
}

// News is for drivers: another role gets it only as a driver who consented.
export const CONSENTING_DRIVERS: Prisma.NotificationPreferenceWhereInput = {
  account: {
    roles: { some: { role: 'driver' } },
    status: { not: 'deleted' },
  },
  consentGivenAt: { not: null },
  enabled: true,
  garageId: null,
  type: 'NEWS',
  withdrawnAt: null,
};

export async function giveMonthBack(
  prisma: PrismaClient,
  audit: AuditPort,
  month: string,
  by: NewsRun['sentBy'],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.newsSend.deleteMany({ where: { month } });
    await audit.record(tx, {
      action: 'delete',
      actorId: by.accountId,
      actorRole: by.role,
      oldValue: { month },
      subjectId: by.accountId,
      subjectType: 'news_send',
    });
  });
}

// The month's run, in the worker. A retry skips the drivers it already
// reached, as the pipeline writes one message per event and person; the
// drivers are read when it runs, so one who withdrew since gets nothing.
@Injectable()
export class NewsFanOut {
  private readonly logger = new Logger('News');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
    @Inject(NEWS_TOKEN_SECRET) private readonly tokenSecret: string,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  async handle({ data }: Pick<Attempt, 'data'>): Promise<void> {
    const webUrl = this.config.webUrl;
    if (!webUrl) throw new Error('PUBLIC_WEB_URL is needed to send news');
    const rows = await this.prisma.notificationPreference.findMany({
      select: { account: { select: { id: true, language: true } } },
      where: CONSENTING_DRIVERS,
    });
    for (const { account } of rows) {
      await this.notifications.notify({
        eventId: `news:${data.month}`,
        kind: 'NEWS',
        params: {
          text: data.text[account.language],
          title: data.title[account.language],
          ...newsLinks(
            webUrl,
            account.language,
            unsubscribeToken(account.id, this.tokenSecret),
          ),
        },
        recipients: [account.id],
        subjectId: account.id,
      });
    }
    this.logger.log(`news for ${data.month} sent to ${rows.length} drivers`);
  }

  // After the last attempt the month is given back for the admin to send again.
  async failed(job: Attempt, error: Error): Promise<void> {
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const { month, sentBy } = job.data;
    this.logger.error(
      `news for ${month} failed for good (${error.message}); the month is free`,
    );
    await giveMonthBack(this.prisma, this.audit, month, sentBy);
  }
}

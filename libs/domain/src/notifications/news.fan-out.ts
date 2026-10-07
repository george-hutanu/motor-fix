import type { EventKind, SendNewsDto } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobsOptions } from 'bullmq';

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
// The key the unsubscribe links are signed with: the API's token secret.
export const NEWS_TOKEN_SECRET = Symbol('NEWS_TOKEN_SECRET');

// A failed run is tried 5 more times, 1, 2, 4, 8 and 16 minutes later, and
// removed once it has run or failed for good.
const NEWS_RUN: JobsOptions = {
  attempts: 6,
  backoff: { delay: 60_000, type: 'exponential' },
  removeOnComplete: true,
  removeOnFail: true,
};

export interface NewsRun extends Pick<SendNewsDto, 'text' | 'title'> {
  month: string;
  sentBy: Pick<Actor, 'accountId' | 'role'>;
}

// A run relayed this long ago whose month has not run is taken as lost.
const STRANDED_MS = 5 * 60_000;

// A claimed month whose run has not completed has its event relayed again,
// so a job an emptied Redis lost is queued again from the outbox. While the
// job is still in Redis (waiting, delayed or running) the relay's add of the
// same job id changes nothing; a run that reaches a driver twice sends once,
// as the pipeline keeps one message per event and person.
export function requeueStrandedNews(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE outbox_event e SET relayed_at = NULL
    FROM news_send s
    WHERE e.kind = 'news.sent' AND e.subject_id = s.month
      AND s.ran_at IS NULL
      AND e.relayed_at < ${new Date(now.getTime() - STRANDED_MS)}`;
}

// The send saves its run as a `news.sent` outbox event with the month's
// claim; the worker's relay queues it, and queues it again while the month
// has not run, so emptying Redis loses no run.
export const NEWS_CONSUMER = {
  jobs: NEWS_RUN,
  kinds: ['news.sent'] as readonly EventKind[],
  queue: NEWS_QUEUE,
  requeue: requeueStrandedNews,
};

// A job as the relay queues it: the event, its payload the run.
export interface NewsEvent {
  payload: NewsRun;
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

async function giveMonthBack(
  prisma: PrismaClient,
  audit: AuditPort,
  month: string,
  by: NewsRun['sentBy'],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.newsSend.deleteMany({ where: { month } });
    if (count === 0) return;
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

  // A failure on the last attempt gives the month back for the admin to send
  // again, before the queue drops the job.
  async handle(
    job: Pick<Job<NewsEvent>, 'attemptsMade' | 'data' | 'opts'>,
  ): Promise<void> {
    try {
      await this.run(job.data.payload);
    } catch (error) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        const { month, sentBy } = job.data.payload;
        this.logger.error(
          `news for ${month} failed for good (${(error as Error).message}); the month is free`,
        );
        await giveMonthBack(this.prisma, this.audit, month, sentBy).catch(
          (e: Error) =>
            this.logger.error(
              `news for ${month} was not given back (${e.message}); free the month by hand`,
            ),
        );
      }
      throw error;
    }
  }

  private async run(data: NewsRun): Promise<void> {
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
    await this.prisma.newsSend.updateMany({
      data: { ranAt: new Date() },
      where: { month: data.month },
    });
    this.logger.log(`news for ${data.month} sent to ${rows.length} drivers`);
  }
}

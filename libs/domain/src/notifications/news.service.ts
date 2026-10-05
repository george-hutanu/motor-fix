import type { NewsSentDto, SendNewsDto } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import type { EmailConfig } from './email-config';
import { newsLinks, unsubscribedAccount, unsubscribeToken } from './news';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
} from './notifications.service';
import { withdrawn } from './preferences';
import { smsMonth } from './sms-counter';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { AUTH_OPTIONS, type AuthOptions } from '../auth/actor.guard';
import type { Actor } from '../auth/policy';
import { Prisma, type PrismaClient } from '../generated/prisma/client';

const invalidLink = () =>
  new HttpException(
    {
      code: 'invalid_unsubscribe_link',
      message: 'This unsubscribe link is not valid',
    },
    HttpStatus.BAD_REQUEST,
  );

const taken = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class NewsService {
  private readonly logger = new Logger('News');
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
    @Inject(AUTH_OPTIONS) private readonly auth: AuthOptions,
    private readonly notifications: NotificationsService,
  ) {}

  // No session: the link is the proof. An account with nothing to withdraw
  // answers like a success, so the route never tells whether it exists.
  async unsubscribe(token: string | undefined): Promise<void> {
    const accountId =
      typeof token === 'string'
        ? unsubscribedAccount(token, this.auth.tokenSecret)
        : null;
    if (!accountId) throw invalidLink();
    const at = this.now();
    await this.prisma.$transaction(async (tx) => {
      // The same lock as a preferences save, so the two never interleave.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`preferences:${accountId}`}))`;
      const row = await tx.notificationPreference.findFirst({
        where: { accountId, garageId: null, type: 'NEWS' },
      });
      if (!row?.enabled || !row.consentGivenAt || row.withdrawnAt) return;
      await tx.notificationPreference.update({
        data: { enabled: false, ...withdrawn(row, at) },
        where: { id: row.id },
      });
      // A news e-mail still waiting (for 08:00, say) does not go either.
      await tx.notification.updateMany({
        data: { failure: 'unsubscribed', status: 'failed' },
        where: {
          accountId,
          channel: 'email',
          kind: 'NEWS',
          status: { in: ['queued', 'held'] },
        },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: null,
        actorRole: 'system',
        field: 'news_consent',
        newValue: { state: 'withdrawn', via: 'link' },
        oldValue: 'given',
        subjectId: accountId,
        subjectType: 'notification_preference',
      });
    });
  }

  // The month is claimed first: a second send in the month, or one racing
  // this one, is refused before anything goes. A send that fails part-way
  // gives the month back; a retry skips the drivers it already reached, as
  // the pipeline writes one message per event and person.
  async send(actor: Actor, body: SendNewsDto): Promise<NewsSentDto> {
    const webUrl = this.config.webUrl;
    if (!webUrl) throw new Error('PUBLIC_WEB_URL is needed to send news');
    const month = smsMonth(this.now());
    const drivers = await this.consentingDrivers();
    await this.claim(actor, month, drivers.length);
    try {
      for (const { id, language } of drivers) {
        await this.notifications.notify({
          eventId: `news:${month}`,
          kind: 'NEWS',
          params: {
            text: body.text[language],
            title: body.title[language],
            ...newsLinks(
              webUrl,
              language,
              unsubscribeToken(id, this.auth.tokenSecret),
            ),
          },
          recipients: [id],
          subjectId: id,
        });
      }
    } catch (error) {
      await this.release(actor, month);
      throw error;
    }
    this.logger.log(`news for ${month} sent to ${drivers.length} drivers`);
    return { recipients: drivers.length };
  }

  private async claim(actor: Actor, month: string, recipients: number) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.newsSend.create({
          data: { month, recipients, sentById: actor.accountId },
        });
        await this.audit.record(tx, {
          action: 'create',
          actorId: actor.accountId,
          actorRole: actor.role,
          newValue: { month, recipients },
          subjectId: actor.accountId,
          subjectType: 'news_send',
        });
      });
    } catch (error) {
      if (!taken(error)) throw error;
      throw new HttpException(
        {
          code: 'news_already_sent_this_month',
          message: 'MotorFix news already went out this month',
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  private async release(actor: Actor, month: string) {
    this.logger.error(`news for ${month} failed part-way; the month is free`);
    await this.prisma.$transaction(async (tx) => {
      await tx.newsSend.delete({ where: { month } });
      await this.audit.record(tx, {
        action: 'delete',
        actorId: actor.accountId,
        actorRole: actor.role,
        oldValue: { month },
        subjectId: actor.accountId,
        subjectType: 'news_send',
      });
    });
  }

  // News is for drivers: another role gets it only as a driver who consented.
  private async consentingDrivers() {
    const rows = await this.prisma.notificationPreference.findMany({
      select: { account: { select: { id: true, language: true } } },
      where: {
        account: {
          roles: { some: { role: 'driver' } },
          status: { not: 'deleted' },
        },
        consentGivenAt: { not: null },
        enabled: true,
        garageId: null,
        type: 'NEWS',
        withdrawnAt: null,
      },
    });
    return rows.map((r) => r.account);
  }
}

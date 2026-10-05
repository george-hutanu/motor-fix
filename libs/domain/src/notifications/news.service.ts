import type { NewsSentDto, SendNewsDto } from '@motor-fix/contracts';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import { unsubscribedAccount } from './news';
import { CONSENTING_DRIVERS, type NewsRun } from './news.fan-out';
import { NOTIFICATIONS_PRISMA } from './notifications.service';
import { withdrawn } from './preferences';
import { smsMonth } from './sms-counter';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { AUTH_OPTIONS, type AuthOptions } from '../auth/actor.guard';
import type { Actor } from '../auth/policy';
import { outbox } from '../events/event.port';
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
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(AUTH_OPTIONS) private readonly auth: AuthOptions,
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
  // this one, is refused before anything goes. The drivers are reached by
  // the month's run in the worker, which the queue retries by itself.
  async send(actor: Actor, body: SendNewsDto): Promise<NewsSentDto> {
    const month = smsMonth(this.now());
    const recipients = await this.prisma.notificationPreference.count({
      where: CONSENTING_DRIVERS,
    });
    await this.claim(actor, recipients, {
      month,
      sentBy: { accountId: actor.accountId, role: actor.role },
      text: body.text,
      title: body.title,
    });
    return { recipients };
  }

  // The run is saved with the claim, as the event the worker's relay queues.
  private async claim(actor: Actor, recipients: number, run: NewsRun) {
    const { month } = run;
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
        await outbox.record(tx, {
          audience: { type: 'platform' },
          kind: 'news.sent',
          payload: { ...run },
          subjectId: month,
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
}

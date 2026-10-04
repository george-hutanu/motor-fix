import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  ASK_WINDOW_SECONDS,
  confirmLink,
  hashToken,
  LINK_TTL_MS,
  newToken,
  overLimit,
} from './email-confirmation';
import { PRISMA } from './prisma';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { LIVE_CHANNEL } from '../events/live.hub';
import type { PrismaClient } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

export const CONFIRMATION_OPTIONS = Symbol('EMAIL_CONFIRMATION_OPTIONS');
export const CONFIRMATION_REDIS = Symbol('EMAIL_CONFIRMATION_REDIS');

export interface ConfirmationOptions {
  // The web app the link opens; without it no link can be written.
  webUrl?: string;
}

const PURPOSE = 'email_confirm';

const refusal = (status: HttpStatus, code: string, message: string) =>
  new HttpException({ code, message }, status);

const expired = () =>
  refusal(
    HttpStatus.GONE,
    'link_expired',
    'This link has expired; ask for a new one',
  );

const alreadyConfirmed = () =>
  refusal(
    HttpStatus.CONFLICT,
    'email_already_confirmed',
    'This e-mail address is already confirmed',
  );

const askKey = (window: keyof typeof ASK_WINDOW_SECONDS, accountId: string) =>
  `auth:confirm:${window}:${accountId}`;

// The link that tells MotorFix an account's e-mail reaches its holder.
@Injectable()
export class EmailConfirmationService {
  private readonly logger = new Logger('EmailConfirmation');
  now = () => new Date();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    private readonly notifications: NotificationsService,
    @Inject(CONFIRMATION_OPTIONS) private readonly options: ConfirmationOptions,
    @Inject(CONFIRMATION_REDIS) private readonly redis: Redis,
  ) {}

  // A new link to the account's address, in its language; older unused
  // links stop working.
  async issue(accountId: string): Promise<void> {
    const { webUrl } = this.options;
    if (!webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    const { hash, token } = newToken();
    const expiresAt = new Date(this.now().getTime() + LINK_TTL_MS);
    const { language } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${PURPOSE}:${accountId}`}))`;
      const account = await tx.account.findUniqueOrThrow({
        select: { email: true, language: true },
        where: { id: accountId },
      });
      if (!account.email) throw new Error('the account has no e-mail');
      await tx.accountToken.deleteMany({
        where: { accountId, purpose: PURPOSE, usedAt: null },
      });
      await tx.accountToken.create({
        data: {
          accountId,
          email: account.email,
          expiresAt,
          purpose: PURPOSE,
          tokenHash: hash,
        },
      });
      return account;
    });
    await this.notifications.sendAccountEmail({
      accountId,
      link: confirmLink(webUrl, language, token),
      purpose: 'email_check',
    });
  }

  async confirm(token: string): Promise<void> {
    const at = this.now();
    const accountId = await this.prisma.$transaction(async (tx) => {
      const row = await this.find(tx, token);
      if (row.account.emailVerifiedAt) return null;
      if (row.usedAt || row.expiresAt <= at) throw expired();
      // Of two opens at once, the one that takes the token confirms; the
      // other finds it taken and answers as for a confirmed address.
      const { count } = await tx.accountToken.updateMany({
        data: { usedAt: at },
        where: { id: row.id, usedAt: null },
      });
      if (count === 0) return null;
      await tx.account.update({
        data: { emailVerifiedAt: at },
        where: { id: row.accountId },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: row.accountId,
        actorRole: row.account.lastRole,
        field: 'email_verified_at',
        newValue: at.toISOString(),
        oldValue: null,
        subjectId: row.accountId,
        subjectType: 'account',
      });
      return row.accountId;
    });
    if (accountId) await this.announce(accountId, at);
  }

  // From the expired page: the link proves its reader got a link for that
  // address, so no sign-in is asked.
  async askAgainByToken(token: string): Promise<void> {
    const row = await this.find(this.prisma, token);
    if (row.account.emailVerifiedAt) throw alreadyConfirmed();
    await this.askAgain(row.accountId);
  }

  async askAgainFor(accountId: string): Promise<void> {
    const account = await this.prisma.account.findUniqueOrThrow({
      select: { email: true, emailVerifiedAt: true },
      where: { id: accountId },
    });
    if (!account.email) {
      throw refusal(
        HttpStatus.CONFLICT,
        'no_email',
        'This account has no e-mail address',
      );
    }
    if (account.emailVerifiedAt) throw alreadyConfirmed();
    await this.askAgain(accountId);
  }

  // The token's row, when it still stands for its account's address.
  private async find(db: Pick<PrismaClient, 'accountToken'>, token: string) {
    const row = await db.accountToken.findUnique({
      include: {
        account: {
          select: {
            email: true,
            emailVerifiedAt: true,
            lastRole: true,
            status: true,
          },
        },
      },
      where: { tokenHash: hashToken(token) },
    });
    if (
      !row ||
      row.purpose !== PURPOSE ||
      row.account.status !== 'active' ||
      row.account.email !== row.email
    ) {
      throw expired();
    }
    return row;
  }

  // Only a link actually sent counts against the limit.
  private async askAgain(accountId: string) {
    if (overLimit(await this.asked(accountId))) {
      throw refusal(
        HttpStatus.TOO_MANY_REQUESTS,
        'too_many_attempts',
        'A link was asked for too often; try again later',
      );
    }
    await this.issue(accountId);
    await this.count(accountId);
  }

  private async asked(accountId: string) {
    try {
      const [minute, hour] = await this.redis.mget(
        askKey('minute', accountId),
        askKey('hour', accountId),
      );
      return { hour: Number(hour), minute: Number(minute) };
    } catch {
      this.logger.warn('confirmation link limit skipped: Redis unavailable');
      return { hour: 0, minute: 0 };
    }
  }

  private async count(accountId: string) {
    const counts = this.redis.multi();
    for (const window of ['minute', 'hour'] as const) {
      const key = askKey(window, accountId);
      counts.incr(key).expire(key, ASK_WINDOW_SECONDS[window], 'NX');
    }
    try {
      await counts.exec();
    } catch {
      this.logger.warn('confirmation link not counted: Redis unavailable');
    }
  }

  private async announce(accountId: string, at: Date) {
    const message = {
      audience: [`account:${accountId}`],
      event: {
        at: at.toISOString(),
        id: accountId,
        kind: 'account.email_confirmed',
      },
    };
    try {
      await this.redis.publish(LIVE_CHANNEL, JSON.stringify(message));
    } catch {
      this.logger.warn('e-mail confirmation not announced: Redis unavailable');
    }
  }
}

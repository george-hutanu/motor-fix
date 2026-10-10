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
  CONFIRMATION_OPTIONS,
  type ConfirmationOptions,
  confirmLink,
  hashToken,
  LINK_TTL_MS,
  newToken,
  overLimit,
} from './email-confirmation';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import { LIVE_CHANNEL } from '../../events/live/live.hub';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { countAccountChange } from '../../metrics/product-counters';
import { NotificationsService } from '../../notifications/notifications.service';
import { Attempts, AUTH_REDIS } from '../attempts';
import {
  EmailChangeService,
  emailTaken,
} from '../email-change/email-change.service';
import { PRISMA } from '../prisma';

const PURPOSE = 'email_confirm';
const CHANGE = 'email_change';

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

const tooMany = () =>
  refusal(
    HttpStatus.TOO_MANY_REQUESTS,
    'too_many_attempts',
    'A link was asked for too often; try again later',
  );

const WINDOWS = ['minute', 'hour'] as const;

const askKey = (window: keyof typeof ASK_WINDOW_SECONDS, accountId: string) =>
  `auth:confirm:${window}:${accountId}`;

type Found = Prisma.AccountTokenGetPayload<{
  include: {
    account: {
      select: {
        email: true;
        emailVerifiedAt: true;
        lastRole: true;
        status: true;
      };
    };
  };
}>;

// The link that tells MotorFix an account's e-mail reaches its holder, and
// the link that moves it to a new address.
@Injectable()
export class EmailConfirmationService {
  private readonly logger = new Logger('EmailConfirmation');
  now = () => new Date();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    private readonly notifications: NotificationsService,
    @Inject(CONFIRMATION_OPTIONS) private readonly options: ConfirmationOptions,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly changes: EmailChangeService,
    private readonly attempts: Attempts,
  ) {}

  // A new link to the account's address, in its language; older unused
  // links expire now, and still lead their reader to ask for a new one.
  async issue(accountId: string): Promise<void> {
    const { webUrl } = this.options;
    if (!webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    const { hash, token } = newToken();
    const at = this.now();
    const expiresAt = new Date(at.getTime() + LINK_TTL_MS);
    const { language } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${PURPOSE}:${accountId}`}))`;
      const account = await tx.account.findUniqueOrThrow({
        select: { email: true, language: true },
        where: { id: accountId },
      });
      if (!account.email) throw new Error('the account has no e-mail');
      await tx.accountToken.updateMany({
        data: { expiresAt: at },
        where: {
          accountId,
          expiresAt: { gt: at },
          purpose: PURPOSE,
          usedAt: null,
        },
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
    let done: { accountId: string; email: boolean } | null;
    try {
      done = await this.prisma.$transaction(async (tx) => {
        const row = await this.find(tx, token);
        return row.purpose === CHANGE
          ? this.change(tx, row, at)
          : this.verify(tx, row, at);
      });
    } catch (error) {
      // Another account took the address between the check and the write.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw emailTaken();
      }
      throw error;
    }
    if (!done) return;
    if (done.email) countAccountChange('email');
    await this.announce(done.accountId, at);
  }

  private async verify(
    tx: Prisma.TransactionClient,
    row: Found,
    at: Date,
  ): Promise<{ accountId: string; email: false } | null> {
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
    return { accountId: row.accountId, email: false };
  }

  // A change link: the account takes the new address, confirmed by the
  // opening, and its password sign-in follows it.
  private async change(
    tx: Prisma.TransactionClient,
    row: Found,
    at: Date,
  ): Promise<{ accountId: string; email: true } | null> {
    // Opened again after it worked: the address is already the account's.
    if (row.usedAt && row.account.email === row.email) return null;
    if (row.usedAt || row.expiresAt <= at) throw expired();
    if (await this.changes.taken(row.email, row.accountId)) throw emailTaken();
    const { count } = await tx.accountToken.updateMany({
      data: { usedAt: at },
      where: { id: row.id, usedAt: null },
    });
    if (count === 0) return null;
    await tx.account.update({
      data: { email: row.email, emailVerifiedAt: at },
      where: { id: row.accountId },
    });
    await tx.accountIdentity.updateMany({
      data: { subject: row.email },
      where: { accountId: row.accountId, method: 'password' },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: row.accountId,
      actorRole: row.account.lastRole,
      field: 'email',
      newValue: row.email,
      oldValue: row.account.email,
      subjectId: row.accountId,
      subjectType: 'account',
    });
    await this.events.record(tx, {
      audience: { accountId: row.accountId, type: 'account' },
      kind: 'account.updated',
      payload: { accountId: row.accountId, fields: ['email'] },
      subjectId: row.accountId,
    });
    return { accountId: row.accountId, email: true };
  }

  // From the expired page: the link proves its reader got a link for that
  // address, so no sign-in is asked.
  async askAgainByToken(token: string): Promise<void> {
    const row = await this.find(this.prisma, token);
    if (row.purpose === CHANGE) {
      // Only the latest change, not yet opened, and for an address still free.
      const latest = await this.prisma.accountToken.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        where: { accountId: row.accountId, purpose: CHANGE },
      });
      if (
        row.usedAt ||
        latest?.id !== row.id ||
        (await this.changes.taken(row.email, row.accountId))
      ) {
        throw expired();
      }
      await this.changes.resend(row.accountId, row.email);
      return;
    }
    if (row.account.emailVerifiedAt) throw alreadyConfirmed();
    await this.askAgain(row.accountId);
  }

  // A change that waits is sent again first; else the current address.
  async askAgainFor(accountId: string): Promise<void> {
    const pending = await this.changes.pending(accountId);
    if (pending) {
      await this.changes.resend(accountId, pending);
      return;
    }
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
    await this.askAgain(accountId, true);
  }

  // The token's row, when it still stands for its account's address, or for
  // the address a change asked for.
  private async find(
    db: Pick<PrismaClient, 'accountToken'>,
    token: string,
  ): Promise<Found> {
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
      row.account.status !== 'active' ||
      (row.purpose === PURPOSE
        ? row.account.email !== row.email
        : row.purpose !== CHANGE)
    ) {
      throw expired();
    }
    return row;
  }

  // Only a link actually sent counts against the limit. The ask is counted
  // first, so two at once cannot both pass, and taken back when refused or
  // not sent.
  // From the account's own panel the link also counts toward the hourly
  // limit it shares with e-mail and phone changes.
  private async askAgain(accountId: string, own = false) {
    if (!(await this.reserve(accountId))) throw tooMany();
    if (own && !(await this.attempts.admitContactChange(accountId))) {
      await this.release(accountId);
      throw tooMany();
    }
    try {
      await this.issue(accountId);
    } catch (error) {
      await this.release(accountId);
      throw error;
    }
  }

  private async reserve(accountId: string): Promise<boolean> {
    const counts = this.redis.multi();
    for (const window of WINDOWS) {
      const key = askKey(window, accountId);
      counts.incr(key).expire(key, ASK_WINDOW_SECONDS[window], 'NX');
    }
    let asked: { hour: number; minute: number };
    try {
      const replies = await counts.exec();
      // A refused EXPIRE would leave the key counting for ever.
      for (const [error] of replies ?? []) if (error) throw error;
      asked = {
        hour: Number(replies?.[2]?.[1]),
        minute: Number(replies?.[0]?.[1]),
      };
    } catch {
      this.logger.warn('confirmation link limit skipped: Redis unavailable');
      return true;
    }
    // The counts include this ask; the limit is on the ones before it.
    const before = { hour: asked.hour - 1, minute: asked.minute - 1 };
    if (!overLimit(before)) return true;
    await this.release(accountId);
    return false;
  }

  private async release(accountId: string) {
    const counts = this.redis.multi();
    for (const window of WINDOWS) {
      const key = askKey(window, accountId);
      counts.decr(key).expire(key, ASK_WINDOW_SECONDS[window], 'NX');
    }
    try {
      await counts.exec();
    } catch {
      this.logger.warn('confirmation link not uncounted: Redis unavailable');
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

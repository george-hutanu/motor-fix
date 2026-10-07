import {
  type BeforeApplicationShutdown,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { Attempts } from './attempts';
import { hashToken, newToken } from './email-confirmation';
import { MAINTENANCE, type Maintenance } from './maintenance';
import { hashPassword } from './password';
import { roleInUse } from './policy';
import { PRISMA } from './prisma';
import { type Issued, SignInService } from './sign-in.service';
import { refusal, weakPassword } from './sign-up.service';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

export const RESET_OPTIONS = Symbol('PASSWORD_RESET_OPTIONS');

export interface ResetOptions {
  // The web app the link opens; without it no link can be written.
  webUrl?: string;
}

const PURPOSE = 'password_reset';
const LINK_TTL_MS = 60 * 60 * 1000;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const invalid = () =>
  refusal(HttpStatus.GONE, 'token_invalid', 'This link does not work');
const expired = () =>
  refusal(
    HttpStatus.GONE,
    'token_expired',
    'This link has expired; ask for a new one',
  );

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// What failed, never its message: a driver's or a database's message can
// carry the address the link was asked for.
const kindOf = (error: unknown) => {
  if (!(error instanceof Error)) return 'unknown error';
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? `${error.name} ${code}` : error.name;
};

// "Ai uitat parola?": a 60-minute, single-use link to the account's address,
// then a new password that ends every other session.
@Injectable()
export class PasswordResetService implements BeforeApplicationShutdown {
  private readonly logger = new Logger('PasswordReset');
  private readonly issuing = new Set<Promise<void>>();
  now = () => new Date();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly notifications: NotificationsService,
    private readonly attempts: Attempts,
    private readonly signIns: SignInService,
    @Inject(MAINTENANCE) private readonly maintenance: Maintenance,
    @Inject(RESET_OPTIONS) private readonly options: ResetOptions,
  ) {}

  // Answers the same, and as fast, whatever happens, so nobody learns which
  // addresses have an account: the link is issued after the answer, and a
  // failure is only logged, without the address.
  async ask(input: string, address: string): Promise<void> {
    const email = input.trim().toLowerCase();
    if (!(await this.attempts.admitReset(email, address))) {
      this.logger.warn('password reset not sent: over the request limit');
      return;
    }
    const issuing = this.issue(email).catch((error: unknown) =>
      this.logger.error(`password reset link not sent: ${kindOf(error)}`),
    );
    this.issuing.add(issuing);
    issuing.then(() => this.issuing.delete(issuing));
  }

  // Settles once every link in flight is issued or has failed. The server
  // still answers while the app shuts down, so links asked for meanwhile are
  // waited for too, for a few rounds rather than forever.
  async drain(): Promise<void> {
    for (let round = 0; round < 3 && this.issuing.size > 0; round++) {
      await Promise.all(this.issuing);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  async check(token: string): Promise<void> {
    await this.usable(token, this.now());
  }

  async complete(token: string, password: string): Promise<Issued> {
    const at = this.now();
    const { row, role } = await this.usable(token, at);
    const { account } = row;
    const admin = account.roles.some((r) => r.role === 'admin');
    if (!admin && (await this.maintenance.on())) {
      throw refusal(
        HttpStatus.SERVICE_UNAVAILABLE,
        'maintenance',
        'MotorFix is down for maintenance',
      );
    }
    if (weakPassword(password)) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'weak_password',
        'Choose a password of 8 to 128 characters that is not a common one',
        [{ code: 'weak_password', field: 'password' }],
      );
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      // Of two saves of one link at once, the one that takes it wins.
      const { count } = await tx.accountToken.updateMany({
        data: { usedAt: at },
        where: { id: row.id, usedAt: null },
      });
      if (count === 0) throw expired();
      const replaced = await tx.accountIdentity.updateMany({
        data: { passwordHash },
        where: { accountId: account.id, method: 'password' },
      });
      if (replaced.count === 0) {
        await tx.accountIdentity.create({
          data: {
            accountId: account.id,
            method: 'password',
            passwordHash,
            subject: row.email,
          },
        });
      }
      await tx.refreshToken.deleteMany({ where: { accountId: account.id } });
      await this.audit.record(tx, {
        action: 'update',
        actorId: account.id,
        actorRole: role,
        field: 'password',
        kind: 'password_reset',
        subjectId: account.id,
        subjectType: 'account',
      });
      await this.events.record(tx, {
        audience: { accountId: account.id, type: 'account' },
        kind: 'account.password_reset',
        payload: { accountId: account.id },
        subjectId: account.id,
      });
    });
    this.logger.log('password reset');
    // Before the session: the password changed even if no session opens.
    await this.announce(account.id, account.language, at);
    return this.signIns.openSession(account.id, role, true);
  }

  // A new link; the account's older unused ones stop working.
  private async issue(email: string) {
    const account = await this.prisma.account.findUnique({
      select: { id: true, language: true, status: true },
      where: { email },
    });
    if (account?.status !== 'active') return;
    const { webUrl } = this.options;
    if (!webUrl) {
      this.logger.error(
        'password reset link not sent: PUBLIC_WEB_URL is not set',
      );
      return;
    }
    const { hash, token } = newToken();
    await this.prisma.$transaction([
      this.prisma.accountToken.deleteMany({
        where: { accountId: account.id, purpose: PURPOSE, usedAt: null },
      }),
      this.prisma.accountToken.create({
        data: {
          accountId: account.id,
          email,
          expiresAt: new Date(this.now().getTime() + LINK_TTL_MS),
          purpose: PURPOSE,
          tokenHash: hash,
        },
      }),
    ]);
    await this.notifications.sendAccountEmail({
      accountId: account.id,
      link: `${webUrl}/${account.language}/reset-password/${token}`,
      purpose: PURPOSE,
    });
  }

  // The token's row and the role it signs in with, when it would complete.
  private async usable(token: string, at: Date) {
    if (!TOKEN_SHAPE.test(token)) throw invalid();
    const row = await this.prisma.accountToken.findUnique({
      include: { account: { include: { roles: true } } },
      where: { tokenHash: hashToken(token) },
    });
    if (
      !row ||
      row.purpose !== PURPOSE ||
      row.account.status !== 'active' ||
      row.account.email !== row.email
    ) {
      throw invalid();
    }
    const role = roleInUse(
      null,
      row.account.lastRole,
      row.account.roles.map((r) => r.role),
    );
    if (!role) throw invalid();
    if (row.usedAt || row.expiresAt <= at) throw expired();
    return { role, row };
  }

  // The notice e-mail and the other tabs' sign-out; the reset stands without
  // either, so a failure is only logged.
  private async announce(accountId: string, language: string, at: Date) {
    const { webUrl } = this.options;
    try {
      if (!webUrl) throw new Error('PUBLIC_WEB_URL is not set');
      await this.notifications.sendAccountEmail({
        accountId,
        link: `${webUrl}/${language}`,
        purpose: 'password_changed',
      });
    } catch (error) {
      this.logger.error(`password changed e-mail not sent: ${reason(error)}`);
    }
    this.signIns.revokeSessionsLive(accountId, at);
  }
}

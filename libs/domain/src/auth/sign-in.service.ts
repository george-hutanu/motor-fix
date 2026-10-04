import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { signAccessToken } from './access-token';
import { AUTH_OPTIONS, type AuthOptions } from './actor.guard';
import { Attempts } from './attempts';
import type { Role } from './capabilities';
import { MAINTENANCE, type Maintenance } from './maintenance';
import { DECOY_HASH, verifyPassword } from './password';
import { type Actor, roleInUse } from './policy';
import { PRISMA } from './prisma';
import type { PrismaClient } from '../generated/prisma/client';

const DAY_MS = 86_400_000;
export const REMEMBERED_MS = 30 * DAY_MS;
const BROWSER_SESSION_MS = 12 * 3_600_000;
// Two tabs renewing at once present the same token; the later one is not theft.
const GRACE_MS = 20_000;
const ACTIVE_EVERY_MS = 3_600_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface Issued {
  accessToken: string;
  // Absent when the browser already holds the current refresh token.
  refreshToken?: string;
  remember: boolean;
}

const refusal = (status: HttpStatus, code: string, message: string) =>
  new HttpException({ code, message }, status);

const invalidCredentials = () =>
  refusal(
    HttpStatus.UNAUTHORIZED,
    'invalid_credentials',
    'The e-mail or password is not correct',
  );
const signInRequired = () =>
  refusal(HttpStatus.UNAUTHORIZED, 'sign_in_required', 'Sign in to continue');
const suspended = () =>
  refusal(
    HttpStatus.FORBIDDEN,
    'account_suspended',
    'This account is suspended',
  );

const hashOf = (token: string) =>
  createHash('sha256').update(token).digest('base64url');

const lifetime = (remember: boolean) =>
  remember ? REMEMBERED_MS : BROWSER_SESSION_MS;

@Injectable()
export class SignInService {
  private readonly logger = new Logger('SignIn');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
    @Inject(MAINTENANCE) private readonly maintenance: Maintenance,
    private readonly attempts: Attempts,
  ) {}

  async signIn(
    input: { email: string; password: string; remember?: boolean },
    address: string,
  ): Promise<Issued> {
    const email = input.email.trim().toLowerCase();
    if (await this.attempts.blocked(email, address)) {
      this.logger.warn('sign-in refused: too_many_attempts');
      throw refusal(
        HttpStatus.TOO_MANY_REQUESTS,
        'too_many_attempts',
        'Too many attempts; try again in 15 minutes',
      );
    }
    const found = await this.credentials(email, input.password);
    if (!found) {
      await this.attempts.fail(email, address);
      this.logger.warn('sign-in refused: invalid_credentials');
      throw invalidCredentials();
    }
    const { account, role } = found;
    if (account.status === 'suspended') throw suspended();
    const admin = account.roles.some((r) => r.role === 'admin');
    if (!admin && (await this.maintenance.on())) {
      throw refusal(
        HttpStatus.SERVICE_UNAVAILABLE,
        'maintenance',
        'MotorFix is down for maintenance',
      );
    }
    await this.attempts.clear(email);
    return this.openSession(account.id, role, input.remember ?? true);
  }

  // A new session: its access token, and the refresh token of a new family.
  async openSession(
    accountId: string,
    role: Role,
    remember: boolean,
  ): Promise<Issued> {
    return {
      accessToken: this.accessToken(accountId, role),
      refreshToken: await this.openFamily(accountId, remember),
      remember,
    };
  }

  // A view preference, not a change of rights: no audit entry. A role the
  // account does not hold does not exist for it.
  async switchRole(actor: Actor, role: Role): Promise<string> {
    if (!actor.roles.includes(role)) throw new NotFoundException();
    await this.prisma.account.update({
      data: { lastRole: role },
      where: { id: actor.accountId },
    });
    return this.accessToken(actor.accountId, role);
  }

  // `wanted`: the role the renewing tab shows, kept while the account holds it.
  async refresh(
    token: string | undefined,
    wanted: Role | null,
  ): Promise<Issued> {
    const row = await this.presented(token);
    const now = Date.now();
    if (!row || row.expiresAt.getTime() <= now) throw signInRequired();
    const inGrace = row.usedAt && now - row.usedAt.getTime() < GRACE_MS;
    if (row.usedAt && !inGrace) {
      await this.revoke(row.familyId);
      throw signInRequired();
    }
    const { account } = row;
    const accessToken = this.accessToken(
      account.id,
      await this.stillAllowed(row, wanted),
    );
    const next = inGrace ? null : await this.rotate(row, now);
    // In the grace, or another tab rotated it between the read and the write.
    if (!next) return { accessToken, remember: row.remember };
    const idle = now - (account.lastActiveAt?.getTime() ?? 0);
    if (idle >= ACTIVE_EVERY_MS) await this.touch(account.id, now);
    return { accessToken, refreshToken: next, remember: row.remember };
  }

  async signOut(token: string | undefined): Promise<void> {
    if (!token || !TOKEN.test(token)) return;
    const row = await this.prisma.refreshToken.findUnique({
      select: { familyId: true },
      where: { tokenHash: hashOf(token) },
    });
    if (row) await this.revoke(row.familyId);
  }

  private revoke(familyId: string) {
    return this.prisma.refreshToken.deleteMany({ where: { familyId } });
  }

  // The account and its role in use, when the password matches. The check
  // runs against a decoy when there is nothing to check, so every refusal
  // costs the same.
  private async credentials(email: string, password: string) {
    const account = await this.prisma.account.findUnique({
      include: { identities: { where: { method: 'password' } }, roles: true },
      where: { email },
    });
    const stored =
      account?.status === 'deleted'
        ? null
        : account?.identities[0]?.passwordHash;
    const matches = await verifyPassword(password, stored ?? DECOY_HASH);
    if (!account || !stored || !matches) return null;
    const role = roleInUse(
      null,
      account.lastRole,
      account.roles.map((r) => r.role),
    );
    return role ? { account, role } : null;
  }

  private async openFamily(accountId: string, remember: boolean) {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          accountId,
          expiresAt: new Date(now.getTime() + lifetime(remember)),
          familyId: randomUUID(),
          remember,
          tokenHash: hashOf(token),
        },
      }),
      this.prisma.account.update({
        data: { lastActiveAt: now },
        where: { id: accountId },
      }),
    ]);
    return token;
  }

  // The role in use of an account that may still be signed in; otherwise the
  // family is closed.
  private async stillAllowed(
    row: {
      familyId: string;
      account: { lastRole: Role; status: string; roles: { role: Role }[] };
    },
    wanted: Role | null,
  ): Promise<Role> {
    const { account } = row;
    const role = roleInUse(
      wanted,
      account.lastRole,
      account.roles.map((r) => r.role),
    );
    if (account.status === 'active' && role) return role;
    await this.revoke(row.familyId);
    throw account.status === 'suspended' ? suspended() : signInRequired();
  }

  private presented(token: string | undefined) {
    if (!token || !TOKEN.test(token)) return Promise.resolve(null);
    return this.prisma.refreshToken.findUnique({
      include: { account: { include: { roles: true } } },
      where: { tokenHash: hashOf(token) },
    });
  }

  // Marks the token used and issues its successor; null when it was already
  // used by the time of the write.
  private rotate(
    row: { id: string; accountId: string; familyId: string; remember: boolean },
    now: number,
  ): Promise<string | null> {
    const next = randomBytes(32).toString('base64url');
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        data: { usedAt: new Date(now) },
        where: { id: row.id, usedAt: null },
      });
      if (count === 0) return null;
      await tx.refreshToken.create({
        data: {
          accountId: row.accountId,
          expiresAt: new Date(now + lifetime(row.remember)),
          familyId: row.familyId,
          remember: row.remember,
          tokenHash: hashOf(next),
        },
      });
      return next;
    });
  }

  private touch(accountId: string, now: number) {
    return this.prisma.account.update({
      data: { lastActiveAt: new Date(now) },
      where: { id: accountId },
    });
  }

  private accessToken(accountId: string, role: Role) {
    return signAccessToken({ accountId, role }, this.options.tokenSecret);
  }
}

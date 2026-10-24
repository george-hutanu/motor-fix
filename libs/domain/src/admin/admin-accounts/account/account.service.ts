import {
  ACCOUNT_ROLES,
  type AccessResetDto,
  type AdminAccountPageDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { AccountDeletionService } from '../../../auth/account-deletion/account-deletion.service';
import { revokeAssistantGrants } from '../../../auth/assistant-grants/assistant-grants';
import { PasswordResetService } from '../../../auth/password/password-reset/password-reset.service';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { SignInService } from '../../../auth/sign-in.service';
import { refusal } from '../../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type { PrismaClient } from '../../../generated/prisma/client';
import {
  type AdminAccountAction,
  type AdminAccountOutcome,
  countAdminAccountAction,
} from '../../../metrics/product-counters';
import { NotificationsService } from '../../../notifications/notifications.service';

export const ACCOUNT_OPTIONS = Symbol('ADMIN_ACCOUNT_OPTIONS');

export interface AccountOptions {
  webUrl?: string;
  // The support address the suspension e-mail names, when one is set.
  support?: string;
}

const METHODS = ['password', 'google', 'apple', 'whatsapp_phone'] as const;

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such account');
const adminAccount = () =>
  refusal(
    HttpStatus.CONFLICT,
    'admin_account',
    'An admin account takes no action from here',
  );

// The admin's page for one account and the four actions on it. Every action
// is one transaction with its audit entry and event, and a status change is
// a conditional write: of two admins acting at once, one wins.
@Injectable()
export class AccountService {
  private readonly logger = new Logger('AdminAccount');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    @Inject(ACCOUNT_OPTIONS) private readonly options: AccountOptions,
    private readonly notifications: NotificationsService,
    private readonly signIns: SignInService,
    private readonly resets: PasswordResetService,
    private readonly deletion: AccountDeletionService,
  ) {}

  async read(id: string): Promise<AdminAccountPageDto> {
    const account = await this.prisma.account.findUnique({
      select: {
        _count: {
          select: {
            cars: { where: { removedAt: null } },
            quoteRequests: true,
            reviews: true,
          },
        },
        createdAt: true,
        email: true,
        id: true,
        identities: { select: { method: true } },
        language: true,
        lastActiveAt: true,
        mechanic: {
          select: {
            garage: { select: { id: true, name: true, status: true } },
          },
        },
        memberships: {
          select: {
            garage: { select: { id: true, name: true, status: true } },
            role: true,
          },
        },
        name: true,
        phone: true,
        roles: { select: { role: true } },
        status: true,
        suspendedReason: true,
      },
      where: { id },
    });
    if (!account || account.status === 'deleted') throw notFound();
    const held = account.roles.map((r) => r.role);
    const owned = account.memberships.find((m) => m.role === 'owner');
    const desk = account.memberships.find((m) => m.role === 'receptionist');
    const garage = owned
      ? { ...owned.garage, relation: 'owner' as const }
      : desk
        ? { ...desk.garage, relation: 'receptionist' as const }
        : account.mechanic
          ? { ...account.mechanic.garage, relation: 'mechanic' as const }
          : null;
    const documents = owned
      ? await this.prisma.legalDocument.findMany({
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            pages: true,
            verificationFileId: true,
          },
          where: {
            replacedAt: null,
            verificationFile: { garageId: owned.garage.id },
          },
        })
      : [];
    const methods = new Set(account.identities.map((i) => i.method));
    return {
      counts: {
        cars: account._count.cars,
        requests: account._count.quoteRequests,
        reviews: account._count.reviews,
      },
      createdAt: account.createdAt.toISOString(),
      documents: documents.map((d) => ({ ...d, pages: d.pages.length })),
      email: account.email,
      garage,
      id: account.id,
      isAdmin: held.includes('admin'),
      isOwner: owned !== undefined,
      language: account.language,
      lastActiveAt: account.lastActiveAt?.toISOString() ?? null,
      name: account.name,
      phone: account.phone,
      roles: ACCOUNT_ROLES.filter((role) => held.includes(role)),
      signInMethods: METHODS.filter((m) => methods.has(m)),
      status: account.status,
      suspendedReason: account.suspendedReason,
    };
  }

  // Ends every session and sends the reset link where the account signs in
  // with a password. The admin never sees the link.
  resetAccess(id: string, admin: Actor): Promise<AccessResetDto> {
    return this.run<AccessResetDto>(
      'reset_access',
      id,
      admin,
      async (target) => {
        const at = new Date();
        await this.prisma.$transaction(async (tx) => {
          await tx.refreshToken.deleteMany({ where: { accountId: id } });
          await this.audit.record(tx, {
            action: 'update',
            actorId: admin.accountId,
            actorRole: admin.role,
            kind: 'access_reset',
            subjectId: id,
            subjectType: 'account',
          });
          await this.events.record(tx, {
            audience: { accountId: id, type: 'account' },
            kind: 'account.access_reset',
            payload: { accountId: id },
            subjectId: id,
          });
        });
        this.signIns.revokeSessionsLive(id, at);
        if (target.status !== 'active' || !target.email || !target.password) {
          return { outcome: 'done', result: { email: 'none' } };
        }
        try {
          await this.resets.issueFor(id);
          return { outcome: 'done', result: { email: 'sent' } };
        } catch (error) {
          this.logger.error(`reset e-mail not sent: ${reason(error)}`);
          return { outcome: 'email_failed', result: { email: 'failed' } };
        }
      },
    );
  }

  suspend(
    id: string,
    admin: Actor,
    text: string,
  ): Promise<AdminAccountPageDto> {
    return this.run('suspend', id, admin, async (target) => {
      const at = new Date();
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.account.updateMany({
          data: { status: 'suspended', suspendedReason: text },
          where: { id, status: 'active' },
        });
        if (count === 0) {
          throw await this.lost(tx, id, 'account_already_suspended');
        }
        await tx.refreshToken.deleteMany({ where: { accountId: id } });
        const by = { id: admin.accountId, role: admin.role };
        await revokeAssistantGrants(tx, this.audit, this.events, {
          accountId: id,
          by,
          reason: 'account_suspended',
        });
        await this.audit.record(tx, {
          action: 'update',
          actorId: admin.accountId,
          actorRole: admin.role,
          field: 'status',
          kind: 'account_suspended',
          newValue: 'suspended',
          oldValue: 'active',
          subjectId: id,
          subjectType: 'account',
          text,
        });
        await this.events.record(tx, {
          audience: { accountId: id, type: 'account' },
          kind: 'account.suspended',
          payload: { accountId: id },
          subjectId: id,
        });
      });
      this.signIns.revokeSessionsLive(id, at);
      const sent = target.email ? await this.tell(target, text) : true;
      return {
        outcome: sent ? 'done' : 'email_failed',
        result: await this.read(id),
      };
    });
  }

  restore(
    id: string,
    admin: Actor,
    note: string | undefined,
  ): Promise<AdminAccountPageDto> {
    return this.run('restore', id, admin, async () => {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.account.updateMany({
          data: { status: 'active', suspendedReason: null },
          where: { id, status: 'suspended' },
        });
        if (count === 0) throw await this.lost(tx, id, 'account_not_suspended');
        await this.audit.record(tx, {
          action: 'update',
          actorId: admin.accountId,
          actorRole: admin.role,
          field: 'status',
          kind: 'account_restored',
          newValue: 'active',
          oldValue: 'suspended',
          subjectId: id,
          subjectType: 'account',
          ...(note && { text: note }),
        });
        await this.events.record(tx, {
          audience: { accountId: id, type: 'account' },
          kind: 'account.restored',
          payload: { accountId: id },
          subjectId: id,
        });
      });
      return { outcome: 'done', result: await this.read(id) };
    });
  }

  deleteOnRequest(
    id: string,
    admin: Actor,
    request: { reference: string; receivedOn: string },
  ): Promise<void> {
    return this.run('delete_on_request', id, admin, async () => {
      await this.deletion.deleteOnRequest(id, admin, request);
      return { outcome: 'done', result: undefined };
    });
  }

  // Loads the account, refuses an admin account, runs the action, and counts
  // and logs its outcome once.
  private async run<T>(
    action: AdminAccountAction,
    id: string,
    admin: Actor,
    act: (
      target: Target,
    ) => Promise<{ outcome: AdminAccountOutcome; result: T }>,
  ): Promise<T> {
    const done = (outcome: AdminAccountOutcome) => {
      countAdminAccountAction(action, outcome);
      this.logger.log({
        accountId: id,
        action,
        actorId: admin.accountId,
        message: 'admin account action',
        outcome,
      });
    };
    try {
      const target = await this.target(id);
      const { outcome, result } = await act(target);
      done(outcome);
      return result;
    } catch (error) {
      done(outcomeOf(error));
      throw error;
    }
  }

  private async target(id: string): Promise<Target> {
    const account = await this.prisma.account.findUnique({
      select: {
        email: true,
        identities: { select: { id: true }, where: { method: 'password' } },
        language: true,
        roles: { select: { role: true }, where: { role: 'admin' } },
        status: true,
      },
      where: { id },
    });
    if (!account || account.status === 'deleted') throw notFound();
    if (account.roles.length > 0) throw adminAccount();
    return {
      email: account.email,
      id,
      language: account.language,
      password: account.identities.length > 0,
      status: account.status,
    };
  }

  // The conditional write changed nothing: the account was deleted (404) or
  // is already where the action would take it (409).
  private async lost(
    tx: Pick<PrismaClient, 'account'>,
    id: string,
    code: string,
  ) {
    const now = await tx.account.findUnique({
      select: { status: true },
      where: { id },
    });
    return !now || now.status === 'deleted'
      ? notFound()
      : refusal(HttpStatus.CONFLICT, code, 'The account changed meanwhile');
  }

  // The suspension e-mail; a refused send is logged, never retried.
  private async tell(target: Target, text: string) {
    const contact = `${this.options.webUrl ?? ''}/${target.language}/contact`;
    try {
      if (!this.options.webUrl) throw new Error('PUBLIC_WEB_URL is not set');
      await this.notifications.sendAccountEmail({
        accountId: target.id,
        link: contact,
        purpose: 'account_suspended',
        reason: text,
        ...(this.options.support ? { support: this.options.support } : {}),
      });
      return true;
    } catch (error) {
      this.logger.error(`suspension e-mail not sent: ${reason(error)}`);
      return false;
    }
  }
}

interface Target {
  email: string | null;
  id: string;
  language: string;
  password: boolean;
  status: 'active' | 'suspended' | 'deleted';
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const RACES = new Set(['account_already_suspended', 'account_not_suspended']);

function outcomeOf(error: unknown): AdminAccountOutcome {
  if (!(error instanceof HttpException)) return 'failed';
  const { code } = error.getResponse() as { code?: string };
  return code && RACES.has(code) ? 'conflict' : 'refused';
}

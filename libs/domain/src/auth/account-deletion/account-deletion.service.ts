import { type DeleteMeDto, normalisePhone } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import { leaveTeams } from '../../garages/team-leave/team-leave';
import type { PrismaClient } from '../../generated/prisma/client';
import {
  type AccountDeletionOutcome,
  countAccountDeletion,
} from '../../metrics/product-counters';
import { NotificationsService } from '../../notifications/notifications.service';
import { signInRequired } from '../account-loader';
import {
  RESET_OPTIONS,
  type ResetOptions,
} from '../password/password-reset/password-reset.service';
import type { Actor } from '../policy';
import { PRISMA } from '../prisma';
import { SignInService } from '../sign-in.service';
import { refusal } from '../sign-up.service';

// How recent the sign-in that opened the session must be.
const RECENT_MS = 15 * 60_000;

// What an account with neither e-mail nor phone types; Romanian keyboards
// give Ș with a comma or with a cedilla.
const PHRASES = new Set(['ȘTERGE', 'ŞTERGE', 'DELETE']);

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// The person deletes their own account: its personal values are cleared,
// its ways to sign in and its sessions go, and it leaves its teams. The row
// stays, deleted, for what others still read of it.
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger('AccountDeletion');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly notifications: NotificationsService,
    private readonly signIns: SignInService,
    @Inject(RESET_OPTIONS) private readonly options: ResetOptions,
  ) {}

  // `token` is the session cookie: the age of its sign-in is checked.
  async deleteAccount(
    actor: Actor,
    token: string | undefined,
    body: DeleteMeDto,
  ): Promise<void> {
    try {
      await this.run(actor, token, body);
    } catch (error) {
      if (!(error instanceof HttpException)) countAccountDeletion('failed');
      throw error;
    }
  }

  private refused(outcome: AccountDeletionOutcome, error: HttpException) {
    countAccountDeletion(outcome);
    this.logger.warn(`account deletion refused: ${outcome}`);
    return error;
  }

  private async run(
    actor: Actor,
    token: string | undefined,
    body: DeleteMeDto,
  ) {
    if (actor.via === 'assistant') {
      throw this.refused(
        'forbidden',
        refusal(
          HttpStatus.FORBIDDEN,
          'forbidden',
          'An assistant cannot delete the account',
        ),
      );
    }
    const { accountId } = actor;
    const account = await this.prisma.account.findUniqueOrThrow({
      select: {
        email: true,
        language: true,
        memberships: { select: { role: true }, where: { role: 'owner' } },
        phone: true,
      },
      where: { id: accountId },
    });
    if (account.memberships.length > 0) {
      throw this.refused(
        'refused_owner',
        refusal(
          HttpStatus.CONFLICT,
          'deletion_not_allowed',
          'Close the garage you own before deleting the account',
        ),
      );
    }
    await this.recentSignIn(token, accountId);
    if (!matches(body.confirmation, account)) {
      throw this.refused(
        'mismatch',
        refusal(
          HttpStatus.BAD_REQUEST,
          'validation_failed',
          'The confirmation does not match the account',
          [{ code: 'mismatch', field: 'confirmation' }],
        ),
      );
    }
    const at = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.account.updateMany({
        data: {
          city: null,
          email: null,
          emailBouncedAt: null,
          emailVerifiedAt: null,
          name: '',
          phone: null,
          phoneVerifiedAt: null,
          status: 'deleted',
        },
        where: { id: accountId, status: 'active' },
      });
      if (count === 0) throw signInRequired();
      const where = { where: { accountId } };
      await tx.accountIdentity.deleteMany(where);
      await tx.refreshToken.deleteMany(where);
      await tx.accountToken.deleteMany(where);
      await tx.phoneChange.deleteMany(where);
      await tx.pushSubscription.deleteMany(where);
      await tx.notificationPreference.deleteMany(where);
      await tx.assistantGrant.deleteMany(where);
      await tx.assistantSignInCode.deleteMany(where);
      await tx.accountRole.deleteMany(where);
      await leaveTeams(tx, this.events, accountId);
      await this.audit.record(tx, {
        action: 'delete',
        actorId: accountId,
        actorLabel: 'Cont șters',
        actorRole: actor.role,
        kind: 'account_deleted',
        newValue: { status: 'deleted' },
        oldValue: { status: 'active' },
        subjectId: accountId,
        subjectType: 'account',
      });
      await this.events.record(tx, {
        audience: { accountId, type: 'account' },
        kind: 'account.deleted',
        payload: { accountId },
        subjectId: accountId,
      });
    });
    countAccountDeletion('deleted');
    this.logger.log(`account deleted ${accountId}`);
    await this.farewell(accountId, account.email, account.language);
    this.signIns.revokeSessionsLive(accountId, at);
  }

  // A missing or spent cookie is a sign-in too old to trust; a store that
  // fails to answer is a failure, not a refusal.
  private async recentSignIn(token: string | undefined, accountId: string) {
    const openedAt = await this.signIns
      .sessionFamily(token, accountId)
      .then(({ openedAt }) => openedAt)
      .catch((error: unknown) => {
        if (error instanceof HttpException) return null;
        throw error;
      });
    if (!openedAt || Date.now() - openedAt.getTime() >= RECENT_MS) {
      throw this.refused(
        'reauth_required',
        refusal(
          HttpStatus.UNAUTHORIZED,
          'reauth_required',
          'Sign in again to delete the account',
        ),
      );
    }
  }

  // The last e-mail, to the address the account held; the deletion stands
  // without it, so a failure is only logged.
  private async farewell(
    accountId: string,
    email: string | null,
    language: string,
  ) {
    if (!email) return;
    const { webUrl } = this.options;
    try {
      if (!webUrl) throw new Error('PUBLIC_WEB_URL is not set');
      await this.notifications.sendAccountEmail({
        accountId,
        link: `${webUrl}/${language}`,
        purpose: 'account_deleted',
        to: email,
      });
    } catch (error) {
      this.logger.error(`account deleted e-mail not sent: ${reason(error)}`);
    }
  }
}

function matches(
  confirmation: string,
  account: { email: string | null; phone: string | null },
) {
  if (
    account.email &&
    confirmation.toLowerCase() === account.email.toLowerCase()
  )
    return true;
  if (account.phone && normalisePhone(confirmation) === account.phone)
    return true;
  return (
    !account.email &&
    !account.phone &&
    PHRASES.has(confirmation.toLocaleUpperCase('ro'))
  );
}

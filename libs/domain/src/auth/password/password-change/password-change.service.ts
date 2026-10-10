import type { PasswordChangeDto } from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type { PrismaClient } from '../../../generated/prisma/client';
import { countAccountChange } from '../../../metrics/product-counters';
import { NotificationsService } from '../../../notifications/notifications.service';
import { Attempts } from '../../attempts';
import type { Actor } from '../../policy';
import { PRISMA } from '../../prisma';
import { SignInService } from '../../sign-in.service';
import { refusal, tooMany, weakPassword } from '../../sign-up.service';
import { hashPassword, verifyPassword } from '../password';
import {
  RESET_OPTIONS,
  type ResetOptions,
} from '../password-reset/password-reset.service';

// How long after signing in an account with no password may set one.
const RECENT_MS = 10 * 60_000;

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// A new password from the dashboard: the current one proves it is the owner,
// or, for an account that has none yet, a sign-in in the last ten minutes.
// Every other session ends; this one stays. No password is ever logged.
@Injectable()
export class PasswordChangeService {
  private readonly logger = new Logger('PasswordChange');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly notifications: NotificationsService,
    private readonly attempts: Attempts,
    private readonly signIns: SignInService,
    @Inject(RESET_OPTIONS) private readonly options: ResetOptions,
  ) {}

  // `token` is the session cookie: the family it renews is the one kept.
  async change(
    actor: Actor,
    token: string | undefined,
    body: PasswordChangeDto,
  ): Promise<void> {
    // Not something an assistant can do for the account.
    if (actor.via === 'assistant') throw new NotFoundException();
    const { accountId } = actor;
    const family = await this.signIns.sessionFamily(token, accountId);
    const account = await this.prisma.account.findUniqueOrThrow({
      select: {
        email: true,
        identities: { where: { method: 'password' } },
        language: true,
      },
      where: { id: accountId },
    });
    const stored = account.identities[0]?.passwordHash;
    // The e-mail a first password signs in with; null when one is replaced.
    const first = stored
      ? null
      : this.mayCreate(account.email, family.openedAt);
    if (stored) await this.proven(accountId, stored, body.currentPassword);
    if (weakPassword(body.newPassword)) {
      throw this.refused(
        refusal(
          HttpStatus.BAD_REQUEST,
          'weak_password',
          'Choose a password of 8 to 128 characters that is not a common one',
          [{ code: 'weak_password', field: 'newPassword' }],
        ),
      );
    }
    const passwordHash = await hashPassword(body.newPassword);
    const at = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (first) {
        await tx.accountIdentity.create({
          data: { accountId, method: 'password', passwordHash, subject: first },
        });
      } else {
        await tx.accountIdentity.updateMany({
          data: { passwordHash },
          where: { accountId, method: 'password' },
        });
      }
      await tx.refreshToken.deleteMany({
        where: { accountId, familyId: { not: family.familyId } },
      });
      await tx.pushSubscription.deleteMany({ where: { accountId } });
      await this.audit.record(tx, {
        action: 'update',
        actorId: accountId,
        actorRole: actor.role,
        field: 'password',
        kind: 'password_changed',
        subjectId: accountId,
        subjectType: 'account',
      });
      await this.events.record(tx, {
        audience: { accountId, type: 'account' },
        kind: 'account.password_changed',
        payload: { accountId },
        subjectId: accountId,
      });
    });
    await this.attempts.passwordClear(accountId);
    countAccountChange('password');
    await this.announce(accountId, account.language, at);
  }

  // The current password, right, within the account's tries.
  private async proven(
    accountId: string,
    stored: string,
    current: string | undefined,
  ) {
    if (current === undefined) {
      throw this.refused(
        refusal(
          HttpStatus.BAD_REQUEST,
          'validation_failed',
          'Type the current password',
          [{ code: 'required', field: 'currentPassword' }],
        ),
      );
    }
    if (await this.attempts.passwordBlocked(accountId)) {
      throw this.refused(tooMany());
    }
    if (!(await verifyPassword(current, stored))) {
      await this.attempts.passwordFailed(accountId);
      throw this.refused(
        refusal(
          HttpStatus.UNAUTHORIZED,
          'invalid_credentials',
          'The current password is not correct',
        ),
      );
    }
  }

  // A first password signs in with the account e-mail, and only a session
  // opened in the last ten minutes may set it.
  private mayCreate(email: string | null, openedAt: Date): string {
    if (!email) {
      throw this.refused(
        refusal(
          HttpStatus.CONFLICT,
          'email_required',
          'Add an e-mail address before setting a password',
        ),
      );
    }
    if (Date.now() - openedAt.getTime() >= RECENT_MS) {
      throw this.refused(
        refusal(
          HttpStatus.FORBIDDEN,
          'recent_sign_in_required',
          'Sign in again to set a password',
        ),
      );
    }
    return email;
  }

  // The notice e-mail and the other tabs' sign-out; the change stands
  // without either, so a failure is only logged.
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

  private refused<T extends { getResponse(): unknown }>(error: T): T {
    const { code } = error.getResponse() as { code: string };
    this.logger.warn(`password change refused: ${code}`);
    return error;
  }
}

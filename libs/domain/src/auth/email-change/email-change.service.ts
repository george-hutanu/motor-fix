import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { PrismaClient } from '../../generated/prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { Attempts } from '../attempts';
import {
  CONFIRMATION_OPTIONS,
  type ConfirmationOptions,
  confirmLink,
  newToken,
} from '../email-confirmation/email-confirmation';
import type { Actor } from '../policy';
import { PRISMA } from '../prisma';

const PURPOSE = 'email_change';
const CHANGE_LINK_TTL_MS = 24 * 60 * 60 * 1000;

// Not sign-up's: importing that service would close an import cycle.
const refusal = (status: HttpStatus, code: string, message: string) =>
  new HttpException({ code, message }, status);

// The address of the account's latest e-mail change still waiting for its link.
export const pendingEmail = async (
  prisma: PrismaClient,
  accountId: string,
  at: Date,
): Promise<string | null> => {
  const row = await prisma.accountToken.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { email: true },
    where: {
      accountId,
      expiresAt: { gt: at },
      purpose: PURPOSE,
      usedAt: null,
    },
  });
  return row?.email ?? null;
};

export const emailTaken = () =>
  refusal(
    HttpStatus.CONFLICT,
    'email_taken',
    'Another account uses this e-mail address',
  );

// A new address for the account's own e-mail: a link to it, and the address
// changes only when the link is opened (EmailConfirmationService.confirm).
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger('EmailChange');
  now = () => new Date();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(CONFIRMATION_OPTIONS) private readonly options: ConfirmationOptions,
    private readonly attempts: Attempts,
  ) {}

  async request(
    actor: Actor,
    email: string,
  ): Promise<{ pendingEmail: string }> {
    // Not something an assistant can do for the account.
    if (actor.via === 'assistant') throw new NotFoundException();
    const { accountId } = actor;
    const account = await this.prisma.account.findUniqueOrThrow({
      select: { email: true },
      where: { id: accountId },
    });
    if (account.email?.toLowerCase() === email) {
      throw refusal(
        HttpStatus.CONFLICT,
        'email_unchanged',
        'This is already the account e-mail address',
      );
    }
    await this.issue(accountId, email, account.email);
    return { pendingEmail: email };
  }

  // A new link for a change that waits; no notice to the current address.
  async resend(accountId: string, email: string): Promise<void> {
    await this.issue(accountId, email, null);
  }

  // Whether another account holds the address, whatever its case or status.
  async taken(email: string, accountId: string): Promise<boolean> {
    const holder = await this.prisma.account.findFirst({
      select: { id: true },
      where: {
        email: { equals: email, mode: 'insensitive' },
        id: { not: accountId },
      },
    });
    return holder !== null;
  }

  // The link is sent first, so a link that cannot leave keeps no pending
  // change; then older links expire and the new one is written.
  private async issue(accountId: string, email: string, notify: string | null) {
    if (await this.taken(email, accountId)) throw emailTaken();
    const { webUrl } = this.options;
    if (!webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    const { language } = await this.prisma.account.findUniqueOrThrow({
      select: { language: true },
      where: { id: accountId },
    });
    if (!(await this.attempts.admitContactChange(accountId))) {
      throw refusal(
        HttpStatus.TOO_MANY_REQUESTS,
        'too_many_attempts',
        'Too many links were asked for; try again later',
      );
    }
    const { hash, token } = newToken();
    try {
      await this.notifications.sendAccountEmail({
        accountId,
        link: confirmLink(webUrl, language, token),
        purpose: 'email_check',
        to: email,
      });
    } catch (error) {
      this.logger.error(`e-mail change link not sent: ${String(error)}`);
      await this.attempts.uncountContactChange(accountId);
      throw refusal(
        HttpStatus.SERVICE_UNAVAILABLE,
        'send_failed',
        'The e-mail could not be sent; try again',
      );
    }
    const at = this.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${PURPOSE}:${accountId}`}))`;
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
          email,
          expiresAt: new Date(at.getTime() + CHANGE_LINK_TTL_MS),
          purpose: PURPOSE,
          tokenHash: hash,
        },
      });
    });
    // After the commit, as the password reset does: the link stands, so a
    // notice that cannot leave is logged and the change kept.
    if (notify) {
      await this.notifications
        .sendAccountEmail({
          accountId,
          link: `${webUrl}/${language}`,
          purpose: 'email_change_notice',
        })
        .catch((error: unknown) =>
          this.logger.error(`e-mail change notice not sent: ${String(error)}`),
        );
    }
  }
}

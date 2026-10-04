import { Inject, Injectable, Logger } from '@nestjs/common';

import { Brevo, BrevoError } from './brevo';
import { blockedReason, type EmailConfig } from './email-config';
import { groupedMessage, message } from './messages';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
  RETRY_MINUTES,
} from './notifications.service';
import type {
  Account,
  Notification,
  PrismaClient,
} from '../generated/prisma/client';

interface NotificationJob {
  name: string;
  data: { id?: string; leaderId?: string };
  attemptsMade: number;
}

// BullMQ asks after the n-th failed attempt (counted from 1).
export const retryDelay = (failedBefore: number) =>
  RETRY_MINUTES[Math.min(failedBefore, RETRY_MINUTES.length - 1)] * 60_000;

@Injectable()
export class NotificationsProcessor {
  private readonly logger = new Logger('Notifications');
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly service: NotificationsService,
    private readonly brevo: Brevo,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  async ready(): Promise<boolean> {
    if (!this.config.sending) return true;
    if (!this.config.apiKey || !this.config.from.email) {
      this.logger.error(
        'e-mail sending is on but BREVO_API_KEY or EMAIL_FROM is missing',
      );
      return false;
    }
    if (!(await this.brevo.checkKey().catch(() => false))) {
      this.logger.error(
        'Brevo refused the API key; the notifications queue is not processed',
      );
      return false;
    }
    return true;
  }

  handle(job: NotificationJob): Promise<void> {
    if (job.name === 'flush' && job.data.leaderId) {
      return this.flush(job.data.leaderId, job.attemptsMade);
    }
    if (job.name === 'send' && job.data.id)
      return this.send(job.data.id, job.attemptsMade);
    throw new Error(`unknown notifications job ${job.name}`);
  }

  private async send(id: string, attemptsMade: number) {
    const row = await this.prisma.notification.findUnique({
      include: { account: true },
      where: { id },
    });
    if (!row || (row.status !== 'queued' && row.status !== 'held')) return;
    if (row.account.status === 'deleted') {
      await this.service.fail([row], 'account_deleted', false);
      return;
    }
    if (row.status === 'held') {
      if (row.groupLeaderId) return;
      if (!(await this.service.release(row))) return;
    }
    const to = await this.allowed([row], row.account);
    if (!to) return;
    await this.deliver(
      [row],
      to,
      message(row.kind, row.account.language, params(row)),
      attemptsMade,
    );
  }

  private async flush(leaderId: string, attemptsMade: number) {
    const rows = await this.prisma.notification.findMany({
      include: { account: true },
      orderBy: { createdAt: 'asc' },
      where: { groupLeaderId: leaderId, status: 'held' },
    });
    const [first] = rows;
    if (!first) return;
    if (first.account.status === 'deleted') {
      await this.service.fail(rows, 'account_deleted', false);
      return;
    }
    const to = await this.allowed(rows, first.account);
    if (!to) return;
    const { language } = first.account;
    const mail =
      rows.length === 1
        ? message(first.kind, language, params(first))
        : groupedMessage(first.kind, rows.length, language);
    await this.deliver(rows, to, mail, attemptsMade);
  }

  // Sending may have been switched off, or the address changed, since the
  // row was built. Answers the recipient, or null when the rows failed.
  private async allowed(rows: Notification[], account: Account) {
    const { email, name } = account;
    const reason = email ? blockedReason(this.config, email) : 'no_address';
    if (!email || reason) {
      await this.service.fail(rows, reason ?? 'no_address', false);
      return null;
    }
    return { email, name };
  }

  private async deliver(
    rows: Notification[],
    to: { email: string; name: string },
    mail: { subject: string; text: string },
    attemptsMade: number,
  ) {
    let messageId: string;
    try {
      messageId = await this.brevo.send({
        from: this.config.from,
        subject: mail.subject,
        text: mail.text,
        to,
      });
    } catch (error) {
      if (!(error instanceof BrevoError)) throw error;
      if (error.retryable && attemptsMade < RETRY_MINUTES.length) {
        this.logger.warn(
          `notification ${rows[0].id} will be retried: ${error.reason}`,
        );
        throw error;
      }
      await this.service.fail(rows, error.reason, true);
      return;
    }
    await this.prisma.notification.updateMany({
      data: {
        providerMessageId: messageId,
        sentAt: this.now(),
        status: 'sent',
      },
      where: { id: { in: rows.map((r) => r.id) } },
    });
  }
}

const params = (row: Notification) =>
  (row.params ?? {}) as Record<string, unknown>;

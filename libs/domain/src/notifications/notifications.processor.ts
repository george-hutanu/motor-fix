import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { Brevo, BrevoError } from './brevo';
import { notificationType } from './catalogue';
import { blockedReason, type EmailConfig } from './email-config';
import {
  NOTIFICATIONS_CONFIG,
  NOTIFICATIONS_PRISMA,
  NotificationsService,
  RETRY_MINUTES,
} from './notifications.service';
import {
  PHONE_CONFIG,
  type PhoneConfig,
  phoneBlockedReason,
} from './phone-config';
import {
  PUSH_SENDER,
  type PushResult,
  type PushSender,
  pushPayload,
} from './push';
import { MAX_DEVICES } from './push-subscriptions.service';
import { giveSmsBack, smsMonth, takeSms } from './sms-counter';
import { render, TemplateError, templateName } from './templates';
import type {
  Account,
  Language,
  ListingDraft,
  Notification,
  PrismaClient,
} from '../generated/prisma/client';

interface NotificationJob {
  name: string;
  data: { id?: string; leaderId?: string; link?: string };
  attemptsMade: number;
}

type AccountRow = Notification & { account: Account };

const hasAccount = <T extends Notification & { account: Account | null }>(
  row: T,
): row is T & { account: Account } => row.account !== null;

// BullMQ asks after the n-th failed attempt (counted from 1).
export const retryDelay = (failedBefore: number) =>
  RETRY_MINUTES[Math.min(failedBefore, RETRY_MINUTES.length - 1)] * 60_000;

// A send job's hold on its row lapses by the time the first retry runs, so a
// worker that dies holding one cannot keep the row from being sent.
const CLAIM_MS = retryDelay(0);

@Injectable()
export class NotificationsProcessor {
  private readonly logger = new Logger('Notifications');
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    private readonly service: NotificationsService,
    private readonly brevo: Brevo,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
    @Inject(PHONE_CONFIG) private readonly phone: PhoneConfig,
    @Optional()
    @Inject(PUSH_SENDER)
    private readonly pushSender: PushSender | null = null,
  ) {}

  async ready(): Promise<boolean> {
    if (!this.config.sending && !this.phone.sending) return true;
    if (
      !this.config.apiKey ||
      (this.config.sending && !this.config.from.email)
    ) {
      this.logger.error(
        'sending is on but BREVO_API_KEY or EMAIL_FROM is missing',
      );
      return false;
    }
    // Every e-mail's button needs it; without it they would all fail for good.
    if (this.config.sending && !this.config.webUrl) {
      this.logger.error(
        'e-mail sending is on but PUBLIC_WEB_URL is missing or not a URL; the notifications queue is not processed',
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
      return this.send(job.data.id, job.attemptsMade, job.data.link);
    if (job.name === 'requeue')
      return this.service.requeueStranded().then(() => undefined);
    throw new Error(`unknown notifications job ${job.name}`);
  }

  // Only the job holding the row's claim sends it. Another job's live claim
  // fails this one, so the queue retries it after the claim has lapsed.
  private async send(id: string, attemptsMade: number, link?: string) {
    const at = this.now();
    const { count } = await this.prisma.notification.updateMany({
      data: { claimedAt: at },
      where: {
        id,
        OR: [
          { claimedAt: null },
          { claimedAt: { lt: new Date(at.getTime() - CLAIM_MS) } },
        ],
        status: { in: ['queued', 'held'] },
      },
    });
    if (count === 0) {
      const row = await this.prisma.notification.findUnique({
        select: { status: true },
        where: { id },
      });
      if (row?.status === 'queued' || row?.status === 'held')
        throw new Error(`notification ${id} is being sent by another job`);
      return;
    }
    let recorded: boolean | undefined;
    try {
      recorded = await this.sendClaimed(id, attemptsMade, link);
    } finally {
      // A send that went unrecorded keeps its claim, so the sweep never hands
      // it to the queue again. A failed release must not retry a message that
      // went: the claim lapses.
      if (recorded !== false)
        await this.prisma.notification
          .updateMany({
            data: { claimedAt: null },
            where: { claimedAt: at, id },
          })
          .catch((error) =>
            this.logger.error(
              `notification ${id} claim not released: ${String(error)}`,
            ),
          );
    }
  }

  private async sendClaimed(
    id: string,
    attemptsMade: number,
    link?: string,
  ): Promise<boolean | undefined> {
    const { listingDraft, ...row } =
      await this.prisma.notification.findUniqueOrThrow({
        include: { account: true, listingDraft: true },
        where: { id },
      });
    if (listingDraft)
      return this.sendToDraft(row, listingDraft, link, attemptsMade);
    if (!hasAccount(row) || !(await this.due(row))) return;
    if (row.channel === 'email') return this.sendEmail(row, attemptsMade);
    if (row.channel === 'push') return this.sendPush(row, attemptsMade);
    return this.sendPhone(row, attemptsMade);
  }

  // Whether the claimed row goes now: a deleted account fails it, a held one
  // is released through the grouping rule.
  private async due(row: AccountRow) {
    if (row.account.status === 'deleted') {
      await this.service.fail([row], 'account_deleted', false);
      return false;
    }
    if (row.status === 'queued') return true;
    return !row.groupLeaderId && (await this.service.release(row));
  }

  private async sendEmail(
    row: AccountRow,
    attemptsMade: number,
  ): Promise<boolean | undefined> {
    const to = await this.allowed([row], row.account);
    if (!to) return;
    const values = params(row);
    return this.write(
      [row],
      to,
      templateName(row.kind, values),
      { language: row.account.language, values },
      attemptsMade,
    );
  }

  // A draft's e-mail goes to the address the draft holds now, in its
  // language, with the link its job carries; the row never held either.
  private async sendToDraft(
    row: Notification,
    draft: ListingDraft,
    link: string | undefined,
    attemptsMade: number,
  ): Promise<boolean | undefined> {
    if (row.status === 'held' && !(await this.service.release(row))) return;
    const reason = blockedReason(this.config, draft.email);
    if (reason) {
      await this.service.fail([row], reason, false);
      return;
    }
    return this.write(
      [row],
      { email: draft.email },
      row.kind,
      { language: draft.language, values: link ? { link } : {} },
      attemptsMade,
    );
  }

  private async flush(leaderId: string, attemptsMade: number) {
    const rows = (
      await this.prisma.notification.findMany({
        include: { account: true },
        orderBy: { createdAt: 'asc' },
        where: { groupLeaderId: leaderId, status: 'held' },
      })
    ).filter(hasAccount);
    const [first] = rows;
    if (!first) return;
    if (first.account.status === 'deleted') {
      await this.service.fail(rows, 'account_deleted', false);
      return;
    }
    const to = await this.allowed(rows, first.account);
    if (!to) return;
    if (rows.length === 1) {
      const values = params(first);
      await this.write(
        rows,
        to,
        templateName(first.kind, values),
        { language: first.account.language, values },
        attemptsMade,
      );
      return;
    }
    await this.write(
      rows,
      to,
      `${first.kind}.grouped`,
      { language: first.account.language, values: { count: rows.length } },
      attemptsMade,
    );
  }

  // A message that cannot be written in full is not sent at all.
  private async write(
    rows: Notification[],
    to: { email: string; name?: string },
    name: string,
    {
      language,
      values,
    }: { language: Language; values: Record<string, unknown> },
    attemptsMade: number,
  ): Promise<boolean | undefined> {
    let mail: { subject: string; text: string; html: string };
    try {
      mail = render(name, 'email', language, {
        ...values,
        app: this.config.webUrl,
      });
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      this.logger.error(
        `notification ${rows[0].id} ${rows[0].kind} email not written: ${error.message}`,
      );
      await this.service.fail(rows, 'template_failed', false);
      return;
    }
    return this.deliver(rows, to, mail, attemptsMade);
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
    to: { email: string; name?: string },
    mail: { subject: string; text: string; html: string },
    attemptsMade: number,
  ): Promise<boolean | undefined> {
    let messageId: string;
    try {
      messageId = await this.brevo.send({
        from: this.config.from,
        headers: oneClickHeaders(rows[0]),
        html: mail.html,
        subject: mail.subject,
        text: mail.text,
        to,
      });
    } catch (error) {
      await this.refused(rows, error, attemptsMade);
      return;
    }
    return this.sent(rows, messageId);
  }

  // One push row goes to every device the person saved. It is sent when any
  // device took it; retried only when none did and a refusal may pass; a
  // device the push service no longer knows is deleted.
  private async sendPush(
    row: AccountRow,
    attemptsMade: number,
  ): Promise<boolean | undefined> {
    if (!this.pushSender) {
      await this.service.fail([row], 'push_off', true);
      return;
    }
    const devices = await this.prisma.pushSubscription.findMany({
      orderBy: { createdAt: 'desc' },
      take: MAX_DEVICES,
      where: { accountId: row.account.id },
    });
    if (devices.length === 0) {
      await this.service.fail([row], 'no_device', true);
      return;
    }
    const payload = await this.pushText(row);
    if (payload === null) return;
    const urgent = notificationType(row.kind).alwaysSent;
    const sender = this.pushSender;
    const results = await Promise.all(
      devices.map((d) => sender.send(d, payload, urgent)),
    );
    const ids = (wanted: PushResult) =>
      devices.filter((_, i) => results[i] === wanted).map((d) => d.id);
    const gone = ids('gone');
    if (gone.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: { id: { in: gone } },
      });
    }
    const sent = ids('sent');
    if (sent.length > 0) {
      await this.prisma.pushSubscription.updateMany({
        data: { lastSuccessAt: this.now() },
        where: { id: { in: sent } },
      });
      return this.sent([row], null);
    }
    if (results.includes('retry') && attemptsMade < RETRY_MINUTES.length) {
      this.logger.warn(
        `notification ${row.id} ${row.kind} push will be retried`,
      );
      throw new Error('push service unavailable');
    }
    await this.service.fail(
      [row],
      results.every((r) => r === 'gone')
        ? 'no_device'
        : results.includes('retry')
          ? 'push_unavailable'
          : 'push_refused',
      true,
    );
    return undefined;
  }

  // The rendered push, or null when the row failed over to e-mail.
  private async pushText(row: Notification & { account: Account }) {
    const values = params(row);
    try {
      const text = render(
        templateName(row.kind, values),
        'push',
        row.account.language,
        { ...values, app: this.config.webUrl },
      );
      return pushPayload(text, `${this.config.webUrl}/icons/icon-192.png`);
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      this.logger.error(
        `notification ${row.id} ${row.kind} push not written: ${error.message}`,
      );
      await this.service.fail([row], 'template_failed', true);
      return null;
    }
  }

  // A phone that is missing, unverified, switched off or not allowlisted
  // skips WhatsApp too: e-mail reaches the person instead.
  private async sendPhone(
    row: AccountRow,
    attemptsMade: number,
  ): Promise<boolean | undefined> {
    const { phone, phoneVerifiedAt } = row.account;
    const reason = phone
      ? phoneVerifiedAt
        ? phoneBlockedReason(this.phone, phone)
        : 'phone_not_verified'
      : 'no_phone';
    if (!phone || reason) {
      await this.service.fail([row], reason ?? 'no_phone', 'email');
      return;
    }
    if (row.channel === 'sms') return this.sendSms(row, phone, attemptsMade);
    return this.sendWhatsApp(row, phone, attemptsMade);
  }

  private async sendSms(
    row: AccountRow,
    phone: string,
    attemptsMade: number,
  ): Promise<boolean | undefined> {
    // An earlier attempt reached Brevo and never recorded its answer: the SMS
    // may have gone, so it is neither sent nor counted again.
    if (row.sendingAt) {
      await this.service.fail([row], 'sms_unconfirmed', true);
      return;
    }
    const content = await this.text(row, 'sms');
    if (content === null) return;
    // Marked before the count is taken: a failed mark costs nothing.
    const mark = (sendingAt: Date | null) =>
      this.prisma.notification.update({
        data: { sendingAt },
        where: { id: row.id },
      });
    await mark(this.now());
    const month = smsMonth(this.now());
    if (!(await takeSms(this.prisma, row.account.id, month))) {
      await this.service.fail([row], 'sms_cap_reached', true);
      return;
    }
    let messageId: string;
    try {
      messageId = await this.brevo.sendSms({
        content,
        recipient: phone,
        sender: this.phone.smsSender,
      });
    } catch (error) {
      // No answer: Brevo may have it, so it keeps its count and is not retried.
      if (
        error instanceof BrevoError &&
        error.reason === 'provider_unreachable'
      ) {
        await this.service.fail([row], 'sms_unconfirmed', true);
        return;
      }
      // Brevo said no: the SMS did not go. The count goes back before the
      // mark is cleared, so a failed clear only settles the row on its retry.
      // The error still decides between a retry and the fallback.
      await giveSmsBack(this.prisma, row.account.id, month).catch((failed) =>
        this.logger.error(
          `notification ${row.id} ${row.kind} sms count not given back: ${String(failed)}`,
        ),
      );
      await mark(null);
      await this.refused([row], error, attemptsMade);
      return;
    }
    return this.sent([row], messageId);
  }

  private async sendWhatsApp(
    row: AccountRow,
    phone: string,
    attemptsMade: number,
  ): Promise<boolean | undefined> {
    const message = await this.text(row, 'whatsapp');
    if (message === null) return;
    const templateId = Object.hasOwn(this.phone.whatsappTemplates, message.name)
      ? this.phone.whatsappTemplates[message.name]
      : undefined;
    if (templateId === undefined) {
      this.logger.error(
        `notification ${row.id} ${row.kind}: WhatsApp template ${message.name} is not approved; sent by e-mail`,
      );
      await this.service.fail([row], 'template_not_approved', true);
      return;
    }
    let messageId: string;
    try {
      messageId = await this.brevo.sendWhatsApp({
        params: message.params,
        sender: this.phone.whatsappSender,
        templateId,
        to: phone,
      });
    } catch (error) {
      await this.refused([row], error, attemptsMade);
      return;
    }
    return this.sent([row], messageId);
  }

  // The rendered text, or null when the row failed over to the next channel.
  private async text<C extends 'sms' | 'whatsapp'>(
    row: AccountRow,
    channel: C,
  ) {
    const values = params(row);
    try {
      return render(
        templateName(row.kind, values),
        channel,
        row.account.language,
        {
          ...values,
          app: this.config.webUrl,
        },
      );
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      this.logger.error(
        `notification ${row.id} ${row.kind} ${channel} not written: ${error.message}`,
      );
      await this.service.fail([row], 'template_failed', true);
      return null;
    }
  }

  // Retried while Brevo may still take it; otherwise failed over.
  private async refused(
    rows: Notification[],
    error: unknown,
    attemptsMade: number,
  ) {
    if (!(error instanceof BrevoError)) throw error;
    if (error.retryable && attemptsMade < RETRY_MINUTES.length) {
      this.logger.warn(
        `notification ${rows[0].id} ${rows[0].kind} ${rows[0].channel} will be retried: ${error.reason}`,
      );
      throw error;
    }
    await this.service.fail(rows, error.reason, true);
  }

  // The provider has the message, so a failed write never fails the job:
  // the queue's retry would send it again.
  private async sent(rows: Notification[], messageId: string | null) {
    const ids = rows.map((r) => r.id);
    for (let attempt = 1; ; attempt++) {
      try {
        await this.prisma.$transaction([
          this.prisma.notification.updateMany({
            data: {
              providerMessageId: messageId ?? undefined,
              sentAt: this.now(),
              status: 'sent',
            },
            where: { id: { in: ids } },
          }),
          this.service.forget(ids),
        ]);
        return true;
      } catch (error) {
        if (attempt < SENT_WRITES) continue;
        this.logger.error(
          `notification ${ids.join(', ')} sent as ${messageId ?? 'push'} but not recorded: ${String(error)}`,
        );
        return false;
      }
    }
  }
}

const SENT_WRITES = 3;

const params = (row: Notification) =>
  (row.params ?? {}) as Record<string, unknown>;

// Mail apps offer their own unsubscribe button for a row that carries a
// one-click link (RFC 8058); only news does.
function oneClickHeaders(row: Notification) {
  const link = params(row)['oneClick'];
  if (typeof link !== 'string') return undefined;
  return {
    'List-Unsubscribe': `<${link}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

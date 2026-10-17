import { Logger } from '@nestjs/common';

import { addDays, localDay } from '../../bucharest';
import type {
  PrismaClient,
  SupportEmailStatus,
  SupportMessage,
} from '../../generated/prisma/client';
import {
  countSupportEmail,
  type SupportEmailKind,
} from '../../metrics/product-counters';
import type { Brevo } from '../../notifications/brevo/brevo';
import {
  blockedReason,
  type EmailConfig,
  emailEnvelope,
} from '../../notifications/email-config';
import { render } from '../../notifications/templates';
import { supportMessageValues } from '../../notifications/templates/support';
import { awayAhead, promiseLine } from '../promise/promise';
import type { SupportConfig } from '../support-config';

// A job as the relay queues it: `id` is the outbox event's.
export interface SupportMessageEvent {
  id: string;
  // Unchecked: the relay passes the payload through as recorded.
  payload: { id?: unknown };
}

// The holidays read for the promise: enough days after the away date to
// find a working one.
const HOLIDAY_WINDOW_DAYS = 31;

// Sends a stored message's two e-mails: to the support mailbox, replies set
// to the sender, and the acknowledgement to the sender. Each is tried only
// while unsent, and its status is written right after its send, so a retry
// never sends one twice. A Brevo failure leaves its e-mail pending and
// fails the job, after the other e-mail has had its try.
export class SupportDelivery {
  private readonly logger = new Logger('Support');

  constructor(
    private readonly prisma: PrismaClient,
    private readonly brevo: Pick<Brevo, 'send'>,
    private readonly email: EmailConfig,
    private readonly support: SupportConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handle(job: { data: SupportMessageEvent }): Promise<void> {
    const { id } = job.data.payload ?? {};
    if (typeof id !== 'string') {
      this.logger.error(`support event ${job.data.id} names no message`);
      return;
    }
    const message = await this.prisma.supportMessage.findUnique({
      where: { id },
    });
    if (!message) {
      this.logger.error(`support message ${id} is gone; nothing sent`);
      return;
    }
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<void>) => {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    };
    await attempt(() => this.toSupport(message));
    await attempt(() => this.acknowledge(message));
    if (failures.length > 0) throw failures[0];
  }

  private async toSupport(message: SupportMessage): Promise<void> {
    const status = message.supportEmailStatus;
    const address = this.support.email;
    if (status === 'sent' || status === 'blocked') return;
    if (!address) {
      this.logger.error(
        `support message ${message.reference}: neither SUPPORT_EMAIL nor EMAIL_DOMAIN is set; its e-mail waits unsent`,
      );
      if (status === 'pending') {
        await this.record(message.id, 'support', 'unconfigured');
      }
      return;
    }
    const contact = this.contactLink('ro');
    await this.deliver(message, 'support', address, () => {
      const values = supportMessageValues(message);
      return {
        mail: render('SUPPORT_MESSAGE', 'email', 'ro', { ...values, contact }),
        replyTo: { email: message.email, name: values.name },
        to: { email: address },
      };
    });
  }

  private async acknowledge(message: SupportMessage): Promise<void> {
    if (message.acknowledgementStatus !== 'pending') return;
    const promise = await this.promise(message.language);
    const contact = this.contactLink(message.language);
    await this.deliver(message, 'acknowledgement', message.email, () => ({
      mail: render('SUPPORT_ACKNOWLEDGEMENT', 'email', message.language, {
        contact,
        message: message.message,
        promise,
        reference: message.reference,
      }),
      to: { email: message.email, name: message.name },
    }));
  }

  private async deliver(
    message: SupportMessage,
    kind: SupportEmailKind,
    address: string,
    build: () => {
      mail: { subject: string; text: string; html: string };
      to: { email: string; name?: string };
      replyTo?: { email: string; name: string };
    },
  ): Promise<void> {
    if (blockedReason(this.email, address)) {
      await this.record(message.id, kind, 'blocked');
      return;
    }
    const { mail, replyTo, to } = build();
    try {
      // The support mailbox answers the person who wrote, not itself.
      await this.brevo.send({
        ...emailEnvelope(this.email, to),
        ...(replyTo ? { replyTo } : {}),
        html: mail.html,
        subject: mail.subject,
        text: mail.text,
      });
    } catch (error) {
      countSupportEmail(kind, 'failed');
      this.logger.error(
        `support message ${message.reference}: the ${kind} e-mail failed: ${(error as Error).message}`,
      );
      throw error;
    }
    await this.record(message.id, kind, 'sent');
  }

  private async record(
    id: string,
    kind: SupportEmailKind,
    outcome: Exclude<SupportEmailStatus, 'pending'>,
  ) {
    countSupportEmail(kind, outcome);
    const at = outcome === 'sent' ? this.now() : null;
    await this.prisma.supportMessage.update({
      data:
        kind === 'support'
          ? {
              supportEmailAt: at,
              supportEmailStatus: outcome,
            }
          : {
              acknowledgementAt: at,
              acknowledgementStatus: outcome,
            },
      where: { id },
    });
  }

  private contactLink(language: string): string {
    const webUrl = this.email.webUrl;
    if (!webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    return `${webUrl}/${language === 'en' ? 'en' : 'ro'}/contact`;
  }

  // The away date, when still ahead, moved past weekends and the public
  // holidays; one past or unreadable is logged at each send.
  private async promise(language: string): Promise<string> {
    const today = localDay(this.now());
    const { awayUntil, awayUnreadable } = this.support;
    if (awayUnreadable) {
      this.logger.warn(
        'SUPPORT_AWAY_UNTIL is not a YYYY-MM-DD day: read as unset',
      );
    }
    if (!awayAhead(awayUntil, today)) {
      if (awayUntil) {
        this.logger.warn(
          `SUPPORT_AWAY_UNTIL ${awayUntil} is not after today: read as unset`,
        );
      }
      return promiseLine(language, undefined, today, new Set());
    }
    const from = awayUntil as string;
    const rows = await this.prisma.publicHoliday.findMany({
      select: { day: true },
      where: {
        day: {
          gte: new Date(`${from}T00:00:00Z`),
          lte: new Date(`${addDays(from, HOLIDAY_WINDOW_DAYS)}T00:00:00Z`),
        },
      },
    });
    const holidays = new Set(
      rows.map((row) => row.day.toISOString().slice(0, 10)),
    );
    return promiseLine(language, from, today, holidays);
  }
}

import { randomUUID } from 'node:crypto';

import type { OutsideChannel } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { JobsOptions } from 'bullmq';

import { type NotificationType, notificationType } from './catalogue';
import { blockedReason, type EmailConfig } from './email-config';
import { isDriverType, mutedChannels } from './preferences';
import { isQuiet, nextMorning } from './quiet-hours';
import { outsideChannels, type SentChannel } from './routing';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { LIVE_CHANNEL } from '../events/live.hub';
import type {
  Notification,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const NOTIFICATIONS_CONFIG = Symbol('NOTIFICATIONS_CONFIG');
export const NOTIFICATIONS_PRISMA = Symbol('NOTIFICATIONS_PRISMA');
export const NOTIFICATIONS_JOBS = Symbol('NOTIFICATIONS_JOBS');
export const LIVE_PUBLISHER = Symbol('LIVE_PUBLISHER');
export const EMAIL_FALLBACK = Symbol('EMAIL_FALLBACK');

export const RETRY_MINUTES = [1, 5, 15, 60, 240];
const WINDOW_MS = 5 * 60_000;

const JOB: JobsOptions = {
  attempts: RETRY_MINUTES.length + 1,
  backoff: { type: 'custom' },
  removeOnComplete: true,
  removeOnFail: 1000,
};

// Called when an e-mail fails for good; the push channel takes over here.
export type EmailFallback = (row: Notification) => Promise<void>;

// What a failed row falls back to: the next channel, e-mail at once (a stop
// that would also stop WhatsApp), or nothing.
type Fallback = boolean | 'email';

const NEXT: Partial<Record<Notification['channel'], SentChannel>> = {
  sms: 'whatsapp',
  whatsapp: 'email',
};

interface Jobs {
  add(name: string, data: unknown, options: JobsOptions): Promise<unknown>;
}

export interface Publisher {
  publish(channel: string, message: string): Promise<unknown>;
}

interface NotifyInput {
  kind: string;
  recipients: readonly string[];
  eventId: string;
  // The garage a staff message is about; its staff's choices for it apply.
  garageId?: string | null;
  subjectId?: string | null;
  params?: Record<string, unknown>;
}

interface NextJob {
  name: 'send' | 'flush';
  data: { id: string } | { leaderId: string };
  jobId: string;
  delay: number;
}

const send = (id: string): NextJob => ({
  data: { id },
  delay: 0,
  jobId: `send-${id}`,
  name: 'send',
});

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(NOTIFICATIONS_JOBS) private readonly jobs: Jobs,
    @Inject(LIVE_PUBLISHER) private readonly publisher: Publisher,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
    @Inject(EMAIL_FALLBACK) private readonly fallback: EmailFallback,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  // Answers how many outside messages it queued.
  async notify(input: NotifyInput): Promise<number> {
    const type = notificationType(input.kind);
    const whatsapp = await this.garageAllowsWhatsApp(input);
    let queued = 0;
    for (const accountId of new Set(input.recipients)) {
      const muted = await this.muted(input, accountId);
      const at = this.now();
      const written = await this.prisma.$transaction((tx) =>
        this.build(tx, type, input, accountId, at, { muted, whatsapp }),
      );
      if (!written) continue;
      await this.announce(written.bell);
      for (const next of written.next) await this.queue(next);
      queued += written.next.length;
    }
    return queued;
  }

  async sendAccountEmail(input: {
    accountId: string;
    purpose: 'email_check' | 'password_reset';
    link: string;
  }): Promise<void> {
    await this.notify({
      eventId: randomUUID(),
      kind: 'ACCOUNT_EMAIL',
      params: { link: input.link, purpose: input.purpose },
      recipients: [input.accountId],
      subjectId: input.accountId,
    });
  }

  async sendTestMessage(accountIds: readonly string[]): Promise<number> {
    const found = await this.prisma.account.count({
      where: { id: { in: [...accountIds] }, status: { not: 'deleted' } },
    });
    if (found !== new Set(accountIds).size) {
      throw new HttpException(
        {
          code: 'unknown_recipient',
          message: 'Every recipient must be an existing account',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const eventId = randomUUID();
    let queued = 0;
    for (const accountId of accountIds) {
      queued += await this.notify({
        eventId,
        kind: 'TEST_MESSAGE',
        recipients: [accountId],
        subjectId: accountId,
      });
    }
    return queued;
  }

  // A held row reaching its 08:00: it goes through the grouping rule as if
  // it had just been built. Answers whether the caller should send it now.
  async release(row: Notification): Promise<boolean> {
    const at = this.now();
    const next = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${row.kind}:${row.accountId}`}))`;
      const released = await tx.notification.update({
        data: { sendAfter: at, status: 'queued' },
        where: { id: row.id },
      });
      return this.dispatch(tx, released, at);
    });
    if (next.name === 'send') return true;
    await this.queue(next);
    return false;
  }

  // SMS falls back to WhatsApp, WhatsApp to e-mail, e-mail to push.
  async fail(
    rows: readonly Notification[],
    failure: string,
    fallback: Fallback,
  ): Promise<void> {
    await this.prisma.notification.updateMany({
      data: { failure, status: 'failed' },
      where: { id: { in: rows.map((r) => r.id) } },
    });
    for (const row of rows) {
      this.logger.warn(
        `notification ${row.id} ${row.kind} ${row.channel} failed: ${failure}`,
      );
      if (!fallback) continue;
      const next = fallback === 'email' ? 'email' : NEXT[row.channel];
      if (next) await this.fallBack(row, next);
      else await this.fallback({ ...row, failure, status: 'failed' });
    }
  }

  // The same message on the next channel, unless the event already has a
  // row there for the person or the type does not go by it.
  // At night a type that is not urgent waits until 08:00, as when it was built.
  private async fallBack(row: Notification, channel: SentChannel) {
    const type = notificationType(row.kind);
    if (!type.channels.includes(channel)) return;
    const account = await this.prisma.account.findUnique({
      select: { email: true },
      where: { id: row.accountId },
    });
    if (channel === 'email' && !account?.email) return;
    const at = this.now();
    const sendAfter = !type.urgent && isQuiet(at) ? nextMorning(at) : null;
    const [written] = await this.prisma.notification.createManyAndReturn({
      data: {
        accountId: row.accountId,
        channel,
        createdAt: at,
        eventId: row.eventId,
        fallbackOf: row.id,
        kind: row.kind,
        params: (row.params ?? {}) as Prisma.InputJsonObject,
        sendAfter,
        status: sendAfter ? 'held' : 'queued',
        subjectId: row.subjectId,
      },
      skipDuplicates: true,
    });
    if (!written) return;
    const delay = sendAfter ? sendAfter.getTime() - at.getTime() : 0;
    await this.queue({ ...send(written.id), delay });
  }

  // Brevo may report a bounce twice; a grouped e-mail carries one message id
  // on every row it sent.
  async recordBounce(messageId: string): Promise<void> {
    const rows = await this.prisma.notification.findMany({
      where: {
        channel: 'email',
        providerMessageId: messageId,
        status: { not: 'failed' },
      },
    });
    const [row] = rows;
    if (!row) return;
    const at = this.now();
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.account.findUniqueOrThrow({
        select: { emailBouncedAt: true },
        where: { id: row.accountId },
      });
      await tx.account.update({
        data: { emailBouncedAt: at },
        where: { id: row.accountId },
      });
      await this.audit.recordChanges(
        tx,
        {
          actorId: null,
          actorRole: 'system',
          subjectId: row.accountId,
          subjectType: 'account',
        },
        before,
        { emailBouncedAt: at },
      );
    });
    await this.fail(rows, 'bounced', true);
  }

  // A garage's staff get no WhatsApp once it switched it off; a driver's
  // message is never stopped by it.
  private async garageAllowsWhatsApp(input: NotifyInput): Promise<boolean> {
    if (!input.garageId || isDriverType(input.kind)) return true;
    try {
      const feature = await this.prisma.garageFeature.findUnique({
        where: { garageId_key: { garageId: input.garageId, key: 'whatsapp' } },
      });
      return feature?.enabled ?? true;
    } catch (error) {
      this.logger.warn(
        `garage WhatsApp switch not read, taking it as on: ${String(error)}`,
      );
      return true;
    }
  }

  // Read outside the send's transaction, so a store that fails cannot abort
  // it: the message then goes as if nothing were saved.
  private async muted(
    input: NotifyInput,
    accountId: string,
  ): Promise<Set<OutsideChannel>> {
    try {
      const rows = await this.prisma.notificationPreference.findMany({
        select: { channel: true, enabled: true, garageId: true, type: true },
        where: {
          accountId,
          garageId: isDriverType(input.kind) ? null : (input.garageId ?? null),
          type: input.kind,
        },
      });
      return mutedChannels(
        input.kind,
        rows.map((r) => ({ ...r, channel: r.channel as OutsideChannel })),
      );
    } catch (error) {
      this.logger.warn(
        `preferences for ${input.kind} not read, sending on the default channel: ${String(error)}`,
      );
      return mutedChannels(input.kind, []);
    }
  }

  // The bell row and the outside rows of one recipient; null when nothing is
  // written (a deleted account, or an event already handled).
  private async build(
    tx: Prisma.TransactionClient,
    type: NotificationType,
    input: NotifyInput,
    accountId: string,
    at: Date,
    choice: { muted: ReadonlySet<OutsideChannel>; whatsapp: boolean },
  ): Promise<{ bell: Notification; next: NextJob[] } | null> {
    // One builder at a time per kind and person, so a burst opens one window.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.kind}:${accountId}`}))`;
    const account = await tx.account.findUnique({
      select: { email: true, phone: true, phoneVerifiedAt: true, status: true },
      where: { id: accountId },
    });
    if (!account || account.status === 'deleted') return null;
    const duplicate = await tx.notification.findUnique({
      where: {
        kind_accountId_channel_eventId: {
          accountId,
          channel: 'in_app',
          eventId: input.eventId,
          kind: input.kind,
        },
      },
    });
    if (duplicate) return null;
    const base = {
      accountId,
      createdAt: at,
      eventId: input.eventId,
      kind: input.kind,
      params: (input.params ?? {}) as Prisma.InputJsonObject,
      subjectId: input.subjectId ?? null,
    };
    const bell = await tx.notification.create({
      data: { ...base, channel: 'in_app', sentAt: at, status: 'sent' },
    });
    const channels = outsideChannels(input.kind, choice.muted, {
      email: Boolean(account.email),
      phone: Boolean(account.phone && account.phoneVerifiedAt),
      whatsapp: choice.whatsapp,
    });
    const next: NextJob[] = [];
    for (const channel of channels) {
      const job = await this.outsideRow(tx, type, base, channel, account, at);
      if (job) next.push(job);
    }
    return { bell, next };
  }

  private outsideRow(
    tx: Prisma.TransactionClient,
    type: NotificationType,
    base: Omit<Prisma.NotificationUncheckedCreateInput, 'channel' | 'status'>,
    channel: SentChannel,
    account: { email: string | null },
    at: Date,
  ): Promise<NextJob | null> {
    return channel === 'email'
      ? this.emailRow(tx, type, base, account.email, at)
      : this.phoneRow(tx, type, base, channel, at);
  }

  // Never grouped; the switch and the allowlist are checked when it is sent.
  private async phoneRow(
    tx: Prisma.TransactionClient,
    type: NotificationType,
    base: Omit<Prisma.NotificationUncheckedCreateInput, 'channel' | 'status'>,
    channel: 'sms' | 'whatsapp',
    at: Date,
  ): Promise<NextJob> {
    if (!type.urgent && isQuiet(at)) {
      const sendAfter = nextMorning(at);
      const held = await tx.notification.create({
        data: { ...base, channel, sendAfter, status: 'held' },
      });
      return { ...send(held.id), delay: sendAfter.getTime() - at.getTime() };
    }
    const row = await tx.notification.create({
      data: { ...base, channel, status: 'queued' },
    });
    return send(row.id);
  }

  private async emailRow(
    tx: Prisma.TransactionClient,
    type: NotificationType,
    base: Omit<Prisma.NotificationUncheckedCreateInput, 'channel' | 'status'>,
    address: string | null,
    at: Date,
  ): Promise<NextJob | null> {
    if (!address) return null;
    const blocked = blockedReason(this.config, address);
    if (blocked) {
      await tx.notification.create({
        data: { ...base, channel: 'email', failure: blocked, status: 'failed' },
      });
      return null;
    }
    if (!type.urgent && isQuiet(at)) {
      const sendAfter = nextMorning(at);
      const held = await tx.notification.create({
        data: { ...base, channel: 'email', sendAfter, status: 'held' },
      });
      return { ...send(held.id), delay: sendAfter.getTime() - at.getTime() };
    }
    const email = await tx.notification.create({
      data: { ...base, channel: 'email', status: 'queued' },
    });
    return this.dispatch(tx, email, at);
  }

  // A queued e-mail of a groupable type joins the window another e-mail of the
  // same kind opened for the same person in the last five minutes.
  private async dispatch(
    tx: Prisma.TransactionClient,
    row: Notification,
    at: Date,
  ): Promise<NextJob> {
    if (row.channel !== 'email' || !notificationType(row.kind).groupable) {
      return send(row.id);
    }
    const since = new Date(at.getTime() - WINDOW_MS);
    const leader = await tx.notification.findFirst({
      orderBy: { createdAt: 'desc' },
      where: {
        accountId: row.accountId,
        channel: 'email',
        groupLeaderId: null,
        id: { not: row.id },
        kind: row.kind,
        OR: [
          { createdAt: { gt: since }, sendAfter: null },
          { sendAfter: { gt: since, lte: at } },
        ],
        status: { in: ['queued', 'sent'] },
      },
    });
    if (!leader) return send(row.id);
    const closes = new Date(
      (leader.sendAfter ?? leader.createdAt).getTime() + WINDOW_MS,
    );
    await tx.notification.update({
      data: { groupLeaderId: leader.id, sendAfter: closes, status: 'held' },
      where: { id: row.id },
    });
    return {
      data: { leaderId: leader.id },
      delay: Math.max(0, closes.getTime() - at.getTime()),
      jobId: `flush-${leader.id}`,
      name: 'flush',
    };
  }

  private queue(next: NextJob) {
    return this.jobs.add(next.name, next.data, {
      ...JOB,
      delay: next.delay,
      jobId: next.jobId,
    });
  }

  private async announce(bell: Notification) {
    const message = {
      audience: [`account:${bell.accountId}`],
      event: {
        at: bell.createdAt.toISOString(),
        id: bell.id,
        kind: 'notification.created',
      },
    };
    try {
      await this.publisher.publish(LIVE_CHANNEL, JSON.stringify(message));
    } catch {
      this.logger.warn(
        `notification ${bell.id} not announced live: Redis did not answer`,
      );
    }
  }
}

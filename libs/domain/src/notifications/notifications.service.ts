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
import { mutedChannels, rowsType } from './preferences/preferences';
import { PUSH_CONFIG, type PushConfig } from './push/push-config';
import { isQuiet, nextMorning } from './quiet-hours';
import { outsideChannels, type SentChannel } from './routing';
import { STAFF_TYPES } from './staff-lists';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import type { Actor } from '../auth/policy';
import { LIVE_CHANNEL } from '../events/live/live.hub';
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

export const RETRY_MINUTES = [1, 5, 15, 60, 240];
const WINDOW_MS = 5 * 60_000;
// A queued row this old with no claim has lost its send job, or the add is a
// no-op because the job is still there.
const STRANDED_MS = 5 * 60_000;
// How many stranded rows the sweep reads and hands over at a time: a stand-in
// until a backlog after a Redis loss is measured.
const REQUEUE_PAGE = 500;

const JOB: JobsOptions = {
  attempts: RETRY_MINUTES.length + 1,
  backoff: { type: 'custom' },
  removeOnComplete: true,
  removeOnFail: 1000,
};

// What a failed row falls back to: the next channel, e-mail at once (a stop
// that would also stop WhatsApp), or nothing.
type Fallback = boolean | 'email';

const NEXT: Partial<Record<Notification['channel'], SentChannel>> = {
  email: 'push',
  push: 'email',
  sms: 'whatsapp',
  whatsapp: 'email',
};

interface Jobs {
  add(name: string, data: unknown, options: JobsOptions): Promise<unknown>;
  addBulk(
    jobs: { name: string; data: unknown; opts: JobsOptions }[],
  ): Promise<unknown>;
  upsertJobScheduler(
    id: string,
    repeat: { every: number },
    template: { name: string; opts: JobsOptions },
  ): Promise<unknown>;
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
  // A draft's link travels in its send job, never in the row.
  data: { id: string; link?: string } | { leaderId: string };
  jobId: string;
  delay: number;
}

// A param that opens something by itself (an account e-mail's link carries
// its token): only the message in flight holds it, never the bell, and not
// once the message is sent or has failed.
const IN_FLIGHT_ONLY = ['link'];

const settled = (params: Prisma.InputJsonObject): Prisma.InputJsonObject =>
  Object.fromEntries(
    Object.entries(params).filter(([key]) => !IN_FLIGHT_ONLY.includes(key)),
  );

// The only messages that go to a listing draft rather than an account.
const DRAFT_KINDS = ['LISTING_CONTINUE_LINK', 'LISTING_REMINDER'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

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
    @Inject(PUSH_CONFIG) private readonly push: PushConfig | null,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  // Answers how many outside messages it queued.
  async notify(input: NotifyInput): Promise<number> {
    const type = notificationType(input.kind);
    // One read of the garage's switch, whichever staff it reaches.
    const allowed = new Map<string, Promise<boolean>>();
    const allowsWhatsApp = (garageId: string) => {
      const read = allowed.get(garageId) ?? this.garageAllowsWhatsApp(garageId);
      allowed.set(garageId, read);
      return read;
    };
    let queued = 0;
    for (const accountId of new Set(input.recipients)) {
      const garageId = await this.staffGarage(input, accountId);
      const muted = await this.muted(input.kind, accountId, garageId);
      const whatsapp = garageId ? await allowsWhatsApp(garageId) : true;
      const at = this.now();
      const written = await this.prisma.$transaction((tx) =>
        this.build(tx, type, input, accountId, at, {
          garageId,
          muted,
          whatsapp,
        }),
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
    purpose: 'email_check' | 'password_reset' | 'password_changed';
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

  // A draft has no account: its e-mail goes to the address on the draft,
  // read again when it is sent, and its link rides in the send job only.
  async sendToDraft(
    kind: DraftKind,
    draftId: string,
    link: string,
  ): Promise<void> {
    if (!DRAFT_KINDS.includes(kind)) {
      throw new Error(`${kind} is not sent to a listing draft`);
    }
    const at = this.now();
    const next = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.listingDraft.findUniqueOrThrow({
        select: { email: true },
        where: { id: draftId },
      });
      const base = {
        createdAt: at,
        eventId: randomUUID(),
        kind,
        listingDraftId: draftId,
        params: {},
        subjectId: draftId,
      };
      return this.emailRow(tx, notificationType(kind), base, draft.email, at);
    });
    if (next && 'id' in next.data) {
      await this.queue({ ...next, data: { id: next.data.id, link } });
    }
  }

  // A push to the person's own devices; it queues nothing without a device.
  sendPushTest(accountId: string): Promise<number> {
    return this.notify({
      eventId: randomUUID(),
      kind: 'PUSH_TEST',
      recipients: [accountId],
      subjectId: accountId,
    });
  }

  async sendTestMessage(
    actor: Actor,
    accountIds: readonly string[],
  ): Promise<number> {
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
    // Committed on its own before any message: a send that fails part way
    // still leaves the record that the admin asked for it.
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        action: 'create',
        actorId: actor.accountId,
        actorRole: actor.role,
        kind: 'notification.test',
        newValue: { accountIds: [...accountIds] },
        subjectId: actor.accountId,
        subjectType: 'account',
      }),
    );
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${row.kind}:${row.accountId ?? row.listingDraftId}`}))`;
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

  // SMS falls back to WhatsApp, WhatsApp to e-mail, e-mail and push to each
  // other; an e-mail or push that is itself a fallback never falls back again.
  async fail(
    rows: readonly Notification[],
    failure: string,
    fallback: Fallback,
  ): Promise<void> {
    const ids = rows.map((r) => r.id);
    await this.prisma.$transaction([
      this.prisma.notification.updateMany({
        data: { failure, status: 'failed' },
        where: { id: { in: ids } },
      }),
      this.forget(ids),
    ]);
    for (const row of rows) {
      this.logger.warn(
        `notification ${row.id} ${row.kind} ${row.channel} failed: ${failure}`,
      );
      if (!fallback) continue;
      const next = fallback === 'email' ? 'email' : NEXT[row.channel];
      const stops =
        (row.channel === 'email' || row.channel === 'push') &&
        row.fallbackOf !== null;
      if (next && !stops) await this.fallBack(row, next);
    }
  }

  // A row whose send job the queue refused stays queued: it is handed to the
  // queue again under the same job id, which the queue ignores while the job
  // exists. A claimed row, or an SMS marked as being sent, may have gone.
  // Every such row is read, a page at a time in id order, so a backlog never
  // makes one large read and no row waits behind the ones before it.
  // Answers how many rows it handed over.
  async requeueStranded(now = this.now()): Promise<number> {
    const added: string[] = [];
    try {
      let page: { id: string }[];
      do {
        page = await this.prisma.notification.findMany({
          orderBy: { id: 'asc' },
          select: { id: true },
          take: REQUEUE_PAGE,
          where: {
            claimedAt: null,
            createdAt: { lt: new Date(now.getTime() - STRANDED_MS) },
            id: { gt: added.at(-1) },
            // A draft's link went only in its lost job: a new job would send
            // the e-mail without it.
            listingDraftId: null,
            sendingAt: null,
            status: 'queued',
          },
        });
        if (page.length === 0) break;
        await this.jobs.addBulk(page.map(({ id }) => this.job(send(id))));
        added.push(...page.map(({ id }) => id));
      } while (page.length === REQUEUE_PAGE);
    } catch (error) {
      this.logger.warn(`queued notifications not re-queued: ${String(error)}`);
    }
    if (added.length > 0) {
      this.logger.warn(
        `re-queued ${added.length} queued notifications: ${added.join(', ')}`,
      );
    }
    return added.length;
  }

  scheduleRequeue() {
    return this.jobs.upsertJobScheduler(
      'requeue',
      { every: STRANDED_MS },
      { name: 'requeue', opts: { removeOnComplete: true, removeOnFail: 10 } },
    );
  }

  // Run in the transaction that marks the rows sent or failed: they no longer
  // hold what only the message in flight needed.
  forget(ids: readonly string[]) {
    return this.prisma
      .$executeRaw`UPDATE notification SET params = params - ${IN_FLIGHT_ONLY}::text[] WHERE id = ANY(${ids}::uuid[])`;
  }

  // The same message on the next channel, unless the event already has a
  // row there for the person or the type does not go by it.
  // At night a type that is not urgent waits until 08:00, as when it was built.
  private async fallBack(row: Notification, channel: SentChannel) {
    const type = notificationType(row.kind);
    if (!row.accountId || !type.channels.includes(channel)) return;
    if (!(await this.canReach(row.accountId, channel))) return;
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

  private async canReach(accountId: string, channel: SentChannel) {
    if (channel === 'push') return this.hasDevice(this.prisma, accountId);
    if (channel !== 'email') return true;
    const account = await this.prisma.account.findUnique({
      select: { email: true },
      where: { id: accountId },
    });
    return Boolean(account?.email);
  }

  // Push is off while the server has no keys, whatever devices were saved.
  private async hasDevice(
    db: Pick<PrismaClient, 'pushSubscription'>,
    accountId: string,
  ): Promise<boolean> {
    if (!this.push) return false;
    return (await db.pushSubscription.count({ where: { accountId } })) > 0;
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
    const { accountId } = row;
    // A draft's address belongs to no account to mark.
    if (!accountId) return this.fail(rows, 'bounced', false);
    const at = this.now();
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.account.findUniqueOrThrow({
        select: { emailBouncedAt: true },
        where: { id: accountId },
      });
      await tx.account.update({
        data: { emailBouncedAt: at },
        where: { id: accountId },
      });
      await this.audit.recordChanges(
        tx,
        {
          actorId: null,
          actorRole: 'system',
          subjectId: accountId,
          subjectType: 'account',
        },
        before,
        { emailBouncedAt: at },
      );
    });
    await this.fail(rows, 'bounced', true);
  }

  // The garage whose choices a recipient's message goes by: the message's,
  // when it is of a garage list and the recipient is that garage's staff.
  // Anyone else, a driver the garage writes to, goes by their own choice.
  private async staffGarage(
    input: NotifyInput,
    accountId: string,
  ): Promise<string | null> {
    const { garageId, kind } = input;
    if (!garageId || !STAFF_TYPES.has(rowsType(kind))) return null;
    try {
      const [member, mechanic] = await Promise.all([
        this.prisma.garageMember.count({ where: { accountId, garageId } }),
        this.prisma.mechanic.count({ where: { accountId, garageId } }),
      ]);
      return member + mechanic > 0 ? garageId : null;
    } catch (error) {
      this.logger.warn(
        `garage staff not read, taking ${kind} as staff's: ${String(error)}`,
      );
      return garageId;
    }
  }

  // A garage's staff get no WhatsApp once it switched it off.
  private async garageAllowsWhatsApp(garageId: string): Promise<boolean> {
    try {
      const feature = await this.prisma.garageFeature.findUnique({
        where: { garageId_key: { garageId, key: 'whatsapp' } },
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
    kind: string,
    accountId: string,
    garageId: string | null,
  ): Promise<Set<OutsideChannel>> {
    try {
      const rows = await this.prisma.notificationPreference.findMany({
        select: { channel: true, enabled: true, garageId: true, type: true },
        where: { accountId, garageId, type: rowsType(kind) },
      });
      return mutedChannels(
        kind,
        rows.map((r) => ({ ...r, channel: r.channel as OutsideChannel })),
        garageId,
      );
    } catch (error) {
      this.logger.warn(
        `preferences for ${kind} not read, sending on the default channel: ${String(error)}`,
      );
      return mutedChannels(kind, [], garageId);
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
    choice: {
      garageId: string | null;
      muted: ReadonlySet<OutsideChannel>;
      whatsapp: boolean;
    },
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
      data: {
        ...base,
        channel: 'in_app',
        params: settled(base.params),
        sentAt: at,
        status: 'sent',
      },
    });
    const channels = outsideChannels(
      input.kind,
      choice.muted,
      {
        email: Boolean(account.email),
        phone: Boolean(account.phone && account.phoneVerifiedAt),
        push: await this.hasDevice(tx, accountId),
        whatsapp: choice.whatsapp,
      },
      choice.garageId,
    );
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

  // Never grouped; the switch, the allowlist and the devices are checked when
  // it is sent.
  private async phoneRow(
    tx: Prisma.TransactionClient,
    type: NotificationType,
    base: Omit<Prisma.NotificationUncheckedCreateInput, 'channel' | 'status'>,
    channel: 'push' | 'sms' | 'whatsapp',
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
        data: {
          ...base,
          channel: 'email',
          failure: blocked,
          params: settled(base.params as Prisma.InputJsonObject),
          status: 'failed',
        },
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
    const { data, name, opts } = this.job(next);
    return this.jobs.add(name, data, opts);
  }

  private job(next: NextJob) {
    return {
      data: next.data,
      name: next.name,
      opts: { ...JOB, delay: next.delay, jobId: next.jobId },
    };
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

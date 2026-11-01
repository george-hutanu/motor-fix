import { randomUUID } from 'node:crypto';

import { sweepNotifications } from './notifications';
import { RETENTION, RETENTION_BATCH } from './retention.config';
import { ago, retentionFixtures } from './retention.testing';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl } from '../notifications/notifications.testing';

serialDatabase(databaseUrl);

const prisma = createPrisma(databaseUrl);
const data = retentionFixtures(prisma);
const now = new Date('2026-10-24T10:00:00.000Z');
const days = RETENTION.notifications.days;
const outside = ago(now, days, 1);
const inside = ago(now, days, -1);

afterAll(() => prisma.$disconnect());
beforeEach(() => data.reset());

const notification = async (
  accountId: string,
  createdAt: Date,
  fields: {
    channel?: 'in_app' | 'email' | 'push' | 'sms' | 'whatsapp';
    status?: 'queued' | 'held' | 'sent' | 'failed';
    readAt?: Date | null;
    groupLeaderId?: string;
    fallbackOf?: string;
  } = {},
) => {
  const { id } = await prisma.notification.create({
    data: {
      accountId,
      channel: fields.channel ?? 'in_app',
      createdAt,
      eventId: randomUUID(),
      fallbackOf: fields.fallbackOf,
      groupLeaderId: fields.groupLeaderId,
      kind: 'quote_received',
      readAt: fields.readAt ?? null,
      status: fields.status ?? 'sent',
    },
  });
  return id;
};

const unread = (accountId: string) =>
  prisma.notification.count({
    where: { accountId, channel: 'in_app', readAt: null },
  });

const storedUnread = async (id: string) =>
  (await prisma.account.findUniqueOrThrow({ where: { id } })).unreadCount;

// @traces 1156-FR-005
describe('the notifications sweep', () => {
  it('deletes every row older than the period, whatever its channel or status', async () => {
    const ana = await data.account('ana');
    const channels = ['in_app', 'email', 'push', 'sms', 'whatsapp'] as const;
    const statuses = ['queued', 'held', 'sent', 'failed'] as const;
    const kept: string[] = [];
    for (const channel of channels) {
      for (const status of statuses) {
        await notification(ana, outside, { channel, readAt: now, status });
        kept.push(
          await notification(ana, inside, { channel, readAt: now, status }),
        );
      }
    }
    expect(await sweepNotifications(prisma, now)).toBe(
      channels.length * statuses.length,
    );
    expect(
      (await prisma.notification.findMany({ select: { id: true } }))
        .map((r) => r.id)
        .sort(),
    ).toEqual(kept.sort());
  });

  it('leaves a younger row whole but for its reference to a deleted one', async () => {
    const ana = await data.account('ana');
    const leader = await notification(ana, outside, { readAt: now });
    const source = await notification(ana, outside, { channel: 'push' });
    const follower = await notification(ana, inside, {
      fallbackOf: source,
      groupLeaderId: leader,
      readAt: now,
    });
    const beforeSweep = await prisma.notification.findUniqueOrThrow({
      where: { id: follower },
    });
    await sweepNotifications(prisma, now);
    expect(
      await prisma.notification.findUniqueOrThrow({ where: { id: follower } }),
    ).toEqual({
      ...beforeSweep,
      fallbackOf: null,
      groupLeaderId: null,
    });
  });

  it("brings each account's unread count to its remaining unread in-app rows", async () => {
    const ana = await data.account('ana');
    const bogdan = await data.account('bogdan');
    await notification(ana, outside);
    await notification(ana, outside);
    await notification(ana, outside, { readAt: now });
    await notification(ana, outside, { channel: 'email' });
    await notification(ana, inside);
    await notification(bogdan, outside);
    await prisma.account.update({
      data: { unreadCount: 3 },
      where: { id: ana },
    });
    await prisma.account.update({
      data: { unreadCount: 1 },
      where: { id: bogdan },
    });

    await sweepNotifications(prisma, now);

    expect(await storedUnread(ana)).toBe(await unread(ana));
    expect(await storedUnread(ana)).toBe(1);
    expect(await storedUnread(bogdan)).toBe(0);
  });

  it('never takes an unread count below zero', async () => {
    const ana = await data.account('ana');
    await notification(ana, outside);
    await notification(ana, outside);
    await prisma.account.update({
      data: { unreadCount: 1 },
      where: { id: ana },
    });
    await sweepNotifications(prisma, now);
    expect(await storedUnread(ana)).toBe(0);
  });

  it('removes nothing the second time', async () => {
    const ana = await data.account('ana');
    await notification(ana, outside);
    await sweepNotifications(prisma, now);
    expect(await sweepNotifications(prisma, now)).toBe(0);
  });
});

// @traces 1156-FR-013
describe('the notification batches', () => {
  it('keep going until every old row is gone and the count still holds', async () => {
    const ana = await data.account('ana');
    const total = RETENTION_BATCH + 3;
    await prisma.$executeRaw`
      INSERT INTO notification (id, account_id, kind, channel, status, event_id, created_at)
      SELECT gen_random_uuid(), ${ana}::uuid, 'quote_received', 'in_app', 'sent', gen_random_uuid()::text, ${outside}
        FROM generate_series(1, ${total})`;
    await notification(ana, inside);
    await prisma.account.update({
      data: { unreadCount: total + 1 },
      where: { id: ana },
    });
    expect(await sweepNotifications(prisma, now)).toBe(total);
    expect(await prisma.notification.count()).toBe(1);
    expect(await storedUnread(ana)).toBe(1);
  });
});

// @traces 1156-FR-001
describe('the notification period read at call time', () => {
  afterEach(() => vi.restoreAllMocks());

  it('follows a changed period with no other edit', async () => {
    const days = RETENTION.notifications.days;
    onTestFinished(() => {
      (RETENTION.notifications as { days: number }).days = days;
    });
    (RETENTION.notifications as { days: number }).days = 30;
    const ana = await data.account('ana');
    await notification(ana, ago(now, 31));
    const young = await notification(ana, ago(now, 29));
    expect(await sweepNotifications(prisma, now)).toBe(1);
    expect(
      (await prisma.notification.findMany({ select: { id: true } })).map(
        (n) => n.id,
      ),
    ).toEqual([young]);
  });
});

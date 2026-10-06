import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { outbox } from './event.port';
import { LIVE_CHANNEL } from './live.hub';
import { type EventConsumer, OutboxRelay } from './outbox-relay';
import { AuditService } from '../audit/audit.service';
import { AccountsService } from '../auth/accounts.service';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const prisma = createPrisma(databaseUrl);
const other = createPrisma(databaseUrl);
serialDatabase(databaseUrl);

// A Redis that records what it was asked to publish, and can be "down".
// Suites running beside this one record account events, which the relay here
// may also pick up; only this file's quote events are kept.
class FakeRedis {
  down = false;
  failAfter = Number.POSITIVE_INFINITY;
  readonly sent: { audience: string[]; event: Record<string, string> }[] = [];
  async publish(channel: string, message: string) {
    if (this.down || this.sent.length >= this.failAfter) {
      throw new Error('Connection is closed.');
    }
    expect(channel).toBe(LIVE_CHANNEL);
    const parsed = JSON.parse(message);
    if (parsed.event.kind === 'quote.sent') this.sent.push(parsed);
    return 1;
  }
}

const quoteSent = (requestId: string, driverAccountId: string) => ({
  audience: {
    driverAccountId,
    garageId: randomUUID(),
    type: 'quote' as const,
  },
  kind: 'quote.sent' as const,
  payload: { requestId },
  subjectId: requestId,
});

async function recorded(count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const subject = randomUUID();
    await prisma.$transaction((tx) =>
      outbox.record(tx, quoteSent(subject, randomUUID())),
    );
    ids.push(subject);
  }
  return ids;
}

const waiting = () =>
  prisma.outboxEvent.count({ where: { kind: 'quote.sent', relayedAt: null } });

afterAll(async () => {
  await prisma.$disconnect();
  await other.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_event, account, garage CASCADE',
  );
  jest.restoreAllMocks();
});

describe('recording an event in the change’s transaction', () => {
  it('commits the change and its event together', async () => {
    const driver = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.garage.create({
        data: { name: 'Atelier Dinamo', slug: `atelier-${driver}` },
      });
      await outbox.record(tx, quoteSent('request-1', driver));
    });

    const rows = await prisma.outboxEvent.findMany({
      where: { kind: 'quote.sent' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      audience: [`account:${driver}`, expect.stringMatching(/^garage:/)],
      kind: 'quote.sent',
      payload: { requestId: 'request-1' },
      relayedAt: null,
      subjectId: 'request-1',
    });
    expect(await prisma.garage.count()).toBe(1);
  });

  it('leaves no event when the transaction rolls back, and the relay sends nothing', async () => {
    const redis = new FakeRedis();

    await expect(
      prisma.$transaction(async (tx) => {
        await outbox.record(tx, quoteSent('request-1', randomUUID()));
        throw new Error('the use case failed');
      }),
    ).rejects.toThrow('the use case failed');
    await new OutboxRelay(prisma, redis).relay();

    expect(
      await prisma.outboxEvent.count({ where: { kind: 'quote.sent' } }),
    ).toBe(0);
    expect(redis.sent).toEqual([]);
  });

  it('records sign-up through the outbox, addressed to the new account', async () => {
    const accounts = new AccountsService(prisma, new AuditService(), outbox);

    const { id } = await accounts.createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: 'andrei-subject' },
      name: 'Andrei',
      roles: ['driver'],
    });

    const rows = await prisma.outboxEvent.findMany({
      where: { subjectId: id },
    });
    expect(rows).toEqual([
      expect.objectContaining({
        audience: [`account:${id}`],
        kind: 'account.created',
        subjectId: id,
      }),
    ]);
  });
});

describe('the relay', () => {
  it('publishes a committed event with its audience to live:events and marks it relayed', async () => {
    const subscriber = new Redis(redisUrl);
    const heard: string[] = [];
    await subscriber.subscribe(LIVE_CHANNEL);
    subscriber.on('message', (_channel, message) => heard.push(message));
    const publisher = new Redis(redisUrl);
    const driver = randomUUID();
    await prisma.$transaction((tx) =>
      outbox.record(tx, quoteSent('request-1', driver)),
    );
    const [row] = await prisma.outboxEvent.findMany({
      where: { kind: 'quote.sent' },
    });

    const started = Date.now();
    expect(await new OutboxRelay(prisma, publisher).relay()).toBe(1);
    await new Promise((r) => setTimeout(r, 100));

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(
      heard
        .map((m) => JSON.parse(m))
        .filter((m) => m.event.kind === 'quote.sent'),
    ).toEqual([
      {
        audience: [`account:${driver}`, expect.stringMatching(/^garage:/)],
        event: {
          at: row?.createdAt.toISOString(),
          id: 'request-1',
          kind: 'quote.sent',
        },
      },
    ]);
    expect(await waiting()).toBe(0);
    subscriber.disconnect();
    publisher.disconnect();
  });

  it('keeps the events while Redis is down and publishes them in order when it is back', async () => {
    const redis = new FakeRedis();
    redis.down = true;
    const relay = new OutboxRelay(prisma, redis);
    const order = await recorded(5);

    await expect(relay.relay()).rejects.toThrow();
    await expect(relay.relay()).rejects.toThrow();
    expect(await waiting()).toBe(5);

    redis.down = false;
    await relay.relay();

    expect(redis.sent.map((m) => m.event['id'])).toEqual(order);
    expect(await waiting()).toBe(0);
  });

  it('publishes again an event whose relayed mark was not saved', async () => {
    const redis = new FakeRedis();
    redis.failAfter = 1;
    const relay = new OutboxRelay(prisma, redis);
    const [first, second] = await recorded(2);

    await expect(relay.relay()).rejects.toThrow();
    redis.failAfter = Number.POSITIVE_INFINITY;
    await relay.relay();

    expect(redis.sent.map((m) => m.event['id'])).toEqual([
      first,
      first,
      second,
    ]);
    expect(await waiting()).toBe(0);
  });

  it('relays each row once with two relays polling at the same time', async () => {
    const redis = new FakeRedis();
    const ids = await recorded(150);

    await Promise.all([
      new OutboxRelay(prisma, redis).relay(),
      new OutboxRelay(other, redis).relay(),
    ]);
    await Promise.all([
      new OutboxRelay(prisma, redis).relay(),
      new OutboxRelay(other, redis).relay(),
    ]);

    const sent = redis.sent.map((m) => m.event['id']);
    expect(sent).toHaveLength(150);
    expect(new Set(sent)).toEqual(new Set(ids));
  });

  it('adds one job per registered consumer, named by the event id, and none for other kinds', async () => {
    const added: { name: string; data: unknown; jobId?: string }[] = [];
    const consumer: EventConsumer = {
      kinds: ['quote.sent'],
      queue: {
        add: async (name, data, options) => {
          added.push({ data, jobId: options.jobId, name });
          return {};
        },
      },
    };
    const relay = new OutboxRelay(prisma, new FakeRedis(), [consumer]);
    await recorded(1);
    await prisma.$transaction((tx) =>
      outbox.record(tx, {
        audience: { accountId: 'a1', type: 'account' },
        kind: 'account.updated',
        payload: {},
        subjectId: 'a1',
      }),
    );
    const [row] = await prisma.outboxEvent.findMany({
      where: { kind: 'quote.sent' },
    });

    await relay.relay();

    expect(added).toEqual([
      {
        data: {
          id: String(row?.id),
          kind: 'quote.sent',
          payload: row?.payload,
          subjectId: row?.subjectId,
        },
        jobId: `event-${row?.id}`,
        name: 'event',
      },
    ]);
  });

  it('leaves the events waiting when a consumer’s queue cannot take the job', async () => {
    const consumer: EventConsumer = {
      kinds: ['quote.sent'],
      queue: {
        add: async () => {
          throw new Error('queue unavailable');
        },
      },
    };
    await recorded(1);

    await expect(
      new OutboxRelay(prisma, new FakeRedis(), [consumer]).relay(),
    ).rejects.toThrow('queue unavailable');

    expect(await waiting()).toBe(1);
  });

  it('deletes relayed rows older than 7 days and keeps the rest', async () => {
    const now = new Date();
    const day = 24 * 60 * 60_000;
    const rows = [
      new Date(now.getTime() - 8 * day),
      new Date(now.getTime() - 6 * day),
      null,
    ].map((relayedAt) => ({
      audience: ['system'],
      kind: 'live.test',
      payload: {},
      relayedAt,
      subjectId: randomUUID(),
    }));
    await prisma.outboxEvent.createMany({ data: rows });

    expect(await new OutboxRelay(prisma, new FakeRedis()).sweep(now)).toBe(1);

    const left = await prisma.outboxEvent.findMany({
      select: { subjectId: true },
      where: { subjectId: { in: rows.map((r) => r.subjectId) } },
    });
    expect(left.map((r) => r.subjectId).sort()).toEqual(
      rows
        .slice(1)
        .map((r) => r.subjectId)
        .sort(),
    );
  });

  it('logs an error when the oldest waiting event is older than 30 seconds, at most once in 30 seconds', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const redis = new FakeRedis();
    redis.down = true;
    await prisma.outboxEvent.create({
      data: {
        audience: ['system'],
        createdAt: new Date(Date.now() - 40_000),
        kind: 'live.test',
        payload: {},
        subjectId: randomUUID(),
      },
    });
    const relay = new OutboxRelay(prisma, redis);

    await relay.relay().catch(() => undefined);
    await relay.relay().catch(() => undefined);

    const lag = error.mock.calls.filter(([m]) => /lag/i.test(String(m)));
    expect(lag).toHaveLength(1);
  });

  it('logs nothing about lag for a fresh event', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await recorded(1);

    await new OutboxRelay(prisma, new FakeRedis()).relay();

    expect(error).not.toHaveBeenCalled();
  });
});

describe('the relay loop', () => {
  it('relays an event recorded while it runs within a second, and stops', async () => {
    const redis = new FakeRedis();
    const relay = new OutboxRelay(prisma, redis);
    relay.start();
    try {
      const [id] = await recorded(1);
      const until = Date.now() + 1_000;
      while (redis.sent.length === 0 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(redis.sent.map((m) => m.event['id'])).toEqual([id]);
    } finally {
      await relay.stop();
    }
  });

  it('keeps polling after a failed batch', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const redis = new FakeRedis();
    redis.down = true;
    const relay = new OutboxRelay(prisma, redis);
    await recorded(1);
    relay.start();
    try {
      await new Promise((r) => setTimeout(r, 500));
      redis.down = false;
      const until = Date.now() + 1_000;
      while (redis.sent.length === 0 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(redis.sent).toHaveLength(1);
    } finally {
      await relay.stop();
    }
  });
});

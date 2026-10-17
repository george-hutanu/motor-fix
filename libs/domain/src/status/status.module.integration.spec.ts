import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { liveProbes, type RunOptions, runChecks } from './run';
import { STATUS_QUEUE, StatusModule } from './status.module';
import { parseThresholds } from './thresholds';
import { serialDatabase } from '../auth/serial-db.testing';
import { type EventPort, outbox } from '../events/event.port';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';
import { borrowStore, returnStore } from '../store/store';

const redisUrl = redisUrlFor(5);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

// Fixture limits: not the build team's defaults.
const raw = JSON.stringify({
  api: { amber_ms: 1000, red_ms: 5000 },
  backup: { amber_h: 26, red_h: 50 },
  email: { amber_ms: 1000, amber_share: 0.1, red_ms: 5000, red_share: 0.5 },
  maps: { amber_ms: 1000, red_ms: 5000 },
  notifications: {
    amber_age_s: 300,
    amber_share: 0.1,
    red_age_s: 900,
    red_share: 0.5,
  },
  search: { amber_ms: 1000, red_ms: 5000 },
});

// The public web address and the e-mail provider, standing in.
let web: Server;
let base: string;
let readyStatus = 200;
const requests: string[] = [];
const notifications = new Queue('notifications', {
  connection: { url: redisUrl },
});
const jobs = new Queue(STATUS_QUEUE, { connection: { url: redisUrl } });
let store: Redis;

let clock = new Date('2026-10-17T10:00:00Z').getTime();
const tick = (seconds = 30) => {
  clock += seconds * 1000;
  return new Date(clock);
};

const options = (over: Partial<RunOptions> = {}): RunOptions => ({
  backup: async () => new Date(clock - 3 * 3_600_000),
  brevo: { apiKey: 'test-key', apiUrl: base },
  places: { provider: 'fake' },
  webUrl: base,
  ...over,
});

const run = (over: Partial<RunOptions> = {}, events: EventPort = outbox) => {
  const probes = liveProbes(options(over), prisma, notifications);
  return runChecks({
    events,
    prisma,
    probes: { ...probes, now: () => new Date(clock) },
    samples: store,
    thresholds: parseThresholds(raw),
  });
};

const tiles = () => prisma.statusTile.findMany({ orderBy: { key: 'asc' } });
const changes = () =>
  prisma.outboxEvent.findMany({
    orderBy: { createdAt: 'asc' },
    where: { kind: 'status_tile.changed' },
  });

beforeAll(async () => {
  web = createServer((req, res) => {
    requests.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/health/ready')) {
      res.statusCode = readyStatus;
      res.end('{"status":"ok"}');
    } else if (req.url?.startsWith('/api/v1/brands/popular')) {
      res.end('[{"slug":"dacia"}]');
    } else if (req.url?.startsWith('/api/v1/search/garages')) {
      res.end('{"items":[]}');
    } else if (req.url?.startsWith('/account')) {
      res.end('{"email":"ops@example.test"}');
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((done) => web.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
  store = borrowStore(redisUrl);
});

afterAll(async () => {
  await new Promise((done) => web.close(done));
  await notifications.close();
  await jobs.close();
  await returnStore(store);
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE status_tile, outbox_event');
  await notifications.obliterate({ force: true });
  await jobs.obliterate({ force: true });
  const keys = await store.keys('status:samples:*');
  if (keys.length) await store.del(...keys);
  readyStatus = 200;
  requests.length = 0;
});

// @traces 294-FR-002
// @traces 294-FR-008
// @traces 294-FR-009
// @traces 294-FR-012
describe('the first run', () => {
  it('creates the six tiles and one admin event for each', async () => {
    const at = tick();
    await run();

    const rows = await tiles();
    expect(rows.map((row) => [row.key, row.state])).toEqual([
      ['api', 'green'],
      ['search', 'green'],
      ['maps', 'green'],
      ['email', 'green'],
      ['notifications', 'green'],
      ['backup', 'green'],
    ]);
    for (const row of rows) {
      expect(row.since).toEqual(at);
      expect(row.checkedAt).toEqual(at);
      expect(row.pendingState).toBeNull();
    }
    const events = await changes();
    expect(events).toHaveLength(6);
    for (const event of events) {
      expect(event.audience).toEqual(['admin']);
      expect(event.payload).toEqual({
        since: at.toISOString(),
        state: 'green',
        tile: event.subjectId,
      });
    }
  });

  it('stores a red tile with its reason when the backup bucket is not set', async () => {
    await run({ backup: undefined });
    const backup = await prisma.statusTile.findUniqueOrThrow({
      where: { key: 'backup' },
    });
    expect(backup.state).toBe('red');
    expect(backup.detail).toEqual({ reason: 'not_configured' });
  });
});

// @traces 294-FR-007
// @traces 294-FR-009
// @traces 294-FR-010
// @traces 294-FR-012
describe('a later run', () => {
  it('writes no event when nothing changed, but records the check', async () => {
    tick();
    await run();
    const at = tick();
    await run();
    expect(await changes()).toHaveLength(6);
    const api = await prisma.statusTile.findUniqueOrThrow({
      where: { key: 'api' },
    });
    expect(api.checkedAt).toEqual(at);
  });

  it('changes a tile on the second agreeing check, in one transaction with its event', async () => {
    tick();
    await run();
    readyStatus = 503;
    const first = tick();
    await run();
    let api = await prisma.statusTile.findUniqueOrThrow({
      where: { key: 'api' },
    });
    expect([api.state, api.pendingState, api.pendingSince]).toEqual([
      'green',
      'red',
      first,
    ]);
    expect(await changes()).toHaveLength(6);

    tick();
    await run();
    api = await prisma.statusTile.findUniqueOrThrow({ where: { key: 'api' } });
    expect([api.state, api.since, api.pendingState]).toEqual([
      'red',
      first,
      null,
    ]);
    const events = await changes();
    expect(events).toHaveLength(7);
    expect(events.at(-1)?.payload).toEqual({
      since: first.toISOString(),
      state: 'red',
      tile: 'api',
    });
    // One tile down changes no other.
    expect((await tiles()).filter((row) => row.state !== 'green')).toHaveLength(
      1,
    );
  });

  it('writes neither the tiles nor the events when the event cannot be recorded', async () => {
    const failing: EventPort = {
      record: async () => {
        throw new Error('outbox down');
      },
    };
    await expect(run({}, failing)).rejects.toThrow('outbox down');
    expect(await tiles()).toEqual([]);
  });

  it('keeps every state across a restart: a fresh run starts from the stored rows', async () => {
    readyStatus = 503;
    tick();
    await run();
    tick();
    await run();
    // A new worker reads what the old one stored.
    tick();
    await run();
    const api = await prisma.statusTile.findUniqueOrThrow({
      where: { key: 'api' },
    });
    expect(api.state).toBe('red');
    expect(await changes()).toHaveLength(6);
  });

  it('adds no latency sample for a failed check', async () => {
    readyStatus = 503;
    tick();
    await run();
    expect(await store.zcard('status:samples:api')).toBe(0);
    expect(await store.zcard('status:samples:search')).toBe(1);
  });

  it('probes maps on every other run only', async () => {
    tick();
    await run();
    const second = tick();
    await run();
    let maps = await prisma.statusTile.findUniqueOrThrow({
      where: { key: 'maps' },
    });
    expect(maps.checkedAt).not.toEqual(second);
    const third = tick();
    await run();
    maps = await prisma.statusTile.findUniqueOrThrow({
      where: { key: 'maps' },
    });
    expect(maps.checkedAt).toEqual(third);
  });
});

// @traces 294-FR-002
// @traces 294-FR-003
// @traces 294-FR-010
describe('the probes', () => {
  it('search without the log flag, so no search is recorded', async () => {
    tick();
    await run();
    tick();
    await run();
    const searches = requests.filter((url) => url.startsWith('/api/v1/search'));
    expect(searches).toHaveLength(2);
    for (const url of searches) {
      expect(new URL(url, base).searchParams.has('log')).toBe(false);
    }
    expect(await prisma.searchLog.count()).toBe(0);
  });

  it('let one throwing probe fail only its own tile', async () => {
    const probes = liveProbes(options(), prisma, notifications);
    tick();
    await runChecks({
      events: outbox,
      prisma,
      probes: {
        ...probes,
        now: () => new Date(clock),
        oldestWaiting: async () => {
          throw new Error('store down');
        },
      },
      samples: store,
      thresholds: parseThresholds(raw),
    });
    const rows = await tiles();
    expect(rows).toHaveLength(6);
    expect(
      rows.filter((row) => row.state === 'red').map((row) => row.key),
    ).toEqual(['notifications']);
  });

  it('count the failed e-mails of the last 15 minutes from the notification table', async () => {
    const id = await account('driver');
    const row = (status: 'sent' | 'failed', minutesAgo: number) => ({
      accountId: id,
      channel: 'email' as const,
      createdAt: new Date(clock - minutesAgo * 60_000),
      eventId: `event-${status}-${minutesAgo}`,
      kind: 'test',
      status,
    });
    await prisma.notification.createMany({
      data: [
        row('sent', 1),
        row('failed', 2),
        row('failed', 3),
        row('failed', 20),
      ],
    });
    await run();
    const email = await prisma.statusTile.findUniqueOrThrow({
      where: { key: 'email' },
    });
    expect(email.state).toBe('red');
    expect(email.detail).toMatchObject({ failed_share: 2 / 3 });
  });

  it('read the age of the oldest waiting notification job', async () => {
    await notifications.add('send', {}, { timestamp: clock - 400_000 });
    await run();
    const tile = await prisma.statusTile.findUniqueOrThrow({
      where: { key: 'notifications' },
    });
    expect(tile.state).toBe('amber');
    expect(tile.detail).toMatchObject({ oldest_waiting_s: 400 });
  });
});

// @traces 294-FR-001
// @traces 294-FR-011
describe('the worker job', () => {
  const boot = async (thresholds: string | undefined) => {
    const app = await Test.createTestingModule({
      imports: [
        StatusModule.registerWorker({
          ...options(),
          databaseUrl,
          redisUrl,
          thresholds,
        }),
      ],
    }).compile();
    await app.init();
    return app;
  };

  it('runs every 30 seconds once the limits are set, and its first run stores the tiles', async () => {
    const app = await boot(raw);
    try {
      const [scheduler] = await jobs.getJobSchedulers();
      expect(scheduler).toMatchObject({ every: 30_000, key: 'status-checks' });
      const deadline = Date.now() + 15_000;
      while ((await prisma.statusTile.count()) < 6 && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 200));
      }
      expect(await prisma.statusTile.count()).toBe(6);
    } finally {
      await app.close();
    }
  }, 30_000);

  it.each([
    ['unset', undefined],
    ['invalid', '{"api":{}}'],
  ])(
    'does not start when STATUS_THRESHOLDS is %s, and says so once',
    async (_, value) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        const app = await boot(value);
        await app.close();
        expect(await jobs.getJobSchedulers()).toEqual([]);
        const named = warn.mock.calls.filter(([message]) =>
          String(message).includes('STATUS_THRESHOLDS'),
        );
        expect(named).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    },
  );
});

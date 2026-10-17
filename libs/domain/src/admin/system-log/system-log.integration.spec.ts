import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { systemLog } from './system-log';
import { createPrisma } from '../../auth/prisma';
import { serialDatabase } from '../../auth/serial-db.testing';
import { LIVE_CHANNEL } from '../../events/live/live.hub';
import {
  databaseUrl,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { borrowStore, returnStore } from '../../store/store';

const redisUrl = redisUrlFor(7);
serialDatabase(databaseUrl);

const prisma = createPrisma(databaseUrl);
let store: Redis;
let listener: Redis;
const heard: unknown[] = [];

const at = new Date('2026-10-17T10:41:27.000Z');
const rows = () =>
  prisma.systemLogEntry.findMany({
    orderBy: [{ minute: 'asc' }, { at: 'asc' }],
  });
const settle = () => new Promise((done) => setTimeout(done, 150));

beforeAll(async () => {
  store = borrowStore(redisUrl);
  listener = new Redis(redisUrl);
  await listener.subscribe(LIVE_CHANNEL);
  listener.on('message', (_, message: string) =>
    heard.push(JSON.parse(message)),
  );
});

afterAll(async () => {
  systemLog.stop();
  await listener.quit();
  await returnStore(store);
  await prisma.$disconnect();
});

beforeEach(async () => {
  systemLog.start({ prisma, redis: store });
  await prisma.$executeRawUnsafe('TRUNCATE system_log_entry');
  heard.length = 0;
});

afterEach(() => {
  systemLog.stop();
  jest.restoreAllMocks();
});

// @traces 297-FR-001
// @traces 297-FR-002
// @traces 297-FR-003
describe('a write', () => {
  it('stores one entry with its time, source, severity, kind, message, context and a count of 1', async () => {
    const outcome = await systemLog.write(
      'status_changed',
      'maps',
      { figure: 'latency_ms', latency_ms: 1900, limit: 1500, state: 'amber' },
      at,
    );

    expect(outcome).toBe('written');
    const [row] = await rows();
    expect(row).toMatchObject({
      at,
      context: {
        figure: 'latency_ms',
        latency_ms: 1900,
        limit: 1500,
        state: 'amber',
      },
      count: 1,
      fingerprint: 'amber',
      kind: 'status_changed',
      message: 'Maps: response time went above 1.5 s.',
      minute: new Date('2026-10-17T10:41:00.000Z'),
      severity: 'warning',
      source: 'maps',
    });
  });

  it('takes the time of the write when the caller gives none', async () => {
    const before = Date.now();
    await systemLog.write('deploy', 'worker', { version: 'a1b2c3d' });
    const [row] = await rows();
    expect(row?.at.getTime()).toBeGreaterThanOrEqual(before - 5);
    expect(row?.at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it.each([
    ['an unknown kind', 'garage_updated', 'api'],
    ['an unknown source', 'deploy', 'billing'],
  ])('refuses %s and stores nothing', async (_, kind, source) => {
    const outcome = await systemLog.write(
      kind as never,
      source as never,
      { version: 'a1b2c3d' } as never,
      at,
    );
    expect(outcome).toBe('dropped');
    expect(await rows()).toEqual([]);
  });
});

// @traces 297-FR-003
describe('grouping', () => {
  const error = { provider: 'brevo', status: 503 } as const;

  it('folds 40 writes of one error in one minute into one entry counting 40, even all at once', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 40 }, (_, n) =>
        systemLog.write(
          'service_error',
          'email',
          error,
          new Date(at.getTime() + n * 100),
        ),
      ),
    );
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]?.count).toBe(40);
    expect(outcomes.filter((o) => o === 'written')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'grouped')).toHaveLength(39);
  });

  it('starts a second entry across a minute boundary', async () => {
    await systemLog.write('service_error', 'email', error, at);
    await systemLog.write(
      'service_error',
      'email',
      error,
      new Date('2026-10-17T10:42:00.000Z'),
    );
    expect((await rows()).map((row) => row.count)).toEqual([1, 1]);
  });

  it('keeps another fingerprint, kind or source apart', async () => {
    await systemLog.write('service_error', 'email', error, at);
    await systemLog.write(
      'service_error',
      'email',
      { provider: 'brevo', status: 429 },
      at,
    );
    await systemLog.write('service_error', 'notifications', error, at);
    await systemLog.write(
      'server_error',
      'api',
      { method: 'GET', route: '/api/v1/a' },
      at,
    );
    await systemLog.write(
      'server_error',
      'api',
      { method: 'GET', route: '/api/v1/b' },
      at,
    );
    expect(await rows()).toHaveLength(5);
  });

  it('moves only the count, leaving the first time, message and context', async () => {
    await systemLog.write('check_failed', 'search', { reason: 'timeout' }, at);
    await systemLog.write(
      'check_failed',
      'search',
      { reason: 'timeout' },
      new Date(at.getTime() + 20_000),
    );
    const [row] = await rows();
    expect(row).toMatchObject({
      at,
      context: { reason: 'timeout' },
      count: 2,
      message: 'Search: check failed (timeout).',
    });
  });
});

// @traces 297-FR-004
describe('the caller never pays', () => {
  it('keeps the entry when the caller rolls its own work back', async () => {
    await expect(
      prisma.$transaction(async () => {
        await systemLog.write('deploy', 'worker', { version: 'a1b2c3d' }, at);
        throw new Error('caller failed');
      }),
    ).rejects.toThrow('caller failed');
    expect(await rows()).toHaveLength(1);
  });

  it('drops an entry it cannot write, says so once with the kind and source only, and never throws', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const broken = createPrisma('postgresql://localhost:1/nowhere');
    systemLog.stop();
    systemLog.start({ prisma: broken, redis: store });
    try {
      const outcome = await systemLog.write(
        'check_failed',
        'email',
        { reason: 'refused for ion.popescu@example.com' },
        at,
      );
      expect(outcome).toBe('dropped');
      expect(error).toHaveBeenCalledTimes(1);
      const [line] = error.mock.calls[0] as [string];
      expect(line).toContain('check_failed');
      expect(line).toContain('email');
      expect(line).not.toContain('ion.popescu');
      expect(line).not.toContain('check failed (');
    } finally {
      await broken.$disconnect();
    }
  });

  it('leaves the caller work in place when the entry fails inside its transaction', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const broken = createPrisma('postgresql://localhost:1/nowhere');
    systemLog.stop();
    systemLog.start({ prisma: broken, redis: store });
    try {
      const kept = await prisma.$transaction(async (tx) => {
        const outcome = await systemLog.write(
          'deploy',
          'worker',
          { version: 'a1b2c3d' },
          at,
        );
        const [{ one }] = await tx.$queryRaw<
          { one: number }[]
        >`select 1 as one`;
        return [outcome, one];
      });
      expect(kept).toEqual(['dropped', 1]);
    } finally {
      await broken.$disconnect();
    }
  });

  it('drops a write while it is stopped, without throwing', async () => {
    systemLog.stop();
    await expect(
      systemLog.write('deploy', 'worker', { version: 'a1b2c3d' }, at),
    ).resolves.toBe('dropped');
    systemLog.start({ prisma, redis: store });
    expect(await rows()).toEqual([]);
  });
});

// @traces 297-FR-003
describe('personal data', () => {
  it('is masked in the message, the fingerprint and every string of the context', async () => {
    const reason = 'refused ion.popescu@example.com 0722 123 456 B 123 ABC';
    await systemLog.write('check_failed', 'email', { reason }, at);
    const [row] = await rows();
    const text = JSON.stringify(row);
    expect(text).not.toMatch(/popescu|0722|123 456|B 123 ABC/);
    expect(row?.fingerprint).toBe('refused *** *** ***');
    expect(row?.context).toEqual({ reason: 'refused *** *** ***' });
    expect(row?.message).toBe('E-mail: check failed (refused *** *** ***).');
  });
});

// @traces 297-FR-005 299-FR-019
describe('the live nudge', () => {
  it('tells only the admins about a new entry, with its id, time, kind, severity and source', async () => {
    await systemLog.write('deploy', 'worker', { version: 'a1b2c3d' }, at);
    await settle();
    const [row] = await rows();
    expect(heard).toEqual([
      {
        audience: ['admin'],
        event: {
          at: at.toISOString(),
          entryKind: 'deploy',
          id: row?.id,
          kind: 'system_log.added',
          severity: 'info',
          source: 'worker',
        },
      },
    ]);
  });

  it('stays quiet when an entry only counts one more', async () => {
    await systemLog.write('deploy', 'worker', { version: 'a1b2c3d' }, at);
    await systemLog.write('deploy', 'worker', { version: 'a1b2c3d' }, at);
    await settle();
    expect(heard).toHaveLength(1);
  });

  it('keeps the entry and warns when the nudge cannot be sent', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    systemLog.stop();
    systemLog.start({
      prisma,
      redis: {
        publish: async () => {
          throw new Error('store down');
        },
      },
    });
    await expect(
      systemLog.write('deploy', 'worker', { version: 'a1b2c3d' }, at),
    ).resolves.toBe('written');
    expect(await rows()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

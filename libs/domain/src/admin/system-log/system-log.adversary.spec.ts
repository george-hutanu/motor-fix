import { entryOf, KINDS, minuteOf, SOURCES } from './entry';
import { purgeSystemLog } from './purge';
import { systemLog } from './system-log';
import { limitCrossed } from '../../status/tiles';

const at = new Date('2026-10-17T10:41:27.512Z');

const exploding = new Proxy(
  {},
  {
    get() {
      throw new Error('database unavailable');
    },
  },
) as never;

// @traces 297-FR-004
describe('the writer when it cannot write', () => {
  afterEach(() => systemLog.stop());

  it('resolves dropped before it was started', async () => {
    systemLog.stop();
    await expect(
      systemLog.write('deploy', 'worker', { version: 'a1' }),
    ).resolves.toBe('dropped');
  });

  it('resolves dropped after it was stopped', async () => {
    systemLog.start({ prisma: exploding, redis: exploding });
    systemLog.stop();
    await expect(
      systemLog.write('deploy', 'worker', { version: 'a1' }),
    ).resolves.toBe('dropped');
  });

  it('resolves dropped when the database throws synchronously', async () => {
    systemLog.start({ prisma: exploding, redis: exploding });
    await expect(
      systemLog.write('deploy', 'worker', { version: 'a1' }),
    ).resolves.toBe('dropped');
  });

  it('resolves dropped when the database rejects', async () => {
    const prisma = {
      $executeRaw: () => Promise.reject(new Error('down')),
      $queryRaw: () => Promise.reject(new Error('down')),
      systemLogEntry: {
        create: () => Promise.reject(new Error('down')),
        upsert: () => Promise.reject(new Error('down')),
      },
    } as never;
    systemLog.start({ prisma, redis: exploding });
    await expect(
      systemLog.write('server_error', 'api', { method: 'GET', route: '/x' }),
    ).resolves.toBe('dropped');
  });
});

// @traces 297-FR-002
describe('the writer given a kind or source outside the lists', () => {
  afterEach(() => systemLog.stop());

  it.each([
    ['garage_updated', 'api'],
    ['deploy', 'billing'],
    ['', ''],
    ['constructor', 'api'],
    ['__proto__', 'api'],
    ['deploy', 'toString'],
  ])('never rejects and never stores %s from %s', async (kind, source) => {
    const create = jest.fn();
    const prisma = new Proxy(
      { systemLogEntry: { create, upsert: create } },
      {
        get(target, prop) {
          if (prop in target) return (target as never)[prop];
          create();
          throw new Error('touched');
        },
      },
    ) as never;
    systemLog.start({ prisma, redis: exploding });
    const outcome = await systemLog.write(
      kind as never,
      source as never,
      {
        version: 'v',
      } as never,
    );
    expect(outcome).toBe('dropped');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 42, {}])(
    'never rejects for kind %p',
    async (kind) => {
      systemLog.start({ prisma: exploding, redis: exploding });
      await expect(
        systemLog.write(kind as never, 'api', {} as never),
      ).resolves.toBe('dropped');
    },
  );
});

// @traces 297-FR-002
describe('the writer with hostile names', () => {
  afterEach(() => systemLog.stop());

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'drops the inherited property name %s as a kind',
    async (kind) => {
      systemLog.start({ prisma: exploding, redis: exploding });
      await expect(
        systemLog.write(kind as never, 'api', {} as never, at),
      ).resolves.toBe('dropped');
    },
  );

  it.each(['constructor', '__proto__', 'Api', 'API', ' api'])(
    'drops %p as a source',
    async (source) => {
      systemLog.start({ prisma: exploding, redis: exploding });
      await expect(
        systemLog.write('deploy', source as never, { version: 'v' }, at),
      ).resolves.toBe('dropped');
    },
  );

  it('derives an entry for every kind with every source', () => {
    const contexts: Record<string, unknown> = {
      backup_completed: { backup_at: '2026-10-17T03:00:00.000Z' },
      backup_failed: { last_backup_at: 'x', reason: 'late' },
      check_failed: { reason: 'timeout' },
      deploy: { version: 'v1' },
      job_failed: { attempts: 3, error_code: 'E', job: 'j', queue: 'q' },
      server_error: { method: 'GET', route: '/a' },
      service_error: { provider: 'brevo', status: 500 },
      status_changed: { state: 'green' },
    };
    for (const kind of KINDS) {
      for (const source of SOURCES) {
        const e = entryOf(kind, source, contexts[kind] as never, at);
        expect(e?.message.length).toBeGreaterThan(0);
        expect(['info', 'warning', 'error']).toContain(e?.severity);
      }
    }
  });
});

// @traces 297-FR-003
describe('minuteOf at its edges', () => {
  it('keeps 10:40:59.999 and 10:41:00.000 in different minutes', () => {
    expect(minuteOf(new Date('2026-10-17T10:40:59.999Z'))).toEqual(
      new Date('2026-10-17T10:40:00.000Z'),
    );
    expect(minuteOf(new Date('2026-10-17T10:41:00.000Z'))).toEqual(
      new Date('2026-10-17T10:41:00.000Z'),
    );
  });

  it('floors a time before 1970 downward', () => {
    expect(minuteOf(new Date(-1))).toEqual(new Date(-60_000));
  });

  it('is idempotent and does not mutate its argument', () => {
    const t = new Date('2026-10-17T10:41:27.512Z');
    const m = minuteOf(t);
    expect(minuteOf(m)).toEqual(m);
    expect(t.toISOString()).toBe('2026-10-17T10:41:27.512Z');
  });

  it('gives an invalid date no valid minute', () => {
    expect(Number.isNaN(minuteOf(new Date('nope')).getTime())).toBe(true);
  });
});

// @traces 297-FR-012
describe('purgeSystemLog', () => {
  const deleteMany = jest.fn();
  const prisma = { systemLogEntry: { deleteMany } } as never;
  const now = new Date('2026-10-17T00:30:00.000Z');

  beforeEach(() => {
    deleteMany.mockReset().mockResolvedValue({ count: 7 });
  });

  it('deletes strictly older than 90 days and returns the count', async () => {
    await expect(purgeSystemLog(prisma, now)).resolves.toBe(7);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { at: { lt: new Date('2026-07-19T00:30:00.000Z') } },
    });
  });

  it('returns 0 when nothing is old enough', async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    await expect(purgeSystemLog(prisma, now)).resolves.toBe(0);
  });

  it('propagates a database failure so the job is alerted', async () => {
    deleteMany.mockRejectedValue(new Error('down'));
    await expect(purgeSystemLog(prisma, now)).rejects.toThrow('down');
  });
});

// @traces 297-FR-006
describe('limitCrossed at its boundary', () => {
  const limits = { amber_ms: 1500, red_ms: 3000 } as never;

  it('is the amber limit exactly at the limit', () => {
    expect(limitCrossed({ latency_ms: 1500 }, limits, 'amber')).toEqual({
      figure: 'latency_ms',
      limit: 1500,
    });
  });

  it('is null one under the limit', () => {
    expect(limitCrossed({ latency_ms: 1499 }, limits, 'amber')).toBeNull();
  });

  it('is the red limit for red', () => {
    expect(limitCrossed({ latency_ms: 3000 }, limits, 'red')).toEqual({
      figure: 'latency_ms',
      limit: 3000,
    });
  });

  it('is null for empty figures, null figures and an empty limits object', () => {
    expect(limitCrossed({}, limits, 'red')).toBeNull();
    expect(limitCrossed(null, limits, 'red')).toBeNull();
    expect(limitCrossed({ latency_ms: 9e9 }, {} as never, 'red')).toBeNull();
  });

  it('is null for NaN figures', () => {
    expect(limitCrossed({ latency_ms: Number.NaN }, limits, 'red')).toBeNull();
  });

  it('is null for green however large the figure', () => {
    expect(limitCrossed({ latency_ms: 9e9 }, limits, 'green')).toBeNull();
  });
});

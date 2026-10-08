import { diag } from '@opentelemetry/api';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import { observeDataStores } from './observe';
import type { MonitorSession } from './postgres';
import { startTelemetry } from '../setup/start';
import { inMemory } from '../testing/in-memory';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);

const INFO =
  'used_memory:2048\r\nmaxmemory:0\r\nconnected_clients:4\r\nevicted_keys:1\r\nkeyspace_hits:10\r\nkeyspace_misses:2\r\ndb0:keys=7,expires=0\r\n';
const STATS = {
  commit: 5,
  deadlocks: 0,
  locks: 0,
  max: 100,
  rollback: 1,
  size: 9,
};

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  jest.restoreAllMocks();
  jest.useRealTimers();
});
afterAll(() => started?.shutdown());

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function postgres(
  slow: () => Promise<unknown[]> = async () => [],
  stats: () => Promise<unknown[]> = async () => [STATS],
) {
  const query = jest.fn(<T>(text: string): Promise<T[]> => {
    const answer = text.includes('pg_stat_statements')
      ? slow
      : text.includes('GROUP BY')
        ? async () => [{ count: 1, state: 'active' }]
        : stats;
    return answer() as Promise<T[]>;
  });
  return { query: query as typeof query & MonitorSession['query'] };
}
const redis = (info: () => Promise<string> = async () => INFO) => ({
  info: jest.fn(info),
});
const outbox = (seconds: () => Promise<number> = async () => 1) => ({
  oldestPendingSeconds: jest.fn(seconds),
});

function observe(options: Parameters<typeof observeDataStores>[0]) {
  const stop = observeDataStores({ intervalMs: 20, ...options });
  stops.push(stop);
  return stop;
}

async function points(name: string) {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<number>[])
    .map((point) => ({ attributes: point.attributes, value: point.value }));
}
const value = async (name: string, attributes: Record<string, string> = {}) =>
  (await points(name)).find(
    (point) => JSON.stringify(point.attributes) === JSON.stringify(attributes),
  )?.value;

describe('observeDataStores under failing readers', () => {
  it('reports Redis down when info throws synchronously, and the others as usual', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: {
        info: () => {
          throw new Error('sync boom');
        },
      },
    });
    await tick(10);
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(0);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(1);
    expect(await value('motorfix_outbox_oldest_pending_seconds')).toBe(1);
  });

  it('reports PostgreSQL down when query throws synchronously', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      outbox: outbox(),
      postgres: {
        query: () => {
          throw new Error('sync boom');
        },
      },
      redis: redis(),
    });
    await tick(10);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(0);
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(1);
  });

  it('leaves the outbox figure out when its reader throws synchronously', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      outbox: {
        oldestPendingSeconds: () => {
          throw new Error('sync boom');
        },
      },
      postgres: postgres(),
      redis: redis(),
    });
    await tick(10);
    expect(await points('motorfix_outbox_oldest_pending_seconds')).toEqual([]);
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(1);
  });

  it('keeps the other stores reporting while one reader never resolves', async () => {
    observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis(() => new Promise(() => undefined)),
    });
    await tick(30);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(1);
    expect(await value('motorfix_outbox_oldest_pending_seconds')).toBe(1);
  });

  it('keeps reading Redis next cycle after a hung PostgreSQL reading times out', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'performance', 'hrtime'],
    });
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    const store = redis();
    observe({
      intervalMs: 1_000,
      outbox: outbox(),
      postgres: postgres(undefined, () => new Promise(() => undefined)),
      redis: store,
    });
    await jest.advanceTimersByTimeAsync(20_000);
    expect(store.info.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('does not report a non-string INFO answer, and marks Redis down', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis((async () => null) as never),
    });
    await tick(10);
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(0);
  });

  it('logs no second error while the same store keeps failing for many cycles', async () => {
    const error = jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis(async () => {
        throw new Error('down');
      }),
    });
    await tick(150);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('observeDataStores under hostile figures', () => {
  it.each([Number.NaN, -30, Number.POSITIVE_INFINITY])(
    'never exports %s as the oldest pending seconds',
    async (seconds) => {
      observe({
        outbox: outbox(async () => seconds),
        postgres: postgres(),
        redis: redis(),
      });
      await tick(10);
      const exported = await value('motorfix_outbox_oldest_pending_seconds');
      expect(
        exported === undefined || (Number.isFinite(exported) && exported >= 0),
      ).toBe(true);
    },
  );

  it('never exports NaN from PostgreSQL figures that are text', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      outbox: outbox(),
      postgres: postgres(undefined, async () => [
        {
          commit: 'x',
          deadlocks: 'y',
          locks: 'z',
          max: 'q',
          rollback: 'w',
          size: 'v',
        },
      ]),
      redis: redis(),
    });
    await tick(10);
    for (const name of [
      'motorfix_pg_connections_max',
      'motorfix_pg_database_size_bytes',
      'motorfix_pg_locks_waiting',
      'motorfix_pg_deadlocks_total',
    ]) {
      const exported = await value(name);
      expect(exported === undefined || Number.isFinite(exported)).toBe(true);
    }
  });

  it('never exports NaN from a Redis INFO full of garbage', async () => {
    observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis(
        async () => 'used_memory:zzz\r\nconnected_clients:-4\r\ndb0:keys=q\r\n',
      ),
    });
    await tick(10);
    for (const name of [
      'motorfix_redis_memory_used_bytes',
      'motorfix_redis_clients_connected',
      'motorfix_redis_keys',
    ]) {
      for (const point of await points(name)) {
        expect(Number.isFinite(point.value)).toBe(true);
      }
    }
  });

  it('exports only db labels 0 to 15 however many dbs INFO lists', async () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `db${i}:keys=1,expires=0`,
    );
    observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis(async () => lines.join('\r\n')),
    });
    await tick(10);
    expect((await points('motorfix_redis_keys')).length).toBeLessThanOrEqual(
      16,
    );
  });

  it('never puts statement text or a queryid in any metric attribute', async () => {
    observe({
      outbox: outbox(),
      postgres: postgres(async () => [
        {
          calls: 9,
          max_exec_time: 2,
          mean_exec_time: 700,
          query: 'SELECT secret_marker FROM t',
          queryid: '424242',
        },
      ]),
      redis: redis(),
    });
    await tick(60);
    const { resourceMetrics } = await memory.metricReader.collect();
    const text = JSON.stringify(
      resourceMetrics.scopeMetrics.flatMap((scope) =>
        scope.metrics.flatMap((metric) =>
          metric.dataPoints.map((point) => point.attributes),
        ),
      ),
    );
    expect(text).not.toContain('secret_marker');
    expect(text).not.toContain('424242');
  });
});

describe('observeDataStores stop and restart', () => {
  it('stops cleanly when called twice', () => {
    const stop = observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis(),
    });
    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });

  it('reports nothing from a reading that resolves after stop', async () => {
    let release: (info: string) => void = () => undefined;
    const stop = observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis(() => new Promise<string>((resolve) => (release = resolve))),
    });
    await tick(5);
    stop();
    release(INFO);
    await tick(10);
    expect(await points('motorfix_redis_clients_connected')).toEqual([]);
    expect(await points('motorfix_datastore_up')).toEqual([]);
  });

  it('logs no error and reports no down store when stop comes before a hung reading times out', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'performance', 'hrtime'],
    });
    const error = jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    const stop = observe({
      intervalMs: 60_000,
      outbox: outbox(),
      postgres: postgres(undefined, () => new Promise(() => undefined)),
      redis: redis(() => new Promise(() => undefined)),
    });
    await jest.advanceTimersByTimeAsync(100);
    stop();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(error).not.toHaveBeenCalled();
    expect(await points('motorfix_datastore_up')).toEqual([]);
  });

  it('starts no new reading after stop even when one was in flight', async () => {
    let release: (info: string) => void = () => undefined;
    const store = redis(
      () => new Promise<string>((resolve) => (release = resolve)),
    );
    const stop = observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: store,
    });
    await tick(5);
    stop();
    release(INFO);
    await tick(80);
    expect(store.info).toHaveBeenCalledTimes(1);
  });

  it('keeps the figures of a second observer independent of the first after the first stops', async () => {
    const first = observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis(),
    });
    await tick(5);
    first();
    observe({
      outbox: outbox(async () => 77),
      postgres: postgres(),
      redis: redis(),
    });
    await tick(30);
    expect(await value('motorfix_outbox_oldest_pending_seconds')).toBe(77);
  });
});

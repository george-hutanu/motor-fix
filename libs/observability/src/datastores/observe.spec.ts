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
  commit: 50,
  deadlocks: 0,
  locks: 2,
  max: 100,
  rollback: 3,
  size: 1_000_000,
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
        ? async () => [
            { count: 2, state: 'active' },
            { count: 5, state: 'idle' },
          ]
        : stats;
    return answer() as Promise<T[]>;
  });
  return { query: query as typeof query & MonitorSession['query'] };
}

const redis = (info: () => Promise<string> = async () => INFO) => ({
  info: jest.fn(info),
});
const outbox = (seconds: () => Promise<number> = async () => 12) => ({
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

const POSTGRES_FIGURES = [
  'motorfix_pg_connections',
  'motorfix_pg_connections_max',
  'motorfix_pg_locks_waiting',
  'motorfix_pg_database_size_bytes',
  'motorfix_pg_transactions_total',
  'motorfix_pg_deadlocks_total',
  'motorfix_pg_slow_statements',
];
const REDIS_FIGURES = [
  'motorfix_redis_memory_used_bytes',
  'motorfix_redis_memory_max_bytes',
  'motorfix_redis_clients_connected',
  'motorfix_redis_evicted_keys_total',
  'motorfix_redis_keyspace_hits_total',
  'motorfix_redis_keyspace_misses_total',
  'motorfix_redis_keys',
];

// @traces 878-FR-003
// @traces 878-FR-005
// @traces 878-FR-006
// @traces 878-FR-007
describe('observeDataStores', () => {
  it('reports the PostgreSQL, Redis and outbox figures after the first reading', async () => {
    observe({ outbox: outbox(), postgres: postgres(), redis: redis() });
    await tick(5);

    expect(await points('motorfix_pg_connections')).toEqual(
      expect.arrayContaining([
        { attributes: { state: 'active' }, value: 2 },
        { attributes: { state: 'idle' }, value: 5 },
        { attributes: { state: 'idle_in_transaction' }, value: 0 },
        { attributes: { state: 'other' }, value: 0 },
      ]),
    );
    expect(await value('motorfix_pg_connections_max')).toBe(100);
    expect(await value('motorfix_pg_locks_waiting')).toBe(2);
    expect(await value('motorfix_pg_database_size_bytes')).toBe(1_000_000);
    expect(
      await value('motorfix_pg_transactions_total', { outcome: 'commit' }),
    ).toBe(50);
    expect(
      await value('motorfix_pg_transactions_total', { outcome: 'rollback' }),
    ).toBe(3);
    expect(await value('motorfix_pg_deadlocks_total')).toBe(0);
    expect(await value('motorfix_pg_slow_statements')).toBe(0);
    expect(await value('motorfix_redis_memory_used_bytes')).toBe(2048);
    expect(await value('motorfix_redis_memory_max_bytes')).toBe(0);
    expect(await value('motorfix_redis_clients_connected')).toBe(4);
    expect(await value('motorfix_redis_evicted_keys_total')).toBe(1);
    expect(await value('motorfix_redis_keyspace_hits_total')).toBe(10);
    expect(await value('motorfix_redis_keyspace_misses_total')).toBe(2);
    expect(await value('motorfix_redis_keys', { db: '0' })).toBe(7);
    expect(await value('motorfix_outbox_oldest_pending_seconds')).toBe(12);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(1);
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(1);
  });

  it('reads again on every interval', async () => {
    const store = redis();
    observe({ outbox: outbox(), postgres: postgres(), redis: store });
    // Poll rather than sleep a fixed 70 ms: a loaded CI runner fires a 20 ms interval late.
    for (
      let waited = 0;
      store.info.mock.calls.length < 3 && waited < 2000;
      waited += 20
    ) {
      await tick(20);
    }
    expect(store.info.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('turns the PostgreSQL readings off with one log line when there is no monitoring session', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    observe({ outbox: outbox(), redis: redis() });
    await tick(50);

    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('MONITOR_DATABASE_URL'));
    expect(lines).toEqual([
      JSON.stringify({
        level: 'info',
        message:
          'datastore metrics: MONITOR_DATABASE_URL unset, PostgreSQL readings off',
      }),
    ]);
    for (const name of POSTGRES_FIGURES) expect(await points(name)).toEqual([]);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(
      undefined,
    );
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(1);
  });

  it('reports a store that fails as down, with none of its figures, and the others as usual', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis(async () => {
        throw new Error('connect ECONNREFUSED');
      }),
    });
    await tick(5);

    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(0);
    for (const name of REDIS_FIGURES) expect(await points(name)).toEqual([]);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(1);
    expect(await value('motorfix_pg_connections_max')).toBe(100);
    expect(await value('motorfix_outbox_oldest_pending_seconds')).toBe(12);
  });

  it('drops a store figures that were read before it went down', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    let down = false;
    observe({
      outbox: outbox(),
      postgres: postgres(undefined, async () => {
        if (down) throw new Error('connection terminated');
        return [STATS];
      }),
      redis: redis(),
    });
    await tick(5);
    expect(await value('motorfix_pg_connections_max')).toBe(100);

    down = true;
    await tick(40);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(0);
    for (const name of POSTGRES_FIGURES) expect(await points(name)).toEqual([]);
  });

  it('logs one error line per failure streak', async () => {
    const error = jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    let failing = true;
    observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: redis(async () => {
        if (failing) throw new Error('connect ECONNREFUSED');
        return INFO;
      }),
    });
    await tick(70);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('redis');

    failing = false;
    await tick(40);
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(1);
    failing = true;
    await tick(40);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('never starts a reading while the previous one is still running', async () => {
    const pending = postgres(() => new Promise(() => undefined));
    observe({ outbox: outbox(), postgres: pending, redis: redis() });
    await tick(80);
    const slowReads = pending.query.mock.calls.filter(([text]) =>
      String(text).includes('pg_stat_statements'),
    );
    expect(slowReads).toHaveLength(1);
  });

  it('counts a PostgreSQL reading that has not answered within 5 s, or Redis within 2 s, as failed', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'performance', 'hrtime'],
    });
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      intervalMs: 60_000,
      outbox: outbox(),
      postgres: postgres(undefined, () => new Promise(() => undefined)),
      redis: redis(() => new Promise(() => undefined)),
    });

    await jest.advanceTimersByTimeAsync(1_999);
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(
      undefined,
    );
    await jest.advanceTimersByTimeAsync(2);
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(0);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(
      undefined,
    );
    await jest.advanceTimersByTimeAsync(3_000);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(0);
  });

  it('reports the other PostgreSQL figures and logs once when the statement view cannot be read', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    observe({
      outbox: outbox(),
      postgres: postgres(async () => {
        throw Object.assign(
          new Error(
            'pg_stat_statements must be loaded via "shared_preload_libraries"',
          ),
          { code: '55000' },
        );
      }),
      redis: redis(),
    });
    await tick(70);

    expect(await points('motorfix_pg_slow_statements')).toEqual([]);
    expect(await value('motorfix_pg_connections_max')).toBe(100);
    expect(await value('motorfix_datastore_up', { store: 'postgres' })).toBe(1);
    const lines = log.mock.calls.filter(([line]) =>
      String(line).includes('pg_stat_statements'),
    );
    expect(lines).toHaveLength(1);
  });

  it('counts the slow statements whose calls grew since the previous reading', async () => {
    // Fake timers: a loaded CI runner fired the 20 ms interval before the first assertion.
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'performance', 'hrtime'],
    });
    let calls = 1;
    observe({
      intervalMs: 60_000,
      outbox: outbox(),
      postgres: postgres(async () => [
        {
          calls: calls++,
          max_exec_time: 900,
          mean_exec_time: 700,
          query: 'SELECT pg_sleep($1)',
          queryid: '5',
        },
      ]),
      redis: redis(),
    });
    await jest.advanceTimersByTimeAsync(5);
    expect(await value('motorfix_pg_slow_statements')).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(await value('motorfix_pg_slow_statements')).toBe(1);
  });

  it('leaves the outbox figure out when its reading fails', async () => {
    jest.spyOn(diag, 'error').mockImplementation(() => undefined);
    observe({
      outbox: outbox(async () => {
        throw new Error('outbox unreachable');
      }),
      postgres: postgres(),
      redis: redis(),
    });
    await tick(5);
    expect(await points('motorfix_outbox_oldest_pending_seconds')).toEqual([]);
    expect(await value('motorfix_datastore_up', { store: 'redis' })).toBe(1);
  });

  it('reads nothing more and reports nothing once stopped', async () => {
    const store = redis();
    const stop = observe({
      outbox: outbox(),
      postgres: postgres(),
      redis: store,
    });
    await tick(5);
    stop();
    const reads = store.info.mock.calls.length;
    await tick(60);

    expect(store.info.mock.calls.length).toBe(reads);
    expect(await points('motorfix_datastore_up')).toEqual([]);
    expect(await points('motorfix_redis_clients_connected')).toEqual([]);
  });
});

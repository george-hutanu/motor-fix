import {
  type BatchObservableResult,
  diag,
  metrics,
  type Observable,
} from '@opentelemetry/api';

import { figure } from './figure';
import {
  logSlowStatements,
  type MonitorSession,
  type PostgresReading,
  readPostgres,
  type SlowBaseline,
} from './postgres';
import { parseRedisInfo, type RedisReading } from './redis';
import { telemetryStarted } from '../setup/start';

interface DataStores {
  // The read-only monitoring session; absent, the PostgreSQL readings are off.
  postgres?: MonitorSession;
  redis: { info(): Promise<string> };
  outbox: { oldestPendingSeconds(): Promise<number> };
  intervalMs?: number;
}

const READ_INTERVAL_MS = 60_000;
const POSTGRES_LIMIT_MS = 5_000;
const REDIS_LIMIT_MS = 2_000;

const info = (message: string) =>
  console.log(JSON.stringify({ level: 'info', message }));

// One store read on a timer: never two readings at once, a reading that
// does not answer within its limit counts as failed, and one error line per
// failure streak. `value` is the last good reading, undefined while down.
function poller<T>(name: string, limitMs: number, read: () => Promise<T>) {
  const state: { up?: boolean; value?: T } = {};
  let busy = false;
  let stopped = false;
  const failed = (error: Error) => {
    if (state.up !== false) {
      diag.error(`datastore metrics: ${name} not read: ${error.message}`);
    }
    state.value = undefined;
    state.up = false;
  };
  const run = async () => {
    if (busy || stopped) return;
    busy = true;
    // A reader that throws before it returns a promise fails this reading
    // like one that rejects.
    const result = await within(Promise.resolve().then(read), limitMs).then(
      (value) => ({ value }),
      (error: Error) => ({ error }),
    );
    busy = false;
    if (stopped) return;
    if ('error' in result) return failed(result.error);
    state.value = result.value;
    state.up = true;
  };
  return {
    run,
    state,
    stop: () => {
      stopped = true;
    },
  };
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${ms} ms`)),
      ms,
    );
    timer.unref?.();
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// Reads PostgreSQL (as the monitoring role), Redis and the outbox every
// 60 s for the data-store figures, and logs the slow statements each
// reading finds. A store that fails reports motorfix_datastore_up 0 and
// none of its figures; the others carry on. Off, with telemetry off.
// Returns the stop function.
export function observeDataStores(stores: DataStores): () => void {
  if (!telemetryStarted()) return () => undefined;
  const meter = metrics.getMeter('motorfix');
  const gauge = (name: string, description: string, unit?: string) =>
    meter.createObservableGauge(name, { description, ...(unit && { unit }) });
  // The store keeps its running totals; they are read as gauges, so a
  // store that goes down drops them with the rest (setup/temporality.ts).
  const counter = gauge;

  let baseline: SlowBaseline | undefined;
  let viewLogged = false;
  const postgres =
    stores.postgres &&
    poller('postgres', POSTGRES_LIMIT_MS, async () => {
      const result = await readPostgres(
        stores.postgres as MonitorSession,
        baseline,
      );
      baseline = result.baseline;
      if (result.viewError && !viewLogged) {
        info(
          `datastore metrics: pg_stat_statements not readable, slow statements off: ${result.viewError}`,
        );
      }
      viewLogged = result.viewError !== undefined;
      logSlowStatements(result.slow);
      return result.reading;
    });
  if (!postgres) {
    info(
      'datastore metrics: MONITOR_DATABASE_URL unset, PostgreSQL readings off',
    );
  }
  const redis = poller('redis', REDIS_LIMIT_MS, async () =>
    parseRedisInfo(await stores.redis.info()),
  );
  const outbox = poller('outbox', POSTGRES_LIMIT_MS, async () =>
    figure(await stores.outbox.oldestPendingSeconds()),
  );

  const pg = {
    connections: gauge('motorfix_pg_connections', 'Sessions by state'),
    deadlocks: counter('motorfix_pg_deadlocks_total', 'Deadlocks detected'),
    locks: gauge('motorfix_pg_locks_waiting', 'Lock requests waiting'),
    max: gauge('motorfix_pg_connections_max', 'max_connections'),
    size: gauge('motorfix_pg_database_size_bytes', 'Database size', 'By'),
    slow: gauge(
      'motorfix_pg_slow_statements',
      'Statements over 500 ms mean whose calls grew since the last reading',
    ),
    transactions: counter(
      'motorfix_pg_transactions_total',
      'Transactions by outcome',
    ),
  };
  const cache = {
    clients: gauge('motorfix_redis_clients_connected', 'Connected clients'),
    evicted: counter('motorfix_redis_evicted_keys_total', 'Keys evicted'),
    hits: counter('motorfix_redis_keyspace_hits_total', 'Key lookups found'),
    keys: gauge('motorfix_redis_keys', 'Keys by database'),
    max: gauge(
      'motorfix_redis_memory_max_bytes',
      'maxmemory, 0 for none',
      'By',
    ),
    misses: counter(
      'motorfix_redis_keyspace_misses_total',
      'Key lookups missed',
    ),
    used: gauge('motorfix_redis_memory_used_bytes', 'Memory used', 'By'),
  };
  const outboxAge = gauge(
    'motorfix_outbox_oldest_pending_seconds',
    'Age of the oldest outbox event not relayed, 0 when none',
    's',
  );
  const up = gauge('motorfix_datastore_up', 'Last reading succeeded, by store');

  const observePostgres = (
    result: BatchObservableResult,
    r: PostgresReading,
  ) => {
    for (const [state, count] of Object.entries(r.connections)) {
      result.observe(pg.connections, count, { state });
    }
    result.observe(pg.max, r.connectionsMax);
    result.observe(pg.locks, r.locksWaiting);
    result.observe(pg.size, r.databaseSizeBytes);
    result.observe(pg.transactions, r.transactions.commit, {
      outcome: 'commit',
    });
    result.observe(pg.transactions, r.transactions.rollback, {
      outcome: 'rollback',
    });
    result.observe(pg.deadlocks, r.deadlocks);
    if (r.slowStatements !== undefined)
      result.observe(pg.slow, r.slowStatements);
  };
  const observeRedis = (result: BatchObservableResult, r: RedisReading) => {
    result.observe(cache.used, r.memoryUsedBytes);
    result.observe(cache.max, r.memoryMaxBytes);
    result.observe(cache.clients, r.clientsConnected);
    result.observe(cache.evicted, r.evictedKeys);
    result.observe(cache.hits, r.keyspaceHits);
    result.observe(cache.misses, r.keyspaceMisses);
    for (const [db, count] of Object.entries(r.keys)) {
      result.observe(cache.keys, count, { db });
    }
  };
  const observeUp = (
    result: BatchObservableResult,
    store: string,
    upNow: boolean | undefined,
  ) => {
    if (upNow !== undefined) result.observe(up, upNow ? 1 : 0, { store });
  };
  const callback = (result: BatchObservableResult) => {
    observeUp(result, 'postgres', postgres?.state.up);
    observeUp(result, 'redis', redis.state.up);
    if (postgres?.state.value) observePostgres(result, postgres.state.value);
    if (redis.state.value) observeRedis(result, redis.state.value);
    if (outbox.state.value !== undefined) {
      result.observe(outboxAge, outbox.state.value);
    }
  };
  const observables: Observable[] = [
    ...Object.values(pg),
    ...Object.values(cache),
    outboxAge,
    up,
  ];
  meter.addBatchObservableCallback(callback, observables);

  const pollers = [postgres, redis, outbox].filter(
    (poll) => poll !== undefined,
  );
  const read = () => {
    for (const poll of pollers) void poll.run();
  };
  const timer = setInterval(read, stores.intervalMs ?? READ_INTERVAL_MS);
  timer.unref();
  read();
  return () => {
    clearInterval(timer);
    for (const poll of pollers) poll.stop();
    meter.removeBatchObservableCallback(callback, observables);
  };
}

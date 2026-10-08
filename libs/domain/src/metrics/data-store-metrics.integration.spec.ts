import { observeDataStores, startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';
import { Client, Pool } from 'pg';

import { DataStoreMetricsModule } from './data-store-metrics.module';
import { serialDatabase } from '../auth/serial-db.testing';
import { until } from '../waits.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  {
    APP_ENV: 'staging',
    DATABASE_URL: databaseUrl,
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
  },
  memory,
);

const PASSWORD = 'monitor-spec-password';
const monitorUrl = (() => {
  const url = new URL(databaseUrl);
  url.username = 'motorfix_monitor';
  url.password = PASSWORD;
  return url.href;
})();

// A loaded machine can miss the reader's 5 s limit once; the next reading
// comes 500 ms later instead of 60 s, and the specs wait for it.
jest.setTimeout(30_000);

const admin = new Client({ connectionString: databaseUrl });
let app: INestApplication;
let eventId: bigint;

async function points(name: string) {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<number>[]);
}

const up = async (store: string) =>
  (await points('motorfix_datastore_up')).find(
    (point) => point.attributes['store'] === store,
  )?.value;

// The probe event below must stay pending: the suites that relay or clear the
// outbox take the database turn, so this one waits for it too.
serialDatabase(databaseUrl);

beforeAll(async () => {
  await admin.connect();
  await admin.query(`ALTER ROLE motorfix_monitor PASSWORD '${PASSWORD}'`);
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO outbox_event (kind, subject_id, audience, created_at)
     VALUES ('metrics.probe', 'probe', '{}', now() - interval '1 hour')
     RETURNING id`,
  );
  eventId = BigInt(rows[0]?.id ?? 0);

  const moduleRef = await Test.createTestingModule({
    imports: [
      DataStoreMetricsModule.register({
        databaseUrl,
        intervalMs: 500,
        monitorUrl,
        redisUrl,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await admin.query('DELETE FROM outbox_event WHERE id = $1', [
    eventId.toString(),
  ]);
  await admin.end();
  await started?.shutdown();
});

// @traces 878-FR-003
// @traces 878-FR-005
// @traces 878-FR-006
// @traces 878-FR-007
// @traces 878-FR-013
describe('DataStoreMetricsModule on a real PostgreSQL and Redis', () => {
  it('reports both stores up after its first reading', async () => {
    expect(await until('PostgreSQL up', () => up('postgres'))).toBe(1);
    expect(await until('Redis up', () => up('redis'))).toBe(1);
  });

  it('reports the PostgreSQL figures, the slow-statement count included', async () => {
    await until('a PostgreSQL reading', () => up('postgres'));
    const [max] = await points('motorfix_pg_connections_max');
    expect(max?.value).toBeGreaterThan(0);
    const [size] = await points('motorfix_pg_database_size_bytes');
    expect(size?.value).toBeGreaterThan(0);
    const connections = await points('motorfix_pg_connections');
    expect(
      connections.map((point) => point.attributes['state']).sort(),
    ).toEqual(['active', 'idle', 'idle_in_transaction', 'other']);
    const commits = (await points('motorfix_pg_transactions_total')).find(
      (point) => point.attributes['outcome'] === 'commit',
    );
    expect(commits?.value).toBeGreaterThan(0);
    expect(await points('motorfix_pg_slow_statements')).toHaveLength(1);
  });

  it('reports the Redis figures', async () => {
    await until('a Redis reading', () => up('redis'));
    const [used] = await points('motorfix_redis_memory_used_bytes');
    expect(used?.value).toBeGreaterThan(0);
    const [clients] = await points('motorfix_redis_clients_connected');
    expect(clients?.value).toBeGreaterThan(0);
  });

  it('reports the age of the oldest outbox event not yet relayed', async () => {
    const age = await until('the outbox age', async () => {
      const [point] = await points('motorfix_outbox_oldest_pending_seconds');
      return point?.value;
    });
    expect(age).toBeGreaterThanOrEqual(3_590);
  });
});

// @traces 878-FR-001
// @traces 878-FR-002
// @traces 878-FR-008
describe('the monitoring role', () => {
  const monitor = new Client({ connectionString: monitorUrl });
  beforeAll(() => monitor.connect());
  afterAll(() => monitor.end());

  it('runs read-only sessions with a 5 s statement timeout', async () => {
    const readOnly = await monitor.query('SHOW default_transaction_read_only');
    expect(readOnly.rows[0]).toEqual({ default_transaction_read_only: 'on' });
    const timeout = await monitor.query('SHOW statement_timeout');
    expect(timeout.rows[0]).toEqual({ statement_timeout: '5s' });
  });

  it.each([
    "INSERT INTO outbox_event (kind, subject_id, audience) VALUES ('x', 'x', '{}')",
    'CREATE TABLE monitor_probe (id int)',
    'SELECT pg_stat_statements_reset()',
  ])('is refused a write: %s', async (sql) => {
    await expect(monitor.query(sql)).rejects.toThrow();
  });

  it('is refused a write even after turning read-only off', async () => {
    await monitor.query('SET default_transaction_read_only = off');
    await expect(
      monitor.query("UPDATE outbox_event SET kind = kind WHERE kind = 'none'"),
    ).rejects.toThrow(/permission denied/);
    await monitor.query('RESET default_transaction_read_only');
  });
});

// @traces 878-FR-004
describe('slow statements on a real PostgreSQL', () => {
  it('logs a statement slower than 500 ms within one reading of its run', async () => {
    const pool = new Pool({ connectionString: monitorUrl, max: 1 });
    let baselineTaken = false;
    const stop = observeDataStores({
      intervalMs: 300,
      outbox: { oldestPendingSeconds: async () => 0 },
      postgres: {
        query: async <T>(sql: string) => {
          const { rows } = await pool.query(sql);
          if (sql.includes('pg_stat_statements')) baselineTaken = true;
          return rows as T[];
        },
      },
      redis: { info: async () => '' },
    });
    try {
      // The first reading only takes the baseline: the slow statement must
      // come after it to count.
      await until('the baseline reading', () => baselineTaken);
      await admin.query('SELECT pg_sleep(0.6)');

      const record = await until('the slow statement log', async () => {
        await started?.flush();
        return memory.logExporter
          .getFinishedLogRecords()
          .find(
            (each) =>
              each.body === 'slow statement' &&
              String(each.attributes['query']).includes('pg_sleep'),
          );
      });
      expect(record?.attributes['mean_ms']).toBeGreaterThan(500);
      expect(record?.attributes['calls']).toBeGreaterThanOrEqual(1);
    } finally {
      stop();
      await pool.end();
    }
  });
});

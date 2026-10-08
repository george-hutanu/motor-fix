import { S3ServiceException } from '@aws-sdk/client-s3';
import type { DataPoint, Histogram } from '@opentelemetry/sdk-metrics';

import { observeDataStores } from './observe';
import { startTelemetry } from '../setup/start';
import { storageTelemetry } from '../storage/middleware';
import { inMemory } from '../testing/in-memory';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const NEW_FIGURES = /^motorfix_(pg|redis|outbox|datastore|storage)_/;
const OPERATIONS = [
  'PutObject',
  'GetObject',
  'HeadObject',
  'DeleteObject',
  'CopyObject',
  'HeadBucket',
];

// Every label value the readers can take at once: all 16 Redis dbs, every
// connection state, every storage operation both answered and failed.
const info = [
  'used_memory:1',
  'maxmemory:1',
  'connected_clients:1',
  'evicted_keys:1',
  'keyspace_hits:1',
  'keyspace_misses:1',
  ...Array.from({ length: 16 }, (_, db) => `db${db}:keys=1,expires=0`),
].join('\r\n');

async function exercise() {
  const stop = observeDataStores({
    intervalMs: 60_000,
    outbox: { oldestPendingSeconds: async () => 1 },
    postgres: {
      query: async <T>(text: string) =>
        (text.includes('pg_stat_statements')
          ? []
          : text.includes('GROUP BY')
            ? ['active', 'idle', 'idle in transaction', null].map((state) => ({
                count: 1,
                state,
              }))
            : [
                {
                  commit: 1,
                  deadlocks: 1,
                  locks: 1,
                  max: 1,
                  rollback: 1,
                  size: 1,
                },
              ]) as T[],
    },
    redis: { info: async () => info },
  });
  const middleware = storageTelemetry('motorfix');
  if (!middleware) throw new Error('telemetry is on in this spec');
  for (const operation of OPERATIONS) {
    const ok = middleware(
      (async () => ({ output: {} })) as never,
      {
        commandName: `${operation}Command`,
      } as never,
    );
    const failed = middleware(
      (async () => {
        throw new S3ServiceException({
          $fault: 'server',
          $metadata: { httpStatusCode: 500 },
          message: 'InternalError',
          name: 'InternalError',
        });
      }) as never,
      { commandName: `${operation}Command` } as never,
    );
    await ok({ input: {} } as never);
    await failed({ input: {} } as never).catch(() => undefined);
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  return stop;
}

// A histogram point is one series per bucket, plus +Inf, sum and count.
const seriesOf = (point: DataPoint<unknown>) => {
  const value = point.value as Histogram | number;
  return typeof value === 'number' ? 1 : value.buckets.boundaries.length + 3;
};

// @traces 878-FR-012
describe('the series the data-store and storage figures add', () => {
  it('stay at or under 150 per service with every label value in use', async () => {
    const stop = await exercise();
    const { resourceMetrics } = await memory.metricReader.collect();
    stop();

    const added = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .filter((metric) => NEW_FIGURES.test(metric.descriptor.name));
    const total = added
      .flatMap((metric) => metric.dataPoints as DataPoint<unknown>[])
      .reduce((sum, point) => sum + seriesOf(point), 0);

    expect(added.map((metric) => metric.descriptor.name)).toEqual(
      expect.arrayContaining([
        'motorfix_redis_keys',
        'motorfix_storage_requests_total',
        'motorfix_storage_request_duration_seconds',
      ]),
    );
    expect(total).toBeLessThanOrEqual(150);
  });
});

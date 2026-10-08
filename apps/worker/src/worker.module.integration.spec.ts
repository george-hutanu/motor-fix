import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import { S3TestStore } from '@motor-fix/domain/testing';
import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  {
    APP_ENV: 'test',
    DATABASE_URL: databaseUrl,
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
  },
  memory,
);

const QUEUE_GAUGES = [
  'motorfix_queue_waiting',
  'motorfix_queue_oldest_waiting_seconds',
  'motorfix_queue_failed_total',
];

// The queues the observability inventory lists, which
// scripts/observability-inventory.ts proves complete against the code.
const queues = (
  JSON.parse(
    readFileSync(
      join(__dirname, '../../../infra/observability/inventory.json'),
      'utf8',
    ),
  ) as { entries: { kind: string; name: string }[] }
).entries
  .filter((entry) => entry.kind === 'queue')
  .map((entry) => entry.name);

// Booting every worker module and waiting out a reading take longer than
// Jest's default 5 s.
jest.setTimeout(60_000);

const store = new S3TestStore();
let app: INestApplication;

async function points(name: string) {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<number>[]);
}

async function reported(name: string, labels: Record<string, string>) {
  const end = Date.now() + 8_000;
  for (;;) {
    const found = (await points(name)).some((point) =>
      Object.entries(labels).every(
        ([key, value]) => point.attributes[key] === value,
      ),
    );
    if (found || Date.now() > end) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  await store.start();
  // Imported once telemetry has started, as main.ts does through ./telemetry.
  const { workerModule } = await import('./worker.module');
  const env = readEnv(['DATABASE_URL', 'REDIS_URL', ...STORAGE_ENV], {
    APP_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    ...store.env(),
  });
  const moduleRef = await Test.createTestingModule({
    imports: [workerModule(env)],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await store.stop();
  await started?.shutdown();
});

// @traces 878-FR-009
describe('the worker module', () => {
  it('lists the queues of the inventory', () => {
    expect(queues.length).toBeGreaterThan(0);
  });

  it.each(queues)(
    'reports the three queue gauges for the %s queue',
    async (queue) => {
      const missing: string[] = [];
      for (const gauge of QUEUE_GAUGES) {
        if (!(await reported(gauge, { queue }))) missing.push(gauge);
      }
      expect({ missing, queue }).toEqual({ missing: [], queue });
    },
  );

  // @traces 878-FR-006
  // @traces 878-FR-007
  it('reports the outbox age and the Redis store as up', async () => {
    expect(await reported('motorfix_outbox_oldest_pending_seconds', {})).toBe(
      true,
    );
    expect(await reported('motorfix_datastore_up', { store: 'redis' })).toBe(
      true,
    );
  });
});

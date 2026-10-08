import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { SpanKind, trace } from '@opentelemetry/api';
import express from 'express';

import { routeLabel } from './route-label';
import { startedInstrumentations, startTelemetry } from './start';
import { inMemory, patchForJest } from '../testing/in-memory';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
patchForJest();

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(routeLabel());
  app.get('/api/v1/garages/:id', (req, res) => {
    res.json({ id: req.params.id });
  });
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await started?.shutdown();
});

beforeEach(async () => {
  await started?.flush();
  memory.spanExporter.reset();
});

async function spans() {
  await started?.flush();
  return memory.spanExporter.getFinishedSpans();
}

function serverSpans(all: Awaited<ReturnType<typeof spans>>) {
  return all.filter((span) => span.kind === SpanKind.SERVER);
}

// @traces 876-FR-003
// @traces 876-FR-004
// @traces 876-FR-008
// @traces 876-FR-010
// @traces 876-FR-011
describe('the HTTP instrumentation', () => {
  it('names a request span by its route template, not its path', async () => {
    await fetch(`${base}/api/v1/garages/42?email=ana@example.com`);

    const [span] = serverSpans(await spans());
    expect(span?.name).toBe('GET /api/v1/garages/:id');
    expect(span?.attributes['http.route']).toBe('/api/v1/garages/:id');
    expect(span?.attributes['http.response.status_code']).toBe(200);
    expect(JSON.stringify(span?.attributes)).not.toContain('ana@example.com');
  });

  it('names an unmatched path with the one fixed label and no route', async () => {
    await fetch(`${base}/nope/7`);

    const [span] = serverSpans(await spans());
    expect(span?.name).toBe('GET');
    expect(span?.attributes).not.toHaveProperty('http.route');
  });

  it('traces HTTP, Redis, Prisma and the runtime for the API', () => {
    expect(
      startedInstrumentations()
        .map((instrumentation) => instrumentation.instrumentationName)
        .sort(),
    ).toEqual([
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-ioredis',
      '@opentelemetry/instrumentation-runtime-node',
      '@opentelemetry/instrumentation-undici',
      '@prisma/instrumentation',
    ]);
  });

  it('records no span for the health probes', async () => {
    await fetch(`${base}/health/live`);

    expect(serverSpans(await spans())).toEqual([]);
  });

  it('records an outside call as a client span with method, host and status and no query', async () => {
    await trace
      .getTracer('spec')
      .startActiveSpan('job', { kind: SpanKind.CONSUMER }, async (parent) => {
        await fetch(`${base}/api/v1/garages/7?token=secret`);
        parent.end();
      });

    const client = (await spans()).filter(
      (span) => span.kind === SpanKind.CLIENT,
    );
    expect(client).toHaveLength(1);
    expect(client[0]?.attributes).toMatchObject({
      'http.request.method': 'GET',
      'http.response.status_code': 200,
      'server.address': '127.0.0.1',
    });
    expect(JSON.stringify(client[0]?.attributes)).not.toContain('secret');
  });

  it('records no file system, DNS or socket span', async () => {
    await fetch(`${base}/api/v1/garages/1`);

    const names = (await spans()).map((span) => span.name);
    expect(
      names.filter((name) => /^(fs|dns|net|tcp|tls)\b/.test(name)),
    ).toEqual([]);
  });

  it('reports request durations labelled by method, status and route only', async () => {
    await fetch(`${base}/api/v1/garages/3`);
    await fetch(`${base}/nope/3`);

    const { resourceMetrics } = await memory.metricReader.collect();
    const all = resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
    const duration = all.find(
      (metric) => metric.descriptor.name === 'http.server.request.duration',
    );
    const keys = duration?.dataPoints.map((point) =>
      Object.keys(point.attributes).sort(),
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        ['http.request.method', 'http.response.status_code', 'http.route'],
        ['http.request.method', 'http.response.status_code'],
      ]),
    );
    const client = all.find(
      (metric) => metric.descriptor.name === 'http.client.request.duration',
    );
    for (const point of client?.dataPoints ?? []) {
      expect(Object.keys(point.attributes).sort()).toEqual([
        'http.request.method',
        'http.response.status_code',
        'server.address',
      ]);
    }
  });

  it('reports runtime figures and the process CPU time by mode', async () => {
    const { resourceMetrics } = await memory.metricReader.collect();
    const names = resourceMetrics.scopeMetrics.flatMap((scope) =>
      scope.metrics.map((metric) => metric.descriptor.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'process.cpu.time',
        'nodejs.eventloop.utilization',
        'v8js.memory.heap.used',
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining(['v8js.memory.heap.space.size']),
    );
    expect(names).not.toContain('nodejs.eventloop.delay.stddev');
    const cpu = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === 'process.cpu.time');
    expect(
      cpu?.dataPoints.map((point) => point.attributes['cpu.mode']).sort(),
    ).toEqual(['system', 'user']);
  });
});

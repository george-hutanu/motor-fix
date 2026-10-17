import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { SpanKind } from '@opentelemetry/api';
import type { DataPoint, Histogram } from '@opentelemetry/sdk-metrics';
import express from 'express';

import { setRoute } from './route-label';
import { startedInstrumentations, startTelemetry } from './start';
import { inMemory, patchForJest } from '../testing/in-memory';

const memory = inMemory();
const started = startTelemetry(
  'web',
  {
    APP_ENV: 'staging',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
    RELEASE_SHA: 'abc1234',
  },
  memory,
);
patchForJest();

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.get('/ro', (_req, res) => {
    setRoute('/:lang');
    res.send('<html></html>');
  });
  app.get('/ro/garages', (_req, res) => {
    res.send('<html></html>');
  });
  app.get('/ro/garages/auto.service', (_req, res) => {
    res.send('<html></html>');
  });
  app.get('/main-AB12CD34.js', (_req, res) => {
    res.type('js').send('');
  });
  app.get('/health/ready', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/v1/live', (_req, res) => {
    res.type('text/event-stream').send('');
  });
  app.get('/api/v1/live/public', (_req, res) => {
    res.type('text/event-stream').send('');
  });
  app.get('/probe', async (_req, res) => {
    await fetch(`${base}/health/ready`);
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

async function requestsRecorded() {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter(
      (metric) => metric.descriptor.name === 'http.server.request.duration',
    )
    .flatMap((metric) => metric.dataPoints as DataPoint<Histogram>[])
    .reduce((total, point) => total + point.value.count, 0);
}

async function spans(kind: SpanKind) {
  await started?.flush();
  return memory.spanExporter
    .getFinishedSpans()
    .filter((span) => span.kind === kind);
}

describe('startTelemetry for the web server', () => {
  it('starts with the service name web and the release', async () => {
    await fetch(`${base}/ro`);

    const [span] = await spans(SpanKind.SERVER);
    expect(span?.resource.attributes).toMatchObject({
      'deployment.environment': 'staging',
      'service.name': 'web',
      'service.version': 'abc1234',
    });
  });

  it('traces HTTP in and out and the runtime, and no database or Redis', () => {
    expect(
      startedInstrumentations()
        .map((instrumentation) => instrumentation.instrumentationName)
        .sort(),
    ).toEqual([
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-runtime-node',
      '@opentelemetry/instrumentation-undici',
    ]);
  });

  it('names a page span by the route template the page set', async () => {
    await fetch(`${base}/ro?email=ana@example.com`);

    const [span] = await spans(SpanKind.SERVER);
    expect(span?.name).toBe('GET /:lang');
    expect(span?.attributes['http.route']).toBe('/:lang');
  });

  it('keeps the method alone when nothing set a route', async () => {
    await fetch(`${base}/ro/garages`);

    const [span] = await spans(SpanKind.SERVER);
    expect(span?.name).toBe('GET');
    expect(span?.attributes).not.toHaveProperty('http.route');
  });

  it('records no span for a static file or a health probe', async () => {
    await fetch(`${base}/main-AB12CD34.js`);
    await fetch(`${base}/health/ready`);

    expect(await spans(SpanKind.SERVER)).toEqual([]);
  });

  it('traces a page whose slug holds a dot', async () => {
    await fetch(`${base}/ro/garages/auto.service`);

    expect(await spans(SpanKind.SERVER)).toHaveLength(1);
  });

  it('records no client span for a call to a health probe', async () => {
    await fetch(`${base}/probe`);

    expect(await spans(SpanKind.CLIENT)).toEqual([]);
  });

  it('reports request durations labelled by the route template', async () => {
    await fetch(`${base}/ro`);

    const { resourceMetrics } = await memory.metricReader.collect();
    const duration = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find(
        (metric) => metric.descriptor.name === 'http.server.request.duration',
      );
    expect(
      duration?.dataPoints.map((point) => point.attributes['http.route']),
    ).toContain('/:lang');
  });
});

// @traces 1345-FR-001
describe('the web runtime instrumentation', () => {
  it('samples the event-loop delay at the library default of 10 ms', () => {
    const runtime = startedInstrumentations().find(
      (instrumentation) =>
        instrumentation.instrumentationName ===
        '@opentelemetry/instrumentation-runtime-node',
    );

    expect(runtime?.getConfig()).toMatchObject({ monitoringPrecision: 10 });
  });
});

// @traces 1345-FR-008
describe('the web request-duration histogram', () => {
  it('holds no sample for the two proxied event streams, whatever the query', async () => {
    const before = await requestsRecorded();

    await (await fetch(`${base}/api/v1/live`)).text();
    await (await fetch(`${base}/api/v1/live/public?brand=dacia`)).text();

    expect(await requestsRecorded()).toBe(before);
  });

  it('still records a page request', async () => {
    const before = await requestsRecorded();

    await (await fetch(`${base}/ro/garages`)).text();

    expect(await requestsRecorded()).toBe(before + 1);
  });
});

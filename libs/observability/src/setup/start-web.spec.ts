import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { SpanKind } from '@opentelemetry/api';
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
  app.get('/main-AB12CD34.js', (_req, res) => {
    res.type('js').send('');
  });
  app.get('/health/ready', (_req, res) => {
    res.json({ status: 'ok' });
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

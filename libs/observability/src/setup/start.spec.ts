import { metrics, SpanKind, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';

import { resourceFor, startTelemetry } from './start';
import { inMemory } from '../testing';

const memory = inMemory();
const source = {
  APP_ENV: 'staging',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/otlp',
};
const signals = {
  SIGINT: process.listenerCount('SIGINT'),
  SIGTERM: process.listenerCount('SIGTERM'),
};
const started = startTelemetry('worker', source, memory);
const resource = {
  'deployment.environment': 'staging',
  'service.name': 'worker',
  'service.version': 'dev',
};

afterAll(() => started?.shutdown());

describe('startTelemetry with an endpoint', () => {
  it('returns the endpoint settings and the sample ratio of the environment', () => {
    expect(started).toMatchObject({ env: 'staging', traceSampleRatio: 1 });
  });

  it('tags spans, metrics and log records with the service, environment and version', async () => {
    trace
      .getTracer('spec')
      .startSpan('GET /api/v1/garages/:id', { kind: SpanKind.SERVER })
      .end();
    metrics.getMeter('spec').createCounter('spec_total').add(1);
    logs.getLogger('spec').emit({ body: 'hello' });
    await started?.flush();

    const [span] = memory.spanExporter.getFinishedSpans();
    expect(span?.resource.attributes).toMatchObject(resource);
    const [record] = memory.logExporter.getFinishedLogRecords();
    expect(record?.resource.attributes).toMatchObject(resource);
    const { resourceMetrics } = await memory.metricReader.collect();
    expect(resourceMetrics.resource.attributes).toMatchObject(resource);
  });

  it('starts once: a second call returns the first result', () => {
    expect(startTelemetry('api', source)).toBe(started);
  });

  it('adds one SIGTERM and one SIGINT handler that flush before exit', () => {
    expect(process.listenerCount('SIGTERM')).toBe(signals.SIGTERM + 1);
    expect(process.listenerCount('SIGINT')).toBe(signals.SIGINT + 1);
  });
});

describe('resourceFor', () => {
  it('names the service, the environment and the release', () => {
    expect(resourceFor('api', 'production', 'abc1234').attributes).toEqual(
      expect.objectContaining({
        'deployment.environment': 'production',
        'service.name': 'api',
        'service.version': 'abc1234',
      }),
    );
  });

  it('reads dev when no release is set', () => {
    expect(
      resourceFor('mcp', 'staging', undefined).attributes['service.version'],
    ).toBe('dev');
  });
});

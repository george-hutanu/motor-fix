import { SpanKind, trace } from '@opentelemetry/api';

import { startTelemetry } from './start';
import { inMemory } from '../testing/in-memory';

const memory = inMemory();
const source = {
  APP_ENV: 'staging',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/otlp',
  OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dG9wc2VjcmV0',
};
const log = jest.spyOn(console, 'log').mockImplementation(() => {});
const error = jest.spyOn(console, 'error').mockImplementation(() => {});
const started = startTelemetry('api', source, memory);

afterAll(async () => {
  await started?.shutdown();
  log.mockRestore();
  error.mockRestore();
});

describe('startTelemetry with an endpoint', () => {
  it('reports the sample ratio and environment', () => {
    expect(started).toMatchObject({ env: 'staging', traceSampleRatio: 1 });
  });

  it('never returns or prints the headers value', () => {
    expect(
      JSON.stringify({ ...started, endpoint: String(started?.endpoint) }),
    ).not.toContain('topsecret');
    const printed = [...log.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(printed).not.toContain('topsecret');
    expect(printed).not.toContain('dG9wc2VjcmV0');
  });

  it('keeps the first service when a second call names another', () => {
    expect(startTelemetry('worker', source)).toBe(started);
    expect(startTelemetry('mcp', { ...source, APP_ENV: 'production' })).toBe(
      started,
    );
  });

  it('masks personal values in span attributes, events and exception messages before export', async () => {
    const span = trace
      .getTracer('adv')
      .startSpan('job', { kind: SpanKind.SERVER });
    span.setAttribute('user.email', 'ana@example.ro');
    span.setAttribute('user.phone', '+40 722 123 456');
    span.setAttribute('vehicle', 'B 123 ABC');
    span.setAttribute('list', ['x@y.ro', 'plain']);
    span.addEvent('seen', { who: 'ana@example.ro' });
    span.recordException(new Error('failed for ana@example.ro on B 123 ABC'));
    span.setStatus({ code: 2, message: 'bad 0722123456' });
    span.end();
    await started?.flush();

    const exported = memory.spanExporter.getFinishedSpans();
    expect(exported).toHaveLength(1);
    const text = JSON.stringify({
      a: exported[0]?.attributes,
      e: exported[0]?.events,
      s: exported[0]?.status,
    });
    expect(text).not.toMatch(
      /ana@example|722 123|B 123 ABC|0722123456|x@y\.ro/,
    );
    expect(exported[0]?.attributes['list']).toEqual(['***', 'plain']);
  });

  it('flush and shutdown resolve and a second shutdown does not throw', async () => {
    await expect(started?.flush()).resolves.toBeUndefined();
    await expect(started?.shutdown()).resolves.toBeUndefined();
    await expect(started?.shutdown()).resolves.toBeUndefined();
  });
});

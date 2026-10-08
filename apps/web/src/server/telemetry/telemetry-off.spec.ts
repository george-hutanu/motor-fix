/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { trace } from '@opentelemetry/api';

describe('the web server telemetry entry with telemetry off', () => {
  it('starts nothing when no endpoint is set', async () => {
    const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    try {
      await import('./telemetry');
    } finally {
      if (endpoint !== undefined)
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = endpoint;
    }

    const span = trace.getTracer('spec').startSpan('GET /:lang');
    expect(span.isRecording()).toBe(false);
    span.end();
  });
});

import { ProxyTracerProvider, trace } from '@opentelemetry/api';

import { startTelemetry } from './start';

jest.mock('@opentelemetry/sdk-trace-node', () => {
  throw new Error('the trace SDK was loaded');
});
jest.mock('@opentelemetry/sdk-metrics', () => {
  throw new Error('the metrics SDK was loaded');
});
jest.mock('@opentelemetry/sdk-logs', () => {
  throw new Error('the logs SDK was loaded');
});

function delegate() {
  return (trace.getTracerProvider() as ProxyTracerProvider).getDelegate();
}

// @traces 876-FR-014
describe('startTelemetry while telemetry is off', () => {
  it('starts nothing, loads no SDK and adds no signal handler when the endpoint is unset', () => {
    const handlers = process.listenerCount('SIGTERM');
    const before = delegate();

    expect(startTelemetry('api', { APP_ENV: 'production' })).toBeUndefined();

    expect(trace.getTracerProvider()).toBeInstanceOf(ProxyTracerProvider);
    expect(delegate()).toBe(before);
    expect(process.listenerCount('SIGTERM')).toBe(handlers);
  });

  it('writes one error line naming the variable, never a value, when the endpoint is malformed', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(
      startTelemetry('api', {
        APP_ENV: 'production',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'ftp://secret-host/otlp',
        OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic c2VjcmV0',
      }),
    ).toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      level: 'error',
      message: 'OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute http(s) URL',
    });
    expect(line).not.toContain('secret');
    expect(line).not.toContain('c2VjcmV0');
    error.mockRestore();
  });
});

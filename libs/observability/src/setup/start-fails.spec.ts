import {
  context,
  ProxyTracerProvider,
  ROOT_CONTEXT,
  trace,
} from '@opentelemetry/api';

import { startTelemetry, telemetryStarted } from './start';
import { queueTelemetry } from '../queues/telemetry-option';

jest.mock('./instrumentations', () => ({
  instrumentations: () => {
    throw new Error('an instrumentation failed to load');
  },
}));

const ON = {
  APP_ENV: 'staging',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
};

// @traces 876-FR-014
describe('startTelemetry when the SDK fails while it starts', () => {
  it('writes one error line, leaves telemetry off and does not throw', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handlers = process.listenerCount('SIGTERM');

    expect(startTelemetry('api', ON)).toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errors.mock.calls[0]?.[0] as string)).toEqual({
      level: 'error',
      message: 'an instrumentation failed to load',
    });
    expect(telemetryStarted()).toBe(false);
    expect(trace.getTracerProvider()).toBeInstanceOf(ProxyTracerProvider);
    expect(
      (trace.getTracerProvider() as ProxyTracerProvider).getDelegate(),
    ).not.toHaveProperty('register');
    expect(process.listenerCount('SIGTERM')).toBe(handlers);
    const key = Symbol('probe');
    context.with(ROOT_CONTEXT.setValue(key, 1), () => {
      expect(context.active()).toBe(ROOT_CONTEXT);
    });
    expect(queueTelemetry()).toBeUndefined();
    errors.mockRestore();
  });
});

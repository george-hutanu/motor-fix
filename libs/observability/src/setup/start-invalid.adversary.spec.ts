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

const headers = 'Authorization=Basic dG9wc2VjcmV0';

describe('startTelemetry with a bad configuration', () => {
  let error: jest.SpyInstance;
  beforeEach(() => {
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => error.mockRestore());

  it.each([
    ['a plain word', 'not a url'],
    ['a relative path', '/otlp'],
    ['a scheme-relative url', '//host/otlp'],
    ['a bare scheme', 'http://'],
    ['a file url', 'file:///etc/passwd'],
    ['a javascript url', 'javascript:alert(1)'],
    ['a websocket url', 'ws://host/otlp'],
    ['an ftp url', 'ftp://host/otlp'],
    ['a url with leading spaces and a bad scheme', '  gopher://host'],
  ])('returns undefined and logs one JSON error for %s', (_name, endpoint) => {
    const handlers = process.listenerCount('SIGTERM');

    const result = startTelemetry('api', {
      APP_ENV: 'production',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_HEADERS: headers,
    });

    expect(result).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      level: 'error',
      message: 'OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute http(s) URL',
    });
    expect(line).not.toContain('topsecret');
    expect(line).not.toContain('dG9wc2VjcmV0');
    expect(process.listenerCount('SIGTERM')).toBe(handlers);
    expect(trace.getTracerProvider()).toBeInstanceOf(ProxyTracerProvider);
  });

  it('returns undefined and names the protocol variable for an unsupported protocol', () => {
    const result = startTelemetry('worker', {
      APP_ENV: 'staging',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
    });

    expect(result).toBeUndefined();
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({
      level: 'error',
      message: 'OTEL_EXPORTER_OTLP_PROTOCOL must be http/protobuf',
    });
  });

  it('returns undefined for an unknown environment name without echoing it', () => {
    const result = startTelemetry('mcp', {
      APP_ENV: 'banana-split-9',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
    });

    expect(result).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('APP_ENV');
  });

  it.each(['', undefined])(
    'treats an endpoint of %p as off without any log line',
    (endpoint) => {
      expect(
        startTelemetry('api', {
          APP_ENV: 'production',
          OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        }),
      ).toBeUndefined();
      expect(error).not.toHaveBeenCalled();
    },
  );

  it('stays off after a failed start and starts nothing on a repeat', () => {
    const source = {
      APP_ENV: 'production',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'nope',
    };
    expect(startTelemetry('api', source)).toBeUndefined();
    expect(startTelemetry('api', source)).toBeUndefined();
    expect(trace.getTracerProvider()).toBeInstanceOf(ProxyTracerProvider);
  });
});

// @traces 875-FR-001 875-FR-002 875-FR-003
import { telemetry } from './env';

const SECRET = 'glc_SuperSecretToken123';
const base = { APP_ENV: 'staging' };

function message(source: Record<string, string | undefined>): string {
  try {
    telemetry(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected telemetry to throw');
}

describe('telemetry under hostile input', () => {
  it.each([
    `${SECRET}`,
    `ftp://u:${SECRET}@example.com`,
    `://${SECRET}`,
    `https://exa mple.com/?token=${SECRET}`,
    `javascript:${SECRET}`,
    `file:///${SECRET}`,
    `ws://example.com/${SECRET}`,
  ])('never prints the endpoint %j in its error', (endpoint) => {
    const text = message({
      ...base,
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Basic ${SECRET}`,
    });
    expect(text).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
    expect(text).not.toContain(SECRET);
  });

  it.each([
    SECRET,
    `http/protobuf ${SECRET}`,
    'grpc',
    'http/json',
    'HTTP/PROTOBUF',
    'http/protobuf ',
    ' http/protobuf',
  ])(
    'refuses protocol %j naming the variable without its value',
    (protocol) => {
      const text = message({
        ...base,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
        OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Basic ${SECRET}`,
        OTEL_EXPORTER_OTLP_PROTOCOL: protocol,
      });
      expect(text).toContain('OTEL_EXPORTER_OTLP_PROTOCOL');
      expect(text).not.toContain(SECRET);
    },
  );

  it('does not leak headers when the endpoint is malformed', () => {
    const text = message({
      ...base,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'nope',
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Basic ${SECRET}`,
    });
    expect(text).not.toContain(SECRET);
  });

  it('checks nothing else when the endpoint is empty', () => {
    expect(
      telemetry({
        APP_ENV: 'bogus',
        OTEL_EXPORTER_OTLP_ENDPOINT: '',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      }),
    ).toBeUndefined();
  });

  it('treats an endpoint of only spaces as malformed, not off', () => {
    expect(() =>
      telemetry({ ...base, OTEL_EXPORTER_OTLP_ENDPOINT: '   ' }),
    ).toThrow('OTEL_EXPORTER_OTLP_ENDPOINT');
  });

  it.each(['HTTPS://otlp.example.com/', 'Http://localhost:4318'])(
    'accepts the upper-case scheme in %j',
    (endpoint) => {
      const result = telemetry({
        ...base,
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      });
      expect(result?.endpoint.protocol).toMatch(/^https?:$/);
    },
  );

  it('accepts an endpoint with a path', () => {
    const result = telemetry({
      ...base,
      OTEL_EXPORTER_OTLP_ENDPOINT:
        'https://otlp-gateway-prod-eu-west-0.grafana.net/otlp',
    });
    expect(result?.endpoint.pathname).toBe('/otlp');
  });

  it('returns the headers verbatim and omits them when unset', () => {
    const withHeaders = telemetry({
      ...base,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic abc==',
    });
    expect(withHeaders?.headers).toBe('Authorization=Basic abc==');
    const without = telemetry({
      ...base,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });
    expect(without?.headers).toBeUndefined();
  });

  it.each([
    ['production', 0.2],
    ['staging', 1],
    ['development', 1],
    ['test', 1],
  ])('samples %s at exactly %s', (appEnv, ratio) => {
    const result = telemetry({
      APP_ENV: appEnv,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });
    expect(result?.traceSampleRatio).toBe(ratio);
    expect(result?.env).toBe(appEnv);
    expect(result?.protocol).toBe('http/protobuf');
  });

  it.each(['Production', 'PRODUCTION', ' production', 'prod', 'production '])(
    'does not report a sampling ratio for the unknown APP_ENV %j',
    (appEnv) => {
      let outcome: unknown;
      try {
        outcome = telemetry({
          APP_ENV: appEnv,
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
        });
      } catch (error) {
        outcome = error;
      }
      expect(outcome).toBeInstanceOf(Error);
    },
  );

  it('refuses a missing APP_ENV when telemetry is on', () => {
    expect(() =>
      telemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' }),
    ).toThrow();
  });
});

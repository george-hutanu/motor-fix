import { trace } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';

import { logEntry } from './log';
import { startTelemetry } from '../setup/start';
import { inMemory } from '../testing/in-memory';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);

let out: jest.SpyInstance;
let err: jest.SpyInstance;

beforeEach(async () => {
  out = jest.spyOn(console, 'log').mockImplementation(() => {});
  err = jest.spyOn(console, 'error').mockImplementation(() => {});
  await started?.flush();
  memory.logExporter.reset();
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => started?.shutdown());

const lines = (spy: jest.SpyInstance) =>
  spy.mock.calls.map(([line]) => JSON.parse(String(line)));

async function records() {
  await started?.flush();
  return memory.logExporter.getFinishedLogRecords();
}

// @traces 1345-FR-002 1345-FR-005 1345-FR-009
describe('logEntry', () => {
  it('writes a warning as one JSON line on stdout and one WARN record', async () => {
    logEntry('warn', 'browser telemetry off: FARO_URL unset', {
      method: 'GET',
      path: '/api/v1/live',
    });

    expect(lines(out)).toEqual([
      {
        level: 'warn',
        message: 'browser telemetry off: FARO_URL unset',
        method: 'GET',
        path: '/api/v1/live',
      },
    ]);
    expect(err).not.toHaveBeenCalled();
    const [record, ...rest] = await records();
    expect(rest).toEqual([]);
    expect(record?.severityNumber).toBe(SeverityNumber.WARN);
    expect(record?.severityText).toBe('WARN');
    expect(record?.body).toBe('browser telemetry off: FARO_URL unset');
    expect(record?.attributes).toEqual({ method: 'GET', path: '/api/v1/live' });
  });

  it('writes an error as one JSON line on stderr and one ERROR record', async () => {
    logEntry('error', 'api proxy: upstream request failed', {
      method: 'POST',
      path: '/api/v1/requests',
    });

    expect(lines(err)).toEqual([
      {
        level: 'error',
        message: 'api proxy: upstream request failed',
        method: 'POST',
        path: '/api/v1/requests',
      },
    ]);
    expect(out).not.toHaveBeenCalled();
    const [record, ...rest] = await records();
    expect(rest).toEqual([]);
    expect(record?.severityNumber).toBe(SeverityNumber.ERROR);
    expect(record?.severityText).toBe('ERROR');
    expect(record?.body).toBe('api proxy: upstream request failed');
  });

  it('puts the span and trace ids on the line only inside an active span', () => {
    logEntry('warn', 'outside');
    trace.getTracer('spec').startActiveSpan('inside', (span) => {
      logEntry('warn', 'inside');
      span.end();
    });

    const [outside, inside] = lines(out);
    expect(outside).not.toHaveProperty('span_id');
    expect(outside).not.toHaveProperty('trace_id');
    expect(inside.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(inside.trace_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('masks the message and every attribute value, and drops an undefined one', async () => {
    logEntry('warn', 'failed for ana@example.com', {
      path: '/api/v1/cars/B 123 ABC',
      reason: undefined,
      status: 502,
    });

    const [line] = lines(out);
    expect(line).toEqual({
      level: 'warn',
      message: 'failed for ***',
      path: '/api/v1/cars/***',
      status: 502,
    });
    const [record] = await records();
    expect(record?.body).toBe('failed for ***');
    expect(record?.attributes).toEqual({
      path: '/api/v1/cars/***',
      status: 502,
    });
  });
});

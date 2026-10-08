import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import { type Span, SpanKind, trace } from '@opentelemetry/api';

import { JsonLogger, requestContext } from './logging';

// The services' own pipeline (logger provider, batching processor), with
// the in-memory exporters in place of the OTLP ones. It starts once per
// process, so it lives apart from logging.spec.ts and its own provider.
const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
const RAW = /ana@example\.com|0722 123 456|B 123 ABC/;
const PERSONAL = 'ana@example.com, 0722 123 456, car B 123 ABC';

afterAll(() => started?.shutdown());
beforeEach(() => memory.logExporter.reset());

async function exported(log: () => void) {
  const out = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  const err = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    log();
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  await started?.flush();
  const records = memory.logExporter.getFinishedLogRecords();
  expect(records).toHaveLength(1);
  const [record] = records;
  if (!record) throw new Error('no record exported');
  return record;
}

const leaving = (record: { body?: unknown; attributes: unknown }) =>
  JSON.stringify({ attributes: record.attributes, body: record.body });

describe('JsonLogger through the telemetry export pipeline', () => {
  const logger = new JsonLogger();

  it('exports a message with e-mails, phones and plates masked', async () => {
    const record = await exported(() => logger.log(PERSONAL, 'Mailer'));

    expect(record.body).toBe('***, ***, car ***');
    expect(leaving(record)).not.toMatch(RAW);
  });

  it('exports a structured entry as its JSON with every value masked', async () => {
    const record = await exported(() =>
      logger.log(
        { email: 'ana@example.com', phone: '0722 123 456', plate: 'B 123 ABC' },
        'Mailer',
      ),
    );

    expect(JSON.parse(String(record.body))).toEqual({
      email: '***',
      phone: '***',
      plate: '***',
    });
    expect(leaving(record)).not.toMatch(RAW);
  });

  it('exports an error with its message and stack masked', async () => {
    const error = new Error(PERSONAL);
    const record = await exported(() =>
      logger.error(error, error.stack, 'Mailer'),
    );

    const { error: exportedError, stack } = record.attributes as {
      error: { message: string; stack: string };
      stack: string;
    };
    expect(exportedError.message).toBe('***, ***, car ***');
    expect(exportedError.stack).toContain('***, ***, car ***');
    expect(stack).toContain('***, ***, car ***');
    expect(leaving(record)).not.toMatch(RAW);
  });

  it('keeps the request id, the job id and the active span unchanged', async () => {
    const requestId = 'ab123cde-1f2e-4a3b-9c8d-0123456789ab';
    let span: Span | undefined;
    const record = await exported(() =>
      trace
        .getTracer('spec')
        .startActiveSpan(
          'GET /api/v1/garages/:id',
          { kind: SpanKind.SERVER },
          (active) => {
            span = active;
            requestContext.run({ jobId: 'B 123 ABC', requestId }, () =>
              logger.log('served', 'Probe'),
            );
            active.end();
          },
        ),
    );

    const { spanId, traceId } = span?.spanContext() ?? {};
    expect(spanId).toBeDefined();
    expect(record.attributes).toMatchObject({
      jobId: 'B 123 ABC',
      requestId,
      span_id: spanId,
      trace_id: traceId,
    });
    expect(record.spanContext).toMatchObject({ spanId, traceId });
  });
});

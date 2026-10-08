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
const RAW = /ana@example\.com|0722 ?123 ?456|\+40722123456|B ?123 ?ABC/i;
const PERSONAL = 'ana@example.com, 0722 123 456, car B 123 ABC';

afterAll(() => started?.shutdown());
beforeEach(() => memory.logExporter.reset());

async function exportedAll(log: () => void) {
  const out = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  const err = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    log();
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  await started?.flush();
  return memory.logExporter.getFinishedLogRecords();
}

async function exported(log: () => void) {
  const records = await exportedAll(log);
  expect(records).toHaveLength(1);
  const [record] = records;
  if (!record) throw new Error('no record exported');
  return record;
}

type Exported = { body?: unknown; attributes: unknown };
const leaving = (exported: Exported | readonly Exported[]) =>
  JSON.stringify(
    [exported].flat().map(({ attributes, body }) => ({ attributes, body })),
  );

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

describe('JsonLogger export pipeline under unusual log shapes', () => {
  const logger = new JsonLogger();

  it('masks values in every extra message parameter', async () => {
    // Nest prints each extra parameter as a line of its own.
    const records = await exportedAll(() =>
      logger.log('first ana@example.com', 'second 0722 123 456', 'B 123 ABC'),
    );

    expect(records.length).toBeGreaterThan(0);
    expect(leaving(records)).not.toMatch(RAW);
  });

  it('masks values nested in objects and arrays of a structured entry', async () => {
    const record = await exported(() =>
      logger.log(
        {
          cars: [['B 123 ABC']],
          owners: [{ contact: { mail: 'ana@example.com' } }, '0722 123 456'],
        },
        'Mailer',
      ),
    );

    expect(leaving(record)).not.toMatch(RAW);
  });

  it('masks values in an error cause and in extra error fields', async () => {
    const error = Object.assign(
      new Error('outer', { cause: new Error('cause ana@example.com') }),
      { detail: { plate: 'B 123 ABC' }, phone: '0722 123 456' },
    );
    const record = await exported(() =>
      logger.error(error, error.stack, 'Mailer'),
    );

    expect(leaving(record)).not.toMatch(RAW);
  });

  it('masks a context name that holds personal data', async () => {
    const record = await exported(() => logger.log('hello', 'ana@example.com'));

    expect(leaving(record)).not.toMatch(RAW);
  });

  it.each([
    ['warn', 'WARN'],
    ['fatal', 'FATAL'],
    ['debug', 'DEBUG'],
    ['verbose', 'VERBOSE'],
  ] as const)('exports a %s line masked, as %s', async (level, severity) => {
    const record = await exported(() =>
      logger[level]('ana@example.com 0722 123 456 B 123 ABC', 'Mailer'),
    );

    expect(record.severityText).toBe(severity);
    expect(record.body).toBe('*** *** ***');
  });

  it('masks compact and international spellings of phones and plates', async () => {
    const record = await exported(() =>
      logger.log('0722123456 +40722123456 B123ABC ANA@EXAMPLE.COM', 'Mailer'),
    );

    expect(leaving(record)).not.toMatch(RAW);
  });

  it('masks values in an array passed as the message', async () => {
    const record = await exported(() =>
      logger.log(
        ['ana@example.com', 'B 123 ABC'] as unknown as string,
        'Mailer',
      ),
    );

    expect(leaving(record)).not.toMatch(RAW);
  });
});

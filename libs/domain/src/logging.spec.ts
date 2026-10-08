import { logs } from '@opentelemetry/api-logs';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import { JsonLogger, requestContext } from './logging';

const tracer = new NodeTracerProvider();
tracer.register();
const records = new InMemoryLogRecordExporter();
logs.setGlobalLoggerProvider(
  new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: records })],
  }),
);

function written(log: () => void): Record<string, unknown> {
  const lines: string[] = [];
  const capture = (chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  };
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(capture);
  const err = jest.spyOn(process.stderr, 'write').mockImplementation(capture);
  try {
    log();
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return JSON.parse(lines.join('').trim());
}

beforeEach(() => records.reset());

// @traces 876-FR-006
// @traces 876-FR-012
describe('JsonLogger', () => {
  const logger = new JsonLogger();

  it('adds the trace and span ids of the active span beside the request id', () => {
    tracer
      .getTracer('spec')
      .startActiveSpan('GET /api/v1/garages/:id', (span) => {
        const line = written(() =>
          requestContext.run({ requestId: 'req-1' }, () =>
            logger.log('served', 'Probe'),
          ),
        );
        const { spanId, traceId } = span.spanContext();
        span.end();

        expect(line).toMatchObject({
          message: 'served',
          requestId: 'req-1',
          span_id: spanId,
          trace_id: traceId,
        });
      });
  });

  it('adds the job id while a job runs', () => {
    const line = written(() =>
      requestContext.run({ jobId: '42' }, () => logger.log('sent', 'Mailer')),
    );

    expect(line).toMatchObject({ jobId: '42', message: 'sent' });
  });

  it('leaves the keys out, never empty, with no active span or context', () => {
    const line = written(() => logger.log('idle', 'Probe'));

    expect(line).not.toHaveProperty('trace_id');
    expect(line).not.toHaveProperty('span_id');
    expect(line).not.toHaveProperty('jobId');
    expect(line).not.toHaveProperty('requestId');
  });

  it('masks e-mails, phones and plates in the line it writes', () => {
    const line = written(() =>
      logger.error('ana@example.com, 0722 123 456, car B 123 ABC', 'Mailer'),
    );

    expect(JSON.stringify(line)).not.toMatch(/ana@example|0722|123 ABC/);
    expect(line['message']).toBe('***, ***, car ***');
  });

  it('keeps a request or job id that looks like a plate unmasked', () => {
    const requestId = 'ab123cde-1f2e-4a3b-9c8d-0123456789ab';
    const line = written(() =>
      requestContext.run({ jobId: 'B 123 ABC', requestId }, () =>
        logger.log('served', 'Probe'),
      ),
    );

    expect(line).toMatchObject({ jobId: 'B 123 ABC', requestId });
    const [record] = records.getFinishedLogRecords();
    expect(record?.attributes).toMatchObject({ jobId: 'B 123 ABC', requestId });
  });

  it('emits the same masked line as a log record', () => {
    written(() =>
      requestContext.run({ jobId: '7' }, () =>
        logger.warn('retry for ana@example.com', 'Mailer'),
      ),
    );

    const [record] = records.getFinishedLogRecords();
    expect(record?.severityText).toBe('WARN');
    expect(record?.body).toBe('retry for ***');
    expect(record?.attributes).toMatchObject({ context: 'Mailer', jobId: '7' });
  });
});

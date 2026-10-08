/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { startTelemetry } from '@motor-fix/observability';
import { inMemory, patchForJest } from '@motor-fix/observability/testing';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import express from 'express';

import { renderError } from './render-error';

const memory = inMemory();
const started = startTelemetry(
  'web',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
patchForJest();

let web: Server;
let base: string;
let lines: string[];
let errorLog: jest.SpyInstance;

beforeAll(async () => {
  const app = express();
  app.get('/ro/garages', () => {
    throw new Error('render failed for ana@example.com, B 123 ABC');
  });
  app.use(renderError);
  web = createServer(app);
  await new Promise<void>((resolve) =>
    web.listen(0, '127.0.0.1', () => resolve()),
  );
  base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => web.close(resolve));
  await started?.shutdown();
});

beforeEach(async () => {
  lines = [];
  errorLog = jest
    .spyOn(console, 'error')
    .mockImplementation((line: unknown) => lines.push(String(line)));
  await started?.flush();
  memory.spanExporter.reset();
  memory.logExporter.reset();
});

afterEach(() => errorLog.mockRestore());

async function failedRender() {
  const res = await fetch(`${base}/ro/garages`);
  await started?.flush();
  const span = memory.spanExporter
    .getFinishedSpans()
    .find((each) => each.kind === SpanKind.SERVER);
  return { res, span };
}

describe('a server render error', () => {
  it('answers 500', async () => {
    const { res } = await failedRender();

    expect(res.status).toBe(500);
  });

  it('marks the request span as an error with the exception, masked', async () => {
    const { span } = await failedRender();

    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    const exception = span?.events.find((event) => event.name === 'exception');
    expect(exception).toBeDefined();
    expect(JSON.stringify(span?.events)).not.toMatch(/ana@example|123 ABC/);
  });

  it('names the request span unmatched', async () => {
    const { span } = await failedRender();

    expect(span?.name).toBe('GET unmatched');
  });

  it('writes one JSON error line with the trace, masked', async () => {
    const { span } = await failedRender();

    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? '{}');
    expect(line).toMatchObject({
      level: 'error',
      message: 'render failed for ***, ***',
      span_id: span?.spanContext().spanId,
      trace_id: span?.spanContext().traceId,
    });
    expect(line.stack).toContain('render failed for ***, ***');
    expect(lines[0]).not.toMatch(/ana@example|123 ABC/);
  });

  it('sends the same error as a log record', async () => {
    await failedRender();

    const records = memory.logExporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.body).toBe('render failed for ***, ***');
    expect(records[0]?.severityText).toBe('ERROR');
  });
});

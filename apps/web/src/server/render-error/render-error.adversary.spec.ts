/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { startTelemetry } from '@motor-fix/observability';
import { inMemory, patchForJest } from '@motor-fix/observability/testing';
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
  app.get('/string', () => {
    throw 'plain ana@example.com' as never;
  });
  app.get('/object', () => {
    throw { code: 7, who: 'ana@example.com' };
  });
  app.get('/nostack', () => {
    const e = new Error('no stack 0722 123 456');
    e.stack = undefined;
    throw e;
  });
  app.get('/sent', (_req, res) => {
    res.status(200).write('partial');
    throw new Error('late failure');
  });
  app.get('/ok', (_req, res) => {
    res.send('fine');
  });
  app.use(renderError);
  web = createServer(app);
  await new Promise<void>((resolve) =>
    web.listen(0, '127.0.0.1', () => resolve()),
  );
  base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
});

afterAll(async () => {
  web.closeAllConnections?.();
  await new Promise((resolve) => web.close(resolve));
  await started?.shutdown();
});

beforeEach(async () => {
  lines = [];
  errorLog = jest
    .spyOn(console, 'error')
    .mockImplementation((line: unknown) => lines.push(String(line)));
  await started?.flush();
  memory.logExporter.reset();
});

afterEach(() => errorLog.mockRestore());

describe('renderError with unusual thrown values', () => {
  it.each(['/string', '/object', '/nostack'])(
    'answers 500 and writes one parseable masked line for %s',
    async (path) => {
      const res = await fetch(`${base}${path}`);
      await started?.flush();

      expect(res.status).toBe(500);
      expect(lines).toHaveLength(1);
      const line = JSON.parse(lines[0]);
      expect(line).toMatchObject({ level: 'error' });
      expect(line).toHaveProperty('message');
      expect(lines[0]).not.toMatch(/ana@example|0722 123 456/);
    },
  );

  it('writes exactly one log line per failed request, repeated', async () => {
    await fetch(`${base}/string`);
    await fetch(`${base}/string`);

    expect(lines).toHaveLength(2);
  });

  it('emits one OTLP log record per failure', async () => {
    await fetch(`${base}/object`);
    await started?.flush();

    expect(memory.logExporter.getFinishedLogRecords()).toHaveLength(1);
  });

  it('puts trace and span ids of 32 and 16 hex chars in the line', async () => {
    await fetch(`${base}/string`);
    const line = JSON.parse(lines[0]);

    expect(line.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(line.span_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not put the response body or the error text in the 500 answer', async () => {
    const res = await fetch(`${base}/nostack`);

    expect(await res.text()).not.toMatch(/0722|no stack|at /);
  });

  it('stays silent for a request that succeeds', async () => {
    const res = await fetch(`${base}/ok`);
    await started?.flush();

    expect(res.status).toBe(200);
    expect(lines).toEqual([]);
    expect(memory.logExporter.getFinishedLogRecords()).toHaveLength(0);
  });

  it('does not throw a second error when headers are already sent', async () => {
    const res = await fetch(`${base}/sent`).catch(() => null);

    expect(res === null || res.status === 200).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(1);
  });
});

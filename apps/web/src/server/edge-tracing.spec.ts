/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { createServer, type Server } from 'node:http';
import { type AddressInfo, connect } from 'node:net';

import { startTelemetry } from '@motor-fix/observability';
import { inMemory, patchForJest } from '@motor-fix/observability/testing';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import express from 'express';

import { mountEdge } from './edge';

const memory = inMemory();
const started = startTelemetry(
  'web',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
patchForJest();

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

let upstream: Server;
let web: Server;
let base: string;
let traceparents: (string | undefined)[];
let drops: number;
let streamClosed: () => void;

beforeAll(async () => {
  upstream = createServer((req, res) => {
    traceparents.push(req.headers['traceparent'] as string | undefined);
    if (req.url?.startsWith('/api/v1/cut')) {
      res.writeHead(200, { 'content-length': '1000' });
      res.write('partial');
      setTimeout(() => req.socket.destroy(), 10);
      return;
    }
    if (req.url?.startsWith('/api/v1/live')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: 1\n\n');
      res.on('close', () => streamClosed());
      return;
    }
    if (drops > 0) {
      drops--;
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  const app = express();
  mountEdge(app, await listen(upstream));
  web = createServer(app);
  base = await listen(web);
});

afterAll(async () => {
  web.closeAllConnections();
  upstream.closeAllConnections();
  await Promise.all([close(web), close(upstream)]);
  await started?.shutdown();
});

beforeEach(async () => {
  traceparents = [];
  drops = 0;
  await started?.flush();
  memory.spanExporter.reset();
  memory.logExporter.reset();
});

async function finished() {
  await started?.flush();
  return memory.spanExporter.getFinishedSpans();
}

// The records a dashboard would count as a problem: anything above INFO.
async function problems() {
  await started?.flush();
  return memory.logExporter
    .getFinishedLogRecords()
    .filter((record) => (record.severityNumber ?? 0) > SeverityNumber.INFO);
}

const quiet = () => ({
  err: jest.spyOn(console, 'error').mockImplementation(() => {}),
  out: jest.spyOn(console, 'log').mockImplementation(() => {}),
});

const parsed = (spy: jest.SpyInstance) =>
  spy.mock.calls.map(([line]) => JSON.parse(String(line)));

describe('the web edge, traced', () => {
  it('names the pass-through /api, whatever the path', async () => {
    await fetch(`${base}/api/v1/garages/42?city=Cluj`);

    const servers = (await finished()).filter(
      (span) => span.kind === SpanKind.SERVER && span.name.startsWith('GET'),
    );
    const web = servers.find(
      (span) => span.attributes['http.route'] === '/api',
    );
    expect(web?.name).toBe('GET /api');
  });

  it('calls the API in a child span whose context the API receives', async () => {
    await fetch(`${base}/api/v1/brands`);

    const all = await finished();
    const web = all.find((span) => span.attributes['http.route'] === '/api');
    const call = all.find(
      (span) =>
        span.kind === SpanKind.CLIENT &&
        span.parentSpanContext?.spanId === web?.spanContext().spanId,
    );
    expect(call).toBeDefined();
    expect(traceparents[0]).toContain(web?.spanContext().traceId);
    expect(traceparents[0]).toContain(call?.spanContext().spanId);
  });

  it('continues the trace the browser started', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';

    // Sent over a bare socket, as a browser would send it: the test's own
    // fetch is traced and would replace the header with a trace of its own.
    await new Promise<void>((resolve, reject) => {
      const { hostname, port } = new URL(base);
      const socket = connect(Number(port), hostname, () =>
        socket.end(
          'GET /api/v1/brands HTTP/1.1\r\n' +
            `host: ${hostname}\r\n` +
            `traceparent: 00-${traceId}-00f067aa0ba902b7-01\r\n` +
            'connection: close\r\n\r\n',
        ),
      );
      socket.on('error', reject);
      socket.on('close', () => resolve());
      socket.resume();
    });

    const web = (await finished()).find(
      (span) => span.attributes['http.route'] === '/api',
    );
    expect(web?.spanContext().traceId).toBe(traceId);
    expect(web?.parentSpanContext?.spanId).toBe('00f067aa0ba902b7');
    expect(traceparents[0]).toContain(traceId);
  });

  it('records no span for its health checks', async () => {
    await fetch(`${base}/health/live`);
    await fetch(`${base}/health/ready`);

    expect(await finished()).toEqual([]);
  });

  it('marks the pass-through failed and logs one line when the API is down', async () => {
    const down = express();
    mountEdge(down, 'http://127.0.0.1:1');
    const server = createServer(down);
    const downBase = await listen(server);
    const lines: string[] = [];
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation((line: string) => lines.push(line));

    try {
      const answer = await fetch(`${downBase}/api/v1/brands?email=a@b.ro`);
      expect(answer.status).toBe(502);
    } finally {
      error.mockRestore();
      server.closeAllConnections();
      await close(server);
    }

    const web = (await finished()).find(
      (span) =>
        span.kind === SpanKind.SERVER &&
        span.attributes['http.route'] === '/api',
    );
    expect(web?.status.code).toBe(SpanStatusCode.ERROR);
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? '{}');
    expect(line).toMatchObject({
      level: 'error',
      trace_id: web?.spanContext().traceId,
    });
    expect(lines[0]).not.toContain('a@b.ro');
  });
});

// @traces 1345-FR-009
describe('the web edge, reporting an API call that failed', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs one error line and one ERROR record naming the method and the masked path', async () => {
    const down = express();
    mountEdge(down, 'http://127.0.0.1:1');
    const server = createServer(down);
    const downBase = await listen(server);
    const { err } = quiet();

    try {
      const answer = await fetch(
        `${downBase}/api/v1/accounts/ana@example.com/notes?draft=1`,
        { body: 'x', method: 'POST' },
      );
      expect(answer.status).toBe(502);
    } finally {
      server.closeAllConnections();
      await close(server);
    }

    const where = { method: 'POST', path: '/api/v1/accounts/***/notes' };
    const lines = parsed(err);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      message: 'api proxy: upstream request failed',
      ...where,
    });
    const [record, ...rest] = await problems();
    expect(rest).toEqual([]);
    expect(record?.severityText).toBe('ERROR');
    expect(record?.body).toBe('api proxy: upstream request failed');
    expect(record?.attributes).toMatchObject(where);
  });
});

// @traces 1345-FR-010
describe('the web edge, when an answer is cut short', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gives one WARN record and cuts the browser off when the API closes after the headers', async () => {
    const { err, out } = quiet();

    const answer = await fetch(`${base}/api/v1/cut?brand=dacia`);
    const body = await answer.text().then(
      () => 'whole',
      () => 'cut',
    );

    expect(answer.status).toBe(200);
    expect(body).toBe('cut');
    expect(err).not.toHaveBeenCalled();
    const where = { method: 'GET', path: '/api/v1/cut' };
    expect(parsed(out)).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'api proxy: upstream closed before the response was complete',
        ...where,
      }),
    ]);
    const [record, ...rest] = await problems();
    expect(rest).toEqual([]);
    expect(record?.severityText).toBe('WARN');
    expect(record?.body).toBe(
      'api proxy: upstream closed before the response was complete',
    );
    expect(record?.attributes).toMatchObject(where);
  });

  it('records nothing above INFO when the browser leaves a stream', async () => {
    const { err, out } = quiet();
    const closed = new Promise<void>((resolve) => {
      streamClosed = resolve;
    });
    const controller = new AbortController();
    const answer = await fetch(`${base}/api/v1/live`, {
      signal: controller.signal,
    });
    await answer.body?.getReader().read();

    controller.abort();
    await closed;

    expect(await problems()).toEqual([]);
    expect(err).not.toHaveBeenCalled();
    expect(out).not.toHaveBeenCalled();
  });
});

// @traces 1345-FR-011
describe('the web edge, retrying a stale connection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('writes no record when the second attempt answers', async () => {
    const { err, out } = quiet();
    drops = 1;

    const answer = await fetch(`${base}/api/v1/brands`);

    expect(answer.status).toBe(200);
    expect(await problems()).toEqual([]);
    expect(err).not.toHaveBeenCalled();
    expect(out).not.toHaveBeenCalled();
  });
});

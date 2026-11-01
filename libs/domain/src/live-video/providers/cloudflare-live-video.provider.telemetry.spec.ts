import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

import { CloudflareLiveVideo } from './cloudflare-live-video.provider';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ format: 'pem', type: 'pkcs8' })
  .toString();

let server: Server;
let base: string;
let status = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ result: { enabled: false }, success: status < 300 }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await started?.shutdown();
});

beforeEach(() => {
  memory.spanExporter.reset();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const cloudflare = () =>
  new CloudflareLiveVideo(
    {
      CLOUDFLARE_STREAM_ACCOUNT_ID: 'acct-1',
      CLOUDFLARE_STREAM_API_TOKEN: 'secret-api-token',
      CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc123',
      CLOUDFLARE_STREAM_SIGNING_KEY_ID: 'kid-1',
      CLOUDFLARE_STREAM_SIGNING_KEY_PEM: pem,
    },
    base,
  );

// The worker's call runs inside a job; the sampler drops a client span
// nothing started.
const inJob = (work: () => Promise<void>) =>
  trace
    .getTracer('spec')
    .startActiveSpan('job', { kind: SpanKind.CONSUMER }, (job) =>
      work().finally(() => job.end()),
    );

async function closeSpan() {
  await started?.flush();
  return memory.spanExporter
    .getFinishedSpans()
    .find((span) => span.name === 'live-video.close_input');
}

// @traces 1390-FR-002 1390-FR-005
describe('the span of a live input close', () => {
  it('carries the status and the operation, never the path, query or body', async () => {
    await inJob(() => cloudflare().closeInput('input-uid-1'));

    const span = await closeSpan();
    expect(span?.attributes).toEqual({
      'http.host': new URL(base).host,
      'http.status': 200,
      'live.operation': 'close_input',
      'live.provider': 'cloudflare',
    });
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('keeps the error status on a 404 it counts as closed', async () => {
    status = 404;
    await inJob(() => cloudflare().closeInput('input-uid-1'));
    status = 200;

    const span = await closeSpan();
    expect(span?.attributes['http.status']).toBe(404);
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

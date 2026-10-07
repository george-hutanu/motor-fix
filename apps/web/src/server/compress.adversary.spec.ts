/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import {
  createServer,
  type IncomingHttpHeaders,
  request,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

import express from 'express';

import { mountCompression } from './compress';
import { mountEdge } from './edge';

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, () =>
      resolve(`http://localhost:${(server.address() as AddressInfo).port}`),
    ),
  );

const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

type Raw = { status: number; headers: IncomingHttpHeaders; body: Buffer };

const raw = (url: string, headers: Record<string, string> = {}) =>
  new Promise<Raw>((resolve, reject) => {
    request(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          body: Buffer.concat(chunks),
          headers: res.headers,
          status: res.statusCode ?? 0,
        }),
      );
    })
      .on('error', reject)
      .end();
  });

const script = `export const words = [${Array.from(
  { length: 400 },
  (_, i) => `'word-${i}'`,
).join(', ')}];\n`;
const events = Array.from({ length: 2000 }, (_, i) => `data: event-${i}\n\n`);

describe('web compression, hostile clients and responses', () => {
  let dir: string;
  let upstream: Server;
  let web: Server;
  let base: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'web-compress-adv-'));
    writeFileSync(join(dir, 'main-ABCD1234.js'), script);

    upstream = createServer((req, res) => {
      if (req.url === '/api/v1/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const event of events) res.write(event);
        res.end();
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: script }));
    });

    const app = express();
    mountEdge(app, await listen(upstream));
    mountCompression(app);
    app.use(
      express.static(dir, { index: false, maxAge: '1y', redirect: false }),
    );
    app.get('/notransform', (_req, res) => {
      res.set('Cache-Control', 'no-transform').type('js').send(script);
    });
    app.get('/varied', (_req, res) => {
      res.set('Vary', 'Cookie').type('js').send(script);
    });
    web = createServer(app);
    base = await listen(web);
  });

  afterEach(async () => {
    web.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([close(web), close(upstream)]);
    rmSync(dir, { force: true, recursive: true });
  });

  it('decodes a brotli-only client body to the file bytes', async () => {
    const answer = await raw(`${base}/main-ABCD1234.js`, {
      'accept-encoding': 'br',
    });

    expect(answer.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(answer.body).toString()).toBe(script);
  });

  it('sends plain bytes, not an error, to a client that accepts only zstd', async () => {
    const answer = await raw(`${base}/main-ABCD1234.js`, {
      'accept-encoding': 'zstd',
    });

    expect(answer.status).toBe(200);
    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(answer.body.toString()).toBe(script);
  });

  it('sends plain bytes to a client that refuses gzip with a zero quality', async () => {
    const answer = await raw(`${base}/main-ABCD1234.js`, {
      'accept-encoding': 'gzip;q=0',
    });

    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(answer.body.toString()).toBe(script);
  });

  it('sends plain bytes for an explicit identity request', async () => {
    const answer = await raw(`${base}/main-ABCD1234.js`, {
      'accept-encoding': 'identity',
    });

    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(answer.body.toString()).toBe(script);
  });

  it('does not transform a response marked no-transform', async () => {
    const answer = await raw(`${base}/notransform`, {
      'accept-encoding': 'gzip',
    });

    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(answer.body.toString()).toBe(script);
  });

  it('keeps a Vary value the route already set next to accept-encoding', async () => {
    const answer = await raw(`${base}/varied`, { 'accept-encoding': 'gzip' });

    expect(String(answer.headers.vary)).toMatch(/cookie/i);
    expect(String(answer.headers.vary)).toMatch(/accept-encoding/i);
  });

  it('serves a byte range of a static file as those plain bytes', async () => {
    const answer = await raw(`${base}/main-ABCD1234.js`, {
      'accept-encoding': 'gzip',
      range: 'bytes=0-99',
    });

    expect(answer.status).toBe(206);
    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(answer.body.toString()).toBe(script.slice(0, 100));
  });

  it('relays a large event stream byte for byte without re-encoding', async () => {
    const answer = await raw(`${base}/api/v1/stream`, {
      'accept-encoding': 'gzip, br',
    });

    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(answer.body.toString()).toBe(events.join(''));
  });

  it('does not re-encode a large error answer relayed from the API', async () => {
    const answer = await raw(`${base}/api/v1/missing`, {
      'accept-encoding': 'gzip',
    });

    expect(answer.status).toBe(404);
    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(answer.body.toString())).toEqual({ message: script });
  });
});

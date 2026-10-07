/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import {
  createServer,
  get,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeResponseToNodeResponse } from '@angular/ssr/node';
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

// fetch decodes gzip on its own; the bytes on the wire are what is billed.
const raw = (url: string, headers: Record<string, string> = {}) =>
  new Promise<Raw>((resolve, reject) => {
    get(url, { headers }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          body: Buffer.concat(chunks),
          headers: res.headers,
          status: res.statusCode ?? 0,
        }),
      );
    }).on('error', reject);
  });

const script = `export const words = [${Array.from(
  { length: 400 },
  (_, i) => `'word-${i}'`,
).join(', ')}];\n`;
const page = `<!doctype html><html><body>${'<p>Garage near you</p>'.repeat(200)}</body></html>`;
const gzip = { 'accept-encoding': 'gzip' };

describe('web compression', () => {
  let dir: string;
  let upstream: Server;
  let web: Server;
  let base: string;
  let release: () => void;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'web-compress-'));
    writeFileSync(join(dir, 'main-ABCD1234.js'), script);
    writeFileSync(join(dir, 'tiny-ABCD1234.js'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'font-ABCD1234.woff2'), Buffer.alloc(4096, 7));

    upstream = createServer((req, res) => {
      if (req.url === '/api/v1/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: first\n\n');
        release = () => res.end('data: last\n\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: script }));
    });

    const app = express();
    mountEdge(app, await listen(upstream));
    mountCompression(app);
    app.use(
      express.static(dir, { index: false, maxAge: '1y', redirect: false }),
    );
    app.get('/en', (_req, res) => {
      void writeResponseToNodeResponse(
        new Response(page, { headers: { 'content-type': 'text/html' } }),
        res,
      );
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

  it('sends a script gzipped, smaller, and varying on accept-encoding', async () => {
    const answer = await raw(`${base}/main-ABCD1234.js`, gzip);

    expect(answer.status).toBe(200);
    expect(answer.headers['content-encoding']).toBe('gzip');
    expect(answer.headers.vary).toMatch(/accept-encoding/i);
    expect(answer.body.length).toBeLessThan(Buffer.byteLength(script));
  });

  it('sends the server-rendered page gzipped', async () => {
    const answer = await raw(`${base}/en`, gzip);

    expect(answer.headers['content-encoding']).toBe('gzip');
    expect(answer.body.length).toBeLessThan(Buffer.byteLength(page));
  });

  it('sends the plain bytes to a client that accepts no encoding', async () => {
    const answer = await raw(`${base}/main-ABCD1234.js`);

    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(answer.headers.vary).toMatch(/accept-encoding/i);
    expect(answer.body.toString()).toBe(script);
  });

  it('leaves a body under a kilobyte and an already compressed font as they are', async () => {
    const tiny = await raw(`${base}/tiny-ABCD1234.js`, gzip);
    const font = await raw(`${base}/font-ABCD1234.woff2`, gzip);

    expect(tiny.headers['content-encoding']).toBeUndefined();
    expect(font.headers['content-encoding']).toBeUndefined();
    expect(font.body.length).toBe(4096);
  });

  it('keeps a not-modified answer bodiless', async () => {
    const first = await raw(`${base}/main-ABCD1234.js`, gzip);
    const again = await raw(`${base}/main-ABCD1234.js`, {
      ...gzip,
      'if-none-match': String(first.headers.etag),
    });

    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it('keeps the year-long cache header on a hashed file', async () => {
    const answer = await raw(`${base}/main-ABCD1234.js`, gzip);

    expect(answer.headers['cache-control']).toBe('public, max-age=31536000');
  });

  it('does not re-encode an answer relayed from the API', async () => {
    const answer = await raw(`${base}/api/v1/garages`, gzip);

    expect(answer.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(answer.body.toString())).toEqual({ items: script });
  });

  it('streams a relayed event before the API has finished', async () => {
    const response = await fetch(`${base}/api/v1/stream`, { headers: gzip });
    const reader = response.body?.getReader();
    const first = await reader?.read();

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(new TextDecoder().decode(first?.value)).toBe('data: first\n\n');
    release();
    await reader?.cancel();
  });
});

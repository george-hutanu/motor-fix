/**
 * @jest-environment node
 */
import {
  createServer,
  get,
  type IncomingMessage,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';

import { mountEdge } from './edge';

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, () =>
      resolve(`http://localhost:${(server.address() as AddressInfo).port}`),
    ),
  );

const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

describe('web edge', () => {
  let upstream: Server;
  let web: Server;
  let base: string;
  let seen: { method?: string; url?: string; body: string }[];
  let release: () => void;

  beforeEach(async () => {
    seen = [];
    upstream = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seen.push({ body, method: req.method, url: req.url });
        if (req.url === '/api/v1/stream') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: first\n\n');
          release = () => res.end('data: last\n\n');
          return;
        }
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echoed: body }));
      });
    });
    const app = express();
    mountEdge(app, await listen(upstream));
    web = createServer(app);
    base = await listen(web);
  });

  afterEach(async () => {
    web.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([close(web), close(upstream)]);
  });

  it('answers its own health checks without asking the API', async () => {
    const live = await fetch(`${base}/health/live`);
    const ready = await fetch(`${base}/health/ready`);

    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'ok' });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ok' });
    expect(seen).toEqual([]);
  });

  it('forwards /api/ with the method, path, query and body', async () => {
    const res = await fetch(`${base}/api/v1/garages?city=Cluj`, {
      body: '{"a":1}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ echoed: '{"a":1}' });
    expect(seen).toEqual([
      { body: '{"a":1}', method: 'POST', url: '/api/v1/garages?city=Cluj' },
    ]);
  });

  it('streams the answer without waiting for it to end', async () => {
    const first = await new Promise<string>((resolve) =>
      get(`${base}/api/v1/stream`, (res: IncomingMessage) =>
        res.once('data', (chunk) => resolve(String(chunk))),
      ),
    );

    expect(first).toBe('data: first\n\n');
    release();
  });

  it('answers 502 when the API cannot be reached', async () => {
    await close(upstream);

    const res = await fetch(`${base}/api/v1/garages`);

    expect(res.status).toBe(502);
  });
});

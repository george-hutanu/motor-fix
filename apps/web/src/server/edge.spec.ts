/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import {
  createServer,
  get,
  type IncomingMessage,
  type Server,
  type ServerResponse,
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
  let forwarded: { cookie?: string; for?: string }[];
  let apiReady: 'ok' | 'failing' | 'silent';

  beforeEach(async () => {
    seen = [];
    forwarded = [];
    apiReady = 'ok';
    const answerReady = (res: ServerResponse) => {
      if (apiReady !== 'silent')
        res.writeHead(apiReady === 'ok' ? 204 : 503).end();
    };
    upstream = createServer((req, res) => {
      if (req.url === '/health/ready') {
        seen.push({ body: '', method: req.method, url: req.url });
        answerReady(res);
        return;
      }
      forwarded.push({
        cookie: req.headers.cookie,
        for: req.headers['x-forwarded-for'] as string | undefined,
      });
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seen.push({ body, method: req.method, url: req.url });
        if (req.url === '/api/v1/auth/refresh') {
          res.writeHead(200, {
            'set-cookie': 'mf_refresh=next; Path=/api/v1/auth; HttpOnly',
          });
          res.end('{}');
          return;
        }
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

  it('answers its liveness check without asking the API', async () => {
    const live = await fetch(`${base}/health/live`);

    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'ok' });
    expect(seen).toEqual([]);
  });

  it('is ready when the API says it is ready, asking it once per probe', async () => {
    const first = await fetch(`${base}/health/ready`);
    const second = await fetch(`${base}/health/ready`);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'ok' });
    expect(second.status).toBe(200);
    expect(seen.map((call) => call.url)).toEqual([
      '/health/ready',
      '/health/ready',
    ]);
  });

  it('is not ready when the API answers its ready check with an error', async () => {
    apiReady = 'failing';

    const ready = await fetch(`${base}/health/ready`);

    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: 'unavailable' });
  });

  it('is not ready when the API cannot be reached', async () => {
    await close(upstream);

    const ready = await fetch(`${base}/health/ready`);

    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: 'unavailable' });
  });

  it('is not ready within two seconds when the API does not answer', async () => {
    apiReady = 'silent';
    const asked = Date.now();

    const ready = await fetch(`${base}/health/ready`);

    expect(ready.status).toBe(503);
    expect(Date.now() - asked).toBeGreaterThanOrEqual(1_900);
    expect(Date.now() - asked).toBeLessThan(3_000);
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

  it('tells the API the address it was called from, after any it was given', async () => {
    await fetch(`${base}/api/v1/me`);
    await fetch(`${base}/api/v1/me`, {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });

    expect(forwarded[0]?.for).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
    expect(forwarded[1]?.for).toMatch(
      /^203\.0\.113\.9, ((::ffff:)?127\.0\.0\.1|::1)$/,
    );
  });

  it('passes the refresh cookie to the API and its new value back', async () => {
    const res = await fetch(`${base}/api/v1/auth/refresh`, {
      headers: { cookie: 'mf_refresh=old' },
      method: 'POST',
    });

    expect(forwarded[0]?.cookie).toBe('mf_refresh=old');
    expect(res.headers.getSetCookie()).toEqual([
      'mf_refresh=next; Path=/api/v1/auth; HttpOnly',
    ]);
  });

  it('answers 502 when the API cannot be reached', async () => {
    await close(upstream);

    const res = await fetch(`${base}/api/v1/garages`);

    expect(res.status).toBe(502);
  });
});

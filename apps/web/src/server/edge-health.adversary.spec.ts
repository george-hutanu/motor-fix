/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';

import { mountEdge } from './edge';

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });

let status = 200;
let hits: string[];
let upstream: Server;
let web: Server;
let base: string;

beforeEach(async () => {
  status = 200;
  hits = [];
  upstream = createServer((req, res) => {
    hits.push(req.url ?? '');
    res.statusCode = status;
    res.end('{}');
  });
  const apiUrl = await listen(upstream);
  const app = express();
  mountEdge(app, apiUrl);
  web = createServer(app);
  base = await listen(web);
});

afterEach(async () => {
  await close(web);
  await close(upstream);
});

describe('web readiness under odd API answers', () => {
  it.each([200, 201, 204, 299])('is ready on %i', async (code) => {
    status = code;

    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
  });

  it.each([199, 300, 301, 404, 500, 503])(
    'is unavailable on %i',
    async (code) => {
      status = code;
      const res = await fetch(`${base}/health/ready`);

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: 'unavailable' });
    },
  );

  it('follows the API from down to up and back with nothing cached', async () => {
    status = 500;
    const down = await fetch(`${base}/health/ready`);
    status = 200;
    const up = await fetch(`${base}/health/ready`);
    status = 500;
    const down2 = await fetch(`${base}/health/ready`);

    expect([down.status, up.status, down2.status]).toEqual([503, 200, 503]);
  });

  it('makes one API call per probe, ten probes ten calls', async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => fetch(`${base}/health/ready`)),
    );

    expect(hits).toEqual(Array(10).fill('/health/ready'));
  });

  it('keeps live ok while the API is down', async () => {
    status = 500;
    await close(upstream);
    const res = await fetch(`${base}/health/live`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    upstream = createServer();
  });

  it('never calls the API for a live probe', async () => {
    await fetch(`${base}/health/live`);

    expect(hits).toEqual([]);
  });

  it('is unavailable, not a hang, when the API accepts and never answers', async () => {
    await close(upstream);
    upstream = createServer(() => undefined);
    const apiUrl = await listen(upstream);
    const app = express();
    mountEdge(app, apiUrl);
    await close(web);
    web = createServer(app);
    base = await listen(web);
    const started = Date.now();

    const res = await fetch(`${base}/health/ready`);

    expect(res.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(3500);
  });

  it('does not put the API body or error text in its answer', async () => {
    status = 500;
    const res = await fetch(`${base}/health/ready`);

    expect(await res.text()).toBe('{"status":"unavailable"}');
  });

  it('lets go of the API answer it does not read, so the socket is freed', async () => {
    await close(upstream);
    let released: () => void = () => undefined;
    const freed = new Promise<void>((resolve) => {
      released = resolve;
    });
    // Headers at once, then a body that never ends on its own.
    upstream = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"status":');
      res.on('close', () => released());
    });
    const apiUrl = await listen(upstream);
    const app = express();
    mountEdge(app, apiUrl);
    await close(web);
    web = createServer(app);
    base = await listen(web);

    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
    // Sooner than the probe's own 2 s timeout would abort it.
    const late = new Promise<string>((resolve) =>
      setTimeout(() => resolve('still held'), 1_000).unref(),
    );
    await expect(Promise.race([freed.then(() => 'freed'), late])).resolves.toBe(
      'freed',
    );
  });
});

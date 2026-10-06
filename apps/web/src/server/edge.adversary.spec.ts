/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
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

function raw(base: string, path: string, method = 'GET') {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(`${base}`, { method, path }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ body, status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('web edge under hostile conditions', () => {
  let upstream: Server;
  let web: Server;
  let base: string;
  let upstreamUrl: string;
  let seen: {
    method?: string;
    url?: string;
    headers: IncomingHttpHeaders;
    size: number;
  }[];
  let behave: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void;

  async function boot(apiUrl?: (url: string) => string) {
    upstream = createServer((req, res) => {
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
      });
      req.on('end', () => {
        seen.push({
          headers: req.headers,
          method: req.method,
          size,
          url: req.url,
        });
        behave(req, res);
      });
    });
    upstreamUrl = await listen(upstream);
    const app = express();
    mountEdge(app, apiUrl ? apiUrl(upstreamUrl) : upstreamUrl);
    web = createServer(app);
    base = await listen(web);
  }

  beforeEach(() => {
    seen = [];
    behave = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    };
  });

  afterEach(async () => {
    web.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([close(web), close(upstream)]);
  });

  it('passes the upstream status and body through for 404 and 500', async () => {
    await boot();
    behave = (req, res) => {
      const status = req.url?.includes('missing') ? 404 : 500;
      res.writeHead(status, { 'content-type': 'application/problem+json' });
      res.end(`{"status":${status}}`);
    };

    const missing = await fetch(`${base}/api/v1/missing`);
    const broken = await fetch(`${base}/api/v1/broken`);

    expect([missing.status, await missing.json()]).toEqual([
      404,
      { status: 404 },
    ]);
    expect(broken.status).toBe(500);
    expect(broken.headers.get('content-type')).toBe('application/problem+json');
  });

  it('does not follow a redirect from the API but hands it to the browser', async () => {
    await boot();
    behave = (_req, res) => {
      res.writeHead(302, { location: '/api/v1/elsewhere' });
      res.end();
    };

    const res = await fetch(`${base}/api/v1/go`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/api/v1/elsewhere');
    expect(seen).toHaveLength(1);
  });

  it('keeps several Set-Cookie headers apart', async () => {
    await boot();
    behave = (_req, res) => {
      res.writeHead(200, { 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] });
      res.end();
    };

    const res = await fetch(`${base}/api/v1/cookies`);

    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  it('passes a 204 without a body', async () => {
    await boot();
    behave = (_req, res) => {
      res.writeHead(204);
      res.end();
    };

    const res = await fetch(`${base}/api/v1/none`, { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'forwards the %s method',
    async (method) => {
      await boot();

      await fetch(`${base}/api/v1/m`, {
        body: method === 'GET' ? undefined : 'x',
        method,
      });

      expect(seen.map((s) => s.method)).toEqual([method]);
    },
  );

  it('forwards the request id and authorization headers', async () => {
    await boot();

    await fetch(`${base}/api/v1/h`, {
      headers: { authorization: 'Bearer t', 'x-request-id': 'req-9' },
    });

    expect(seen[0]?.headers['x-request-id']).toBe('req-9');
    expect(seen[0]?.headers['authorization']).toBe('Bearer t');
  });

  it('forwards an 8 MB request body whole', async () => {
    await boot();
    const body = Buffer.alloc(8 * 1024 * 1024, 7);

    const res = await fetch(`${base}/api/v1/upload`, {
      body,
      headers: { 'content-type': 'application/octet-stream' },
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(seen[0]?.size).toBe(body.length);
  });

  it('returns an 8 MB binary response byte for byte', async () => {
    await boot();
    const payload = Buffer.alloc(8 * 1024 * 1024, 9);
    behave = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(payload);
    };

    const res = await fetch(`${base}/api/v1/download`);

    expect(Buffer.from(await res.arrayBuffer()).equals(payload)).toBe(true);
  });

  it('keeps percent-encoded and repeated query parameters intact', async () => {
    await boot();

    await fetch(`${base}/api/v1/g%C3%A2rage?q=Cluj-Napoca&q=%C8%99&x=a%26b`);

    expect(seen[0]?.url).toBe(
      '/api/v1/g%C3%A2rage?q=Cluj-Napoca&q=%C8%99&x=a%26b',
    );
  });

  it('does not forward paths that merely start with api', async () => {
    await boot();

    const res = await raw(base, '/apix/v1/garages');

    expect(res.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('forwards no health path, including unknown ones under /health', async () => {
    await boot();

    const res = await raw(base, '/health/anything');

    expect(res.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('does not let a dot-dot path escape /api into the upstream health checks', async () => {
    await boot();

    await raw(base, '/api/v1/../../health/ready');

    expect(seen.map((s) => s.url)).not.toContain('/health/ready');
  });

  it('answers its own health on HEAD and keeps POST off it', async () => {
    await boot();

    const head = await fetch(`${base}/health/live`, { method: 'HEAD' });
    const post = await fetch(`${base}/health/live`, { method: 'POST' });

    expect(head.status).toBe(200);
    expect(post.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('forwards correctly when the API address ends with a slash', async () => {
    await boot((url) => `${url}/`);

    await fetch(`${base}/api/v1/garages`);

    expect(seen.map((s) => s.url)).toEqual(['/api/v1/garages']);
  });

  it('answers 502 when the API closes the connection without answering', async () => {
    await boot();
    behave = (req) => {
      req.socket.destroy();
    };

    const res = await fetch(`${base}/api/v1/dropped`);

    expect(res.status).toBe(502);
  });

  it('keeps serving after the API dies halfway through a response', async () => {
    await boot();
    behave = (req, res) => {
      if (req.url?.includes('half')) {
        res.writeHead(200, { 'content-length': '1000' });
        res.write('partial');
        setTimeout(() => req.socket.destroy(), 10);
        return;
      }
      res.end('fine');
    };

    const outcome = await fetch(`${base}/api/v1/half`, {
      signal: AbortSignal.timeout(3000),
    })
      .then((r) => r.text())
      .then(
        () => 'ended',
        (error: Error) => error.name,
      );
    expect(outcome).not.toBe('TimeoutError');
    const after = await fetch(`${base}/api/v1/ok`);

    expect(await after.text()).toBe('fine');
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
  });

  it('abandons the upstream request when the browser goes away', async () => {
    await boot();
    let upstreamClosed: () => void;
    const closed = new Promise<void>((resolve) => {
      upstreamClosed = resolve;
    });
    behave = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: 1\n\n');
      res.on('close', () => upstreamClosed());
    };
    const controller = new AbortController();
    const res = await fetch(`${base}/api/v1/stream`, {
      signal: controller.signal,
    });
    await res.body?.getReader().read();

    controller.abort();

    await expect(
      Promise.race([
        closed.then(() => 'closed'),
        new Promise((r) => setTimeout(() => r('open'), 2000)),
      ]),
    ).resolves.toBe('closed');
  });

  it('answers 502 for every method when the API is down', async () => {
    await boot();
    await close(upstream);

    const statuses = await Promise.all(
      ['GET', 'POST', 'DELETE'].map(
        async (method) =>
          (
            await fetch(`${base}/api/v1/x`, {
              body: method === 'GET' ? undefined : 'b',
              method,
            })
          ).status,
      ),
    );

    expect(statuses).toEqual([502, 502, 502]);
  });
});

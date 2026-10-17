/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import {
  createServer,
  request as httpRequest,
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Entry = {
  level: string;
  message: string;
  method?: string;
  path?: string;
  [key: string]: unknown;
};

type Seen = { method?: string; url?: string; port?: number };

type Client = {
  status?: number;
  body: string;
  outcome: 'ended' | 'aborted' | 'error';
};

describe('web edge proxy failures and retries', () => {
  let upstream: Server;
  let web: Server;
  let base: string;
  let seen: Seen[];
  let behave: (
    req: IncomingMessage,
    res: ServerResponse,
    attempt: number,
  ) => void;
  let attempts: Map<string, number>;
  let out: jest.SpyInstance;
  let err: jest.SpyInstance;

  const entries = (): Entry[] =>
    [...out.mock.calls, ...err.mock.calls]
      .map(([line]) => {
        try {
          return JSON.parse(String(line)) as Entry;
        } catch {
          return undefined;
        }
      })
      .filter((one): one is Entry => one?.level !== undefined);

  const errors = () => entries().filter((one) => one.level === 'error');
  const warnings = () => entries().filter((one) => one.level === 'warn');

  function call(path: string, method = 'GET', body?: string) {
    return new Promise<Client>((resolve) => {
      const result: Client = { body: '', outcome: 'ended' };
      const req = httpRequest(base + path, { method }, (res) => {
        result.status = res.statusCode;
        res.on('data', (chunk) => {
          result.body += chunk;
        });
        res.on('aborted', () => {
          result.outcome = 'aborted';
        });
        res.on('error', () => {
          result.outcome = 'error';
        });
        res.on('close', () => resolve(result));
      });
      req.on('error', () => {
        result.outcome = 'error';
        resolve(result);
      });
      req.end(body);
    });
  }

  beforeEach(async () => {
    out = jest.spyOn(console, 'log').mockImplementation(() => {});
    err = jest.spyOn(console, 'error').mockImplementation(() => {});
    seen = [];
    attempts = new Map();
    behave = (_req, res) => {
      res.writeHead(200).end('ok');
    };
    upstream = createServer((req, res) => {
      const key = `${req.method} ${req.url}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      seen.push({
        method: req.method,
        port: req.socket.remotePort,
        url: req.url,
      });
      req.resume();
      behave(req, res, attempt);
    });
    const app = express();
    mountEdge(app, await listen(upstream));
    web = createServer(app);
    base = await listen(web);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    web.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([close(web), close(upstream)]);
  });

  // @traces 1345-FR-009 1345-FR-011
  describe('a GET that fails twice', () => {
    it('logs exactly one error with the method and the path without the query', async () => {
      behave = (req) => req.socket.destroy();

      const res = await call('/api/v1/garages?token=hunter2&city=Cluj');

      expect(res.status).toBe(502);
      expect(seen).toHaveLength(2);
      expect(errors()).toHaveLength(1);
      expect(errors()[0]).toMatchObject({
        method: 'GET',
        path: '/api/v1/garages',
      });
      expect(JSON.stringify(entries())).not.toMatch(/hunter2|Cluj/);
      expect(warnings()).toEqual([]);
    });

    it('answers 502 for a HEAD after retrying it once', async () => {
      behave = (req) => req.socket.destroy();

      const res = await call('/api/v1/garages', 'HEAD');

      expect(res.status).toBe(502);
      expect(seen).toHaveLength(2);
      expect(errors()).toHaveLength(1);
      expect(errors()[0]).toMatchObject({
        method: 'HEAD',
        path: '/api/v1/garages',
      });
    });

    it('masks an e-mail address in the logged path', async () => {
      behave = (req) => req.socket.destroy();

      await call('/api/v1/users/ana@example.com/cars');

      expect(errors()).toHaveLength(1);
      expect(String(errors()[0]?.path)).not.toContain('ana@example.com');
      expect(JSON.stringify(entries())).not.toContain('ana@example.com');
    });

    it('logs the path of an unreachable API without the query for a GET', async () => {
      await close(upstream);

      const res = await call('/api/v1/search/garages?q=0722123456');

      expect(res.status).toBe(502);
      expect(errors()).toHaveLength(1);
      expect(errors()[0]).toMatchObject({
        method: 'GET',
        path: '/api/v1/search/garages',
      });
      expect(JSON.stringify(entries())).not.toContain('0722123456');
      upstream = createServer();
    });
  });

  // @traces 1345-FR-011
  describe('a request that is not a GET or a HEAD', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'is sent once, answered 502 and logged once for %s',
      async (method) => {
        behave = (req) => req.socket.destroy();

        const res = await call(
          `/api/v1/requests?x=1`,
          method,
          method === 'DELETE' ? undefined : '{"a":1}',
        );

        expect(res.status).toBe(502);
        expect(seen).toHaveLength(1);
        expect(errors()).toHaveLength(1);
        expect(errors()[0]).toMatchObject({
          method,
          path: '/api/v1/requests',
        });
      },
    );

    it('is not replayed to a restarted API even when the first attempt was cut', async () => {
      behave = (req, res, attempt) => {
        if (attempt === 1) req.socket.destroy();
        else res.writeHead(201).end('created');
      };

      const res = await call('/api/v1/quotes', 'POST', '{"amount":1}');

      expect(res.status).toBe(502);
      expect(attempts.get('POST /api/v1/quotes')).toBe(1);
    });
  });

  // @traces 1345-FR-011
  describe('a GET that is cut once', () => {
    it('is answered by the second attempt on another connection with nothing logged', async () => {
      behave = (req, res, attempt) => {
        if (attempt === 1) req.socket.destroy();
        else res.writeHead(200).end('second');
      };

      const res = await call('/api/v1/garages');

      expect(res.status).toBe(200);
      expect(res.body).toBe('second');
      expect(seen).toHaveLength(2);
      expect(seen[1]?.port).not.toBe(seen[0]?.port);
      expect(entries()).toEqual([]);
    });

    it('retries each of twenty concurrent requests once', async () => {
      behave = (req, res, attempt) => {
        if (attempt === 1) req.socket.destroy();
        else res.writeHead(200).end(req.url);
      };

      const all = await Promise.all(
        Array.from({ length: 20 }, (_, i) => call(`/api/v1/garages/${i}`)),
      );

      expect(all.map((one) => one.status)).toEqual(Array(20).fill(200));
      expect(all.map((one) => one.body)).toEqual(
        Array.from({ length: 20 }, (_, i) => `/api/v1/garages/${i}`),
      );
      expect(seen).toHaveLength(40);
      expect(entries()).toEqual([]);
    });

    it('is not retried when the upstream answered an error status', async () => {
      behave = (_req, res) => {
        res.writeHead(503).end('down');
      };

      const res = await call('/api/v1/garages');

      expect(res.status).toBe(503);
      expect(seen).toHaveLength(1);
    });
  });

  // @traces 1345-FR-010
  describe('a response cut after its headers', () => {
    const cutAfterHeaders = (promised: boolean) => {
      behave = (req, res) => {
        res.writeHead(200, promised ? { 'content-length': '100' } : {});
        res.flushHeaders();
        res.write('part');
        setTimeout(() => req.socket.destroy(), 30);
      };
    };

    it('logs one warning and no error for a GET, with no retry and no 502', async () => {
      const method = 'GET';
      cutAfterHeaders(true);

      const res = await call('/api/v1/garages?q=secret', method);
      await pause(100);

      expect(res.status).toBe(200);
      expect(res.outcome).not.toBe('ended');
      expect(seen).toHaveLength(1);
      expect(errors()).toEqual([]);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toMatchObject({
        method,
        path: '/api/v1/garages',
      });
      expect(JSON.stringify(entries())).not.toContain('secret');
    });

    it('logs one warning for a chunked response cut mid-stream', async () => {
      cutAfterHeaders(false);

      const res = await call('/api/v1/stream');
      await pause(100);

      expect(res.status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(errors()).toEqual([]);
      expect(warnings()).toHaveLength(1);
    });

    it('logs one warning for a POST whose response is cut and never replays it', async () => {
      cutAfterHeaders(true);

      const res = await call('/api/v1/requests', 'POST', '{}');
      await pause(100);

      expect(res.status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(errors()).toEqual([]);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toMatchObject({
        method: 'POST',
        path: '/api/v1/requests',
      });
    });

    it('logs one warning for a response that ends short of its content length', async () => {
      behave = (_req, res) => {
        res.writeHead(200, { 'content-length': '10' });
        res.write('abc');
        res.socket?.end();
      };

      const res = await call('/api/v1/garages');
      await pause(100);

      expect(res.status).toBe(200);
      expect(errors()).toEqual([]);
      expect(warnings()).toHaveLength(1);
    });
  });

  // @traces 1345-FR-010
  describe('a visitor who leaves', () => {
    it('is neither retried nor logged above info while the API is silent', async () => {
      behave = () => {};
      const req = httpRequest(`${base}/api/v1/slow`);
      req.on('error', () => {});
      req.end();
      while (seen.length === 0) await pause(10);

      req.destroy();
      await pause(300);

      expect(seen).toHaveLength(1);
      expect(entries()).toEqual([]);
    });

    it('is neither retried nor logged above info while a stream is open', async () => {
      behave = (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: one\n\n');
      };
      const req = httpRequest(`${base}/api/v1/live`);
      req.on('error', () => {});
      const opened = new Promise<void>((resolve) =>
        req.on('response', (res) => res.once('data', () => resolve())),
      );
      req.end();
      await opened;

      req.destroy();
      await pause(300);

      expect(seen).toHaveLength(1);
      expect(entries()).toEqual([]);
    });

    it('leaves nothing in the logs after twenty visitors leave mid-flight', async () => {
      behave = () => {};
      const reqs = Array.from({ length: 20 }, (_, i) => {
        const req = httpRequest(`${base}/api/v1/slow/${i}`);
        req.on('error', () => {});
        req.end();
        return req;
      });
      while (seen.length < 20) await pause(10);

      for (const req of reqs) req.destroy();
      await pause(300);

      expect(seen).toHaveLength(20);
      expect(entries()).toEqual([]);
    });
  });
});

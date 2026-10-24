/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import express from 'express';

import { mountEdge } from './edge';

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

const call = (port: number, method: string, path: string, body?: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      { agent: false, host: '127.0.0.1', method, path, port },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () =>
          resolve({ body: text, status: res.statusCode ?? 0 }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });

describe('web edge proxy with an API that resets connections', () => {
  let upstream: Server;
  let web: Server;
  let webPort: number;
  let connections: number;
  let bodies: string[];
  let reset: (socket: Socket) => void;
  let spies: jest.SpyInstance[];

  beforeEach(async () => {
    spies = [
      jest.spyOn(process.stdout, 'write').mockImplementation(() => true),
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true),
    ];
    connections = 0;
    bodies = [];
    reset = (socket) => socket.resetAndDestroy();
    // A request that reaches a handler is recorded and never answered: no
    // answer can race the reset that follows it.
    upstream = createServer((req) => {
      let text = '';
      req.on('data', (c) => {
        text += c;
      });
      req.on('end', () => {
        bodies.push(text);
      });
    });
    upstream.on('connection', (socket) => {
      connections += 1;
      reset(socket);
    });
    const upstreamPort = await listen(upstream);
    const app = express();
    mountEdge(app, `http://127.0.0.1:${upstreamPort}`);
    web = createServer(app);
    webPort = await listen(web);
  });

  afterEach(async () => {
    for (const spy of spies) spy.mockRestore();
    await close(web);
    await close(upstream);
  });

  it.each(['GET', 'POST', 'DELETE', 'PUT', 'PATCH'])(
    'answers 502 for a %s when the API resets every connection',
    async (method) => {
      const res = await call(
        webPort,
        method,
        '/api/things',
        method === 'GET' || method === 'DELETE' ? undefined : '{"a":1}',
      );
      expect(res.status).toBe(502);
      expect(bodies).toEqual([]);
    },
  );

  it('tries a GET twice and a POST once, never reaching a handler', async () => {
    await call(webPort, 'GET', '/api/things');
    expect(connections).toBe(2);

    connections = 0;
    const post = await call(webPort, 'POST', '/api/things', 'x'.repeat(1024));
    expect(post.status).toBe(502);
    expect(connections).toBe(1);
    expect(bodies).toEqual([]);
  });

  it('answers 502 and replays no body when the API drops after reading the request', async () => {
    let received = '';
    reset = (socket) => {
      socket.on('data', (chunk) => {
        received += chunk.toString('latin1');
        if (received.includes('secret-body')) socket.resetAndDestroy();
      });
    };
    const post = await call(webPort, 'POST', '/api/things', 'secret-body');
    expect(post.status).toBe(502);
    expect(connections).toBe(1);
    expect(received.split('secret-body')).toHaveLength(2);
  });

  it('keeps serving the next request after a reset', async () => {
    const first = await call(webPort, 'GET', '/api/a');
    const second = await call(webPort, 'GET', '/api/b');
    expect([first.status, second.status]).toEqual([502, 502]);
    expect(connections).toBe(4);
  });
});

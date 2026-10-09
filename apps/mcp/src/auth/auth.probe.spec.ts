import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Logger } from '@nestjs/common';

import { IssuerProbe } from './auth.probe';
import { setIssuerUp } from '../metrics/metrics';

jest.mock('../metrics/metrics', () => ({ setIssuerUp: jest.fn() }));

const up = setIssuerUp as jest.MockedFunction<typeof setIssuerUp>;

describe('the identity server probe', () => {
  let server: Server;
  let status: number;
  let paths: string[];
  let issuer: string;
  let lines: unknown[][];

  beforeEach(async () => {
    status = 200;
    paths = [];
    lines = [];
    up.mockReset();
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          lines.push([level, ...args]);
        });
    }
    server = createServer((req, res) => {
      paths.push(req.url ?? '');
      res.writeHead(status).end('{"issuer":"secret-body"}');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/motorfix-assistants`;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    await new Promise((resolve) => server.close(resolve));
  });

  const probe = (at = issuer) =>
    new IssuerProbe({ issuer: at, mcpUrl: 'https://mcp.example.test/mcp' });

  it("reads the realm's discovery document and reports the server up", async () => {
    await probe().probe();

    expect(paths).toEqual([
      '/realms/motorfix-assistants/.well-known/openid-configuration',
    ]);
    expect(up.mock.calls).toEqual([[true]]);
  });

  it('reports it down on an error status, naming the status', async () => {
    status = 503;

    await probe().probe();

    expect(up.mock.calls).toEqual([[false]]);
    expect(JSON.stringify(lines)).toContain('HTTP 503');
  });

  it('reports it down when nothing listens', async () => {
    await probe('http://127.0.0.1:1/realms/motorfix-assistants').probe();

    expect(up.mock.calls).toEqual([[false]]);
    expect(lines).toHaveLength(1);
  });

  it('gives up after ten seconds and reports it down', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('timed out')),
          );
        }),
    );

    const done = probe().probe();
    await jest.advanceTimersByTimeAsync(9_999);
    expect(up).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await done;

    expect(up.mock.calls).toEqual([[false]]);
  });

  it('logs once per change of state, with the host and nothing of the answer', async () => {
    const checker = probe();

    await checker.probe();
    await checker.probe();
    status = 500;
    await checker.probe();
    await checker.probe();
    status = 200;
    await checker.probe();

    expect(lines.map(([level]) => level)).toEqual(['log', 'warn', 'log']);
    const text = JSON.stringify(lines);
    expect(text).toContain('127.0.0.1');
    expect(text).not.toContain('secret-body');
  });

  it('probes at start, every minute after, and stops when the module goes', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const fetched = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{}'));
    const checker = probe();

    await checker.onModuleInit();
    expect(fetched).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fetched).toHaveBeenCalledTimes(2);

    checker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});

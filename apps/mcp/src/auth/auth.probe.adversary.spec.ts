import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Logger } from '@nestjs/common';

import { IssuerProbe } from './auth.probe';
import { setIssuerUp } from '../metrics/metrics';

jest.mock('../metrics/metrics', () => ({ setIssuerUp: jest.fn() }));

const up = setIssuerUp as jest.MockedFunction<typeof setIssuerUp>;

describe('the identity server probe under hostile answers', () => {
  let server: Server;
  let handler: Parameters<typeof createServer>[1];
  let base: string;
  let lines: string[];

  beforeEach(async () => {
    up.mockReset();
    lines = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          lines.push(JSON.stringify(args));
        });
    }
    handler = (_req, res) => res.writeHead(200).end('{}');
    server = createServer((req, res) => handler?.(req, res));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const probe = (issuer = `${base}/realms/motorfix-assistants`) =>
    new IssuerProbe({ issuer, mcpUrl: 'https://mcp.example.test/mcp' });

  it('reports nothing before the first probe has answered', () => {
    probe();

    expect(up).not.toHaveBeenCalled();
  });

  it('treats a redirect to a dead address as down', async () => {
    handler = (_req, res) =>
      res.writeHead(302, { location: 'http://127.0.0.1:1/x' }).end();

    await probe().probe();

    expect(up.mock.calls).toEqual([[false]]);
  });

  it.each([404, 429, 500])('reports down for status %i', async (s) => {
    handler = (_req, res) => res.writeHead(s).end();

    await probe().probe();

    expect(up.mock.calls).toEqual([[false]]);
  });

  it('reports down when the connection is reset mid-answer', async () => {
    handler = (req) => req.socket.destroy();

    await probe().probe();

    expect(up.mock.calls).toEqual([[false]]);
    expect(lines).toHaveLength(1);
  });

  it('reports down for an issuer that is not a URL, without throwing', async () => {
    await expect(probe('not a url').probe()).resolves.toBeUndefined();

    expect(up.mock.calls).toEqual([[false]]);
  });

  it('does not put a token in the log when the issuer carries credentials', async () => {
    handler = (_req, res) => res.writeHead(500).end();
    const url = base.replace('http://', 'http://user:hunter2@');

    await probe(`${url}/realms/x`).probe();

    expect(lines.join('')).not.toContain('hunter2');
  });

  it('reports one sample per probe, never a second for the same answer', async () => {
    const checker = probe();

    await checker.probe();
    await checker.probe();

    expect(up.mock.calls).toEqual([[true], [true]]);
  });

  it('keeps probing after a failed probe', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation(async () => new Response('{}'));
    const checker = probe();

    await checker.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);
    checker.onModuleDestroy();

    expect(up.mock.calls).toEqual([[false], [true]]);
  });

  it('can be destroyed without having been started', () => {
    expect(() => probe().onModuleDestroy()).not.toThrow();
  });
});

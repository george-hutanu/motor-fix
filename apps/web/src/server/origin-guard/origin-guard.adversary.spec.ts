/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
// @traces 430-FR-007 430-FR-010
import { createServer, request as rawRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { metrics } from '@opentelemetry/api';
import express from 'express';

import { mountOriginGuard } from './origin-guard';

let server: Server | undefined;
let port = 0;

async function serve(secrets: string[]) {
  const app = express();
  // As server.ts sets it up: no answer names the framework.
  app.disable('x-powered-by');
  mountOriginGuard(app, secrets);
  app.get('/health/live', (_req, res) => res.send('live'));
  app.get('/health/ready', (_req, res) => res.send('ready'));
  app.use((_req, res) => res.send('reached'));
  server = createServer(app);
  await new Promise<void>((done) => server?.listen(0, done));
  port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

function raw(
  path: string,
  headers: Record<string, string | string[]> = {},
  method = 'GET',
) {
  return new Promise<{
    status: number;
    body: string;
    headers: Record<string, unknown>;
  }>((resolve, reject) => {
    const req = rawRequest(
      { headers, host: '127.0.0.1', method, path, port },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () =>
          resolve({
            body,
            headers: res.headers,
            status: res.statusCode ?? 0,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

afterEach(async () => {
  jest.restoreAllMocks();
  await new Promise((done) => server?.close(done));
  server = undefined;
});

describe('the origin guard under hostile input', () => {
  it.each(['s3cret-extra', 'xs3cret', 'S3CRET', 'a, s3cret', ''])(
    'refuses the value %j',
    async (value) => {
      await serve(['s3cret']);

      const answer = await raw('/ro', { 'X-Origin-Secret': value });

      expect(answer.status).toBe(403);
    },
  );

  it('refuses two header lines when one of them is right', async () => {
    await serve(['s3cret']);

    const answer = await raw('/ro', { 'X-Origin-Secret': ['wrong', 's3cret'] });

    expect(answer.status).toBe(403);
  });

  it('does not let an empty entry in the list open the door', async () => {
    await serve(['', 's3cret']);

    expect((await raw('/ro')).status).toBe(403);
    expect((await raw('/ro', { 'X-Origin-Secret': '' })).status).toBe(403);
    expect((await raw('/ro', { 'x-origin-secret': 's3cret' })).status).toBe(
      200,
    );
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'refuses the object-property name %s as a value',
    async (value) => {
      await serve(['s3cret']);

      expect((await raw('/ro', { 'X-Origin-Secret': value })).status).toBe(403);
    },
  );

  it.each([
    '/HEALTH/LIVE',
    '/health/live/',
    '/health',
    '//health/live',
    '/health/live%2f',
    '/health/ready/x',
  ])('does not exempt %s', async (path) => {
    await serve(['s3cret']);

    expect((await raw(path)).status).toBe(403);
  });

  it('still answers a probe that carries a query string', async () => {
    await serve(['s3cret']);

    expect((await raw('/health/live?probe=1')).status).toBe(200);
  });

  it.each(['HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'])(
    'refuses a %s without the header',
    async (method) => {
      await serve(['s3cret']);

      const answer = await raw('/api/v1/me', {}, method);

      expect(answer.status).toBe(403);
      expect(answer.body).toBe('');
    },
  );

  it('sends nothing but the transport headers with a refusal', async () => {
    await serve(['s3cret']);

    const answer = await raw('/ro');

    const extra = Object.keys(answer.headers).filter(
      (name) =>
        !['connection', 'content-length', 'date', 'keep-alive'].includes(name),
    );
    expect(extra).toEqual([]);
  });

  it('counts each refusal once and an accepted request never', async () => {
    const add = jest.fn();
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: () => ({ add }),
    } as unknown as ReturnType<typeof metrics.getMeter>);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await serve(['s3cret']);

    await raw('/a');
    await raw('/b', { 'X-Origin-Secret': 'nope' });
    await raw('/c', { 'X-Origin-Secret': 's3cret' });
    await raw('/health/live');
    await raw('/d');

    expect(add).toHaveBeenCalledTimes(3);
  });

  it('logs one line per refusal and never a secret from the list', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await serve(['old-secret', 'new-secret']);

    await raw('/ro', { 'X-Origin-Secret': 'old-secrex' });

    const text = warn.mock.calls.map((call) => String(call[0])).join('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(text).not.toContain('old-secre');
    expect(text).not.toContain('new-secret');
  });

  it('serves two hundred concurrent requests with the list of a rotation', async () => {
    await serve(['old', 'new']);

    const answers = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        raw('/ro', { 'X-Origin-Secret': i % 2 ? 'old' : 'new' }),
      ),
    );

    expect(answers.every((a) => a.status === 200)).toBe(true);
  });
});

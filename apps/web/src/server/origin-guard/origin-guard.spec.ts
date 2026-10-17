/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
// @traces 430-FR-007 430-FR-010
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { metrics } from '@opentelemetry/api';
import express from 'express';

import { mountOriginGuard } from './origin-guard';

let server: Server | undefined;

async function serve(secrets: string[]) {
  const app = express();
  mountOriginGuard(app, secrets);
  app.get('/health/live', (_req, res) => res.send('live'));
  app.get('/health/ready', (_req, res) => res.send('ready'));
  app.use((_req, res) => res.send('reached'));
  server = createServer(app);
  await new Promise<void>((done) => server?.listen(0, done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  jest.restoreAllMocks();
  await new Promise((done) => server?.close(done));
  server = undefined;
});

describe('the origin guard', () => {
  it('lets every request through when no secret is set', async () => {
    const base = await serve([]);

    const answer = await fetch(`${base}/ro`);

    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('reached');
  });

  it.each(['/', '/ro/garages/x', '/api/v1/live', '/main-ABCD1234.js'])(
    'refuses %s without the header, with an empty body',
    async (path) => {
      const base = await serve(['s3cret']);

      const answer = await fetch(`${base}${path}`);

      expect(answer.status).toBe(403);
      expect(await answer.text()).toBe('');
    },
  );

  it('refuses a value that is not in the list', async () => {
    const base = await serve(['s3cret']);

    const answer = await fetch(`${base}/ro`, {
      headers: { 'X-Origin-Secret': 's3cre' },
    });

    expect(answer.status).toBe(403);
  });

  it('accepts any value in the list, so a secret can be rotated', async () => {
    const base = await serve(['old', 'new']);

    for (const value of ['old', 'new']) {
      const answer = await fetch(`${base}/ro`, {
        headers: { 'X-Origin-Secret': value },
      });
      expect(answer.status).toBe(200);
    }
  });

  it.each(['/health/live', '/health/ready'])(
    'lets the platform probe %s without the header',
    async (path) => {
      const base = await serve(['s3cret']);

      expect((await fetch(`${base}${path}`)).status).toBe(200);
    },
  );

  it('does not exempt an address that only starts like a probe', async () => {
    const base = await serve(['s3cret']);

    expect((await fetch(`${base}/health/live/x`)).status).toBe(403);
    expect((await fetch(`${base}/health/readyz`)).status).toBe(403);
  });

  it('counts a refusal and logs its path, never the value sent', async () => {
    const add = jest.fn();
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: () => ({ add }),
    } as unknown as ReturnType<typeof metrics.getMeter>);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const base = await serve(['s3cret']);

    await fetch(`${base}/ro/garages/x`, {
      headers: { 'X-Origin-Secret': 'guess-123' },
    });

    expect(add).toHaveBeenCalledWith(1);
    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines.map((line) => JSON.parse(line).message)).toEqual([
      'origin refused GET /ro/garages/x',
    ]);
    expect(lines.join('')).not.toContain('guess-123');
    expect(lines.join('')).not.toContain('s3cret');
  });
});

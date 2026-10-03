import type { AddressInfo } from 'node:net';

import { createServer } from './server';

describe('mcp server under odd requests', () => {
  const server = createServer();
  let base: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('answers live as JSON', async () => {
    const res = await fetch(`${base}/health/live`);

    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('answers live when the URL carries a query string', async () => {
    const res = await fetch(`${base}/health/live?probe=1`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it.each([
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
  ])('answers 404 to %s on the live path', async (method) => {
    const res = await fetch(`${base}/health/live`, {
      body: '{"a":1}',
      method,
    });

    expect(res.status).toBe(404);
  });

  it.each([
    '/',
    '/health',
    '/health/',
    '/health/live/',
    '/HEALTH/LIVE',
    '/health/live/extra',
    '/health/%6Cive/x',
    '/api/v1/health/live',
    '/%E2%9C%93',
  ])('answers 404 for %s', async (path) => {
    const res = await fetch(`${base}${path}`);

    expect(res.status).toBe(404);
  });

  it('answers a hundred concurrent live checks', async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, () => fetch(`${base}/health/live`)),
    );

    expect(results.map((r) => r.status)).toEqual(Array(100).fill(200));
  });

  it('survives a request with a body on the live path and keeps serving', async () => {
    await fetch(`${base}/health/live`, {
      body: 'x'.repeat(2_000_000),
      method: 'POST',
    });

    expect((await fetch(`${base}/health/live`)).status).toBe(200);
  });
});

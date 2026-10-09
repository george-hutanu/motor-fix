import type { INestApplication } from '@nestjs/common';

import { bootMcp } from './boot.testing';

describe('mcp server under odd requests', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootMcp());
  });

  afterAll(() => app.close());

  it('answers live as JSON', async () => {
    const res = await fetch(`${base}/health/live`);

    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('answers live when the URL carries a query string', async () => {
    const res = await fetch(`${base}/health/live?probe=1`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])(
    'answers 404 to %s on the live path',
    async (method) => {
      const res = await fetch(`${base}/health/live`, {
        body: '{"a":1}',
        method,
      });

      expect(res.status).toBe(404);
    },
  );

  it.each([
    '/',
    '/health',
    '/health/',
    '/health/live/',
    '/HEALTH/LIVE',
    '/health/live/extra',
    '/health/%6Cive/x',
    '/api/v1/health/live',
    '/api/v1/me',
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

  it('refuses an MCP body past the JSON limit without reading a token', async () => {
    const res = await fetch(`${base}/mcp`, {
      body: JSON.stringify({ padding: 'x'.repeat(2_000_000) }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

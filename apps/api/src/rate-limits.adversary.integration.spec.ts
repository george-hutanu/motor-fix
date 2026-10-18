import { ROUTE_LIMITS } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';

import { apiBoot } from './api-boot.testing';

const api = apiBoot();
const store = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
let app: INestApplication;

beforeAll(async () => {
  app = await api.start();
});

afterAll(async () => {
  await store.quit();
  await api.stop();
});

beforeEach(async () => {
  const keys = await store.keys('limit:*');
  if (keys.length) await store.del(...keys);
});

const from = (address: string) => ({ 'X-Forwarded-For': address });

// @traces 1181-FR-001
describe('the Retry-After header on the API', () => {
  it('names the seconds left on a refused search, within its window', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < ROUTE_LIMITS.search.limit; i++)
      await request(server)
        .get('/api/v1/search/garages')
        .set(from('203.0.113.50'))
        .query({ brand: 'dacia' });

    const res = await request(server)
      .get('/api/v1/search/garages')
      .set(from('203.0.113.50'))
      .query({ brand: 'dacia' });

    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('rate_limited');
    const wait = Number(res.headers['retry-after']);
    expect(Number.isInteger(wait)).toBe(true);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(ROUTE_LIMITS.search.windowSeconds);
    expect(res.body.retryAfterSeconds).toBe(wait);
  });

  it('refuses a sign-in attempt past the per-address count with a wait', async () => {
    const server = app.getHttpServer();
    let last = 0;
    let header: string | undefined;
    for (let i = 0; i < ROUTE_LIMITS.signInAttempts.limit + 1; i++) {
      const res = await request(server)
        .post('/api/v1/auth/sign-in')
        .set(from('203.0.113.51'))
        .send({ email: `nobody${i}@example.test`, password: 'x' });
      last = res.status;
      header = res.headers['retry-after'];
    }

    expect(last).toBe(429);
    expect(Number(header)).toBeGreaterThanOrEqual(1);
  });

  it('keeps another address signing in after one is refused', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < ROUTE_LIMITS.signInAttempts.limit + 1; i++)
      await request(server)
        .post('/api/v1/auth/sign-in')
        .set(from('203.0.113.52'))
        .send({ email: `nobody${i}@example.test`, password: 'x' });

    const res = await request(server)
      .post('/api/v1/auth/sign-in')
      .set(from('203.0.113.53'))
      .send({ email: 'other@example.test', password: 'x' });

    expect(res.status).toBe(401);
  });
});

// @traces 1181-FR-001
describe('per-account routes called without a session', () => {
  it.each([
    ['POST', '/api/v1/quotes'],
    ['POST', '/api/v1/push-subscriptions/test'],
  ])('%s %s answers 401 and spends no count', async (_method, path) => {
    for (let i = 0; i < 70; i++) {
      const res = await request(app.getHttpServer())
        .post(path)
        .set(from('203.0.113.54'))
        .send({});
      expect(res.status).toBe(401);
    }

    expect(await store.keys('limit:*')).toEqual([]);
  });
});

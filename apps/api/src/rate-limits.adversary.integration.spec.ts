import { createHash, randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  AccountsService,
  ROUTE_LIMITS,
  signAccessToken,
} from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

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
  const keys = [
    ...(await store.keys(`${ROUTE_LIMITS.search.key}:*`)),
    ...(await store.keys(`${ROUTE_LIMITS.signInAttempts.key}:*`)),
  ];
  if (keys.length) await store.del(...keys);
});

// A well-formed quote, so the call reaches the limit past validation.
const QUOTE = {
  durationMinutes: 120,
  fromLei: 650,
  requestId: randomUUID(),
  slot: new Date(Date.now() + 48 * 3_600_000).toISOString(),
  toLei: 800,
};

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
    const counts = async () =>
      (await store.keys(`${ROUTE_LIMITS.quoteSend.key}:*`)).length +
      (await store.keys(`${ROUTE_LIMITS.pushTest.key}:*`)).length;
    const before = await counts();
    for (let i = 0; i < 70; i++) {
      const res = await request(app.getHttpServer())
        .post(path)
        .set(from('203.0.113.54'))
        .send({});
      expect(res.status).toBe(401);
    }

    expect(await counts()).toBe(before);
  });
});

// @traces 1181-FR-001
// @traces 1181-FR-011
describe('the Retry-After header on per-account routes', () => {
  const account = async (role: 'driver' | 'garage') =>
    (
      await app.get(AccountsService).createAccount({
        consent: CURRENT_CONSENT,
        identity: { method: 'google', subject: `${role}-${randomUUID()}` },
        name: role,
        roles: [role],
      })
    ).id;
  const bearer = (accountId: string, role: string) =>
    `Bearer ${signAccessToken({ accountId, role } as never, TEST_TOKEN_SECRET, Date.now())}`;
  // Brings the account to its limit without making the calls.
  const spent = (
    rule: { key: string; limit: number; windowSeconds: number },
    id: string,
  ) =>
    store.set(
      `${rule.key}:${createHash('sha256').update(id).digest('hex')}`,
      rule.limit,
      'EX',
      rule.windowSeconds,
    );

  it.each([
    ['quote send', 'garage', '/api/v1/quotes', ROUTE_LIMITS.quoteSend],
    [
      'push test',
      'driver',
      '/api/v1/push-subscriptions/test',
      ROUTE_LIMITS.pushTest,
    ],
  ] as const)(
    'names the seconds left on a refused %s',
    async (_, role, path, rule) => {
      const id = await account(role);
      await spent(rule, id);

      const res = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', bearer(id, role))
        .set('Idempotency-Key', randomUUID())
        .send(path === '/api/v1/quotes' ? QUOTE : {});

      expect(res.status).toBe(429);
      const wait = Number(res.headers['retry-after']);
      expect(wait).toBeGreaterThanOrEqual(1);
      expect(wait).toBeLessThanOrEqual(rule.windowSeconds);
      expect(res.body).toMatchObject({
        code: 'rate_limited',
        retryAfterSeconds: wait,
      });
    },
  );
});

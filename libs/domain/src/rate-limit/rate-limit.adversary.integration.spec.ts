import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { Redis } from 'ioredis';

import { ROUTE_LIMITS } from './rate-limit.config';
import { RateLimits } from './rate-limit.service';
import { redisUrlFor } from '../notifications/notifications.testing';

const store = new Redis(redisUrlFor(5));
const limits = new RateLimits(store);

afterEach(async () => {
  const keys = await store.keys('limit:*');
  if (keys.length) await store.del(...keys);
});
afterAll(async () => {
  await store.quit();
});

const refusal = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException)
      return { body: error.getResponse(), status: error.getStatus() };
    throw error;
  }
  return null;
};

// @traces 1181-FR-001
describe('the route limits on a real store', () => {
  it.each(Object.entries(ROUTE_LIMITS))(
    '%s admits exactly its limit and refuses the next',
    async (name, rule) => {
      const value =
        rule.per === 'address'
          ? `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.9`
          : randomUUID();
      const key = name as keyof typeof ROUTE_LIMITS;
      for (let i = 0; i < rule.limit; i++)
        expect(await limits.wait(key, value)).toBeNull();

      const wait = await limits.wait(key, value);

      expect(wait).toBeGreaterThanOrEqual(1);
      expect(wait).toBeLessThanOrEqual(rule.windowSeconds);
    },
  );

  it('refuses with status 429, the rate_limited code and the seconds to wait', async () => {
    const value = randomUUID();
    for (let i = 0; i < ROUTE_LIMITS.pushTest.limit; i++)
      await limits.take('pushTest', value);

    const result = await refusal(limits.take('pushTest', value));

    expect(result?.status).toBe(429);
    expect(result?.body).toMatchObject({ code: 'rate_limited' });
    expect(result?.body).toMatchObject({
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('never lets an account spend another account share', async () => {
    const first = randomUUID();
    for (let i = 0; i <= ROUTE_LIMITS.pushTest.limit; i++)
      await limits.wait('pushTest', first);

    expect(await limits.wait('pushTest', randomUUID())).toBeNull();
  });

  it('admits at most the limit under parallel calls on one key', async () => {
    const value = randomUUID();
    const calls = await Promise.all(
      Array.from({ length: ROUTE_LIMITS.pushTest.limit * 4 }, () =>
        limits.wait('pushTest', value),
      ),
    );

    expect(calls.filter((wait) => wait === null)).toHaveLength(
      ROUTE_LIMITS.pushTest.limit,
    );
  });

  it('keeps a window that expires and starts a new one after it', async () => {
    const value = randomUUID();
    for (let i = 0; i <= ROUTE_LIMITS.pushTest.limit; i++)
      await limits.wait('pushTest', value);
    const keys = await store.keys('limit:push-test:*');
    expect(keys).toHaveLength(1);
    await store.del(...keys);

    expect(await limits.wait('pushTest', value)).toBeNull();
  });

  it('holds no raw identifier in any key', async () => {
    const value = 'someone@example.com';
    await limits.wait('quoteSend', value);
    await limits.wait('search', '203.0.113.9');

    const keys = await store.keys('limit:*');

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => /example\.com|203\.0\.113/.test(key))).toEqual(
      [],
    );
  });

  it('counts the empty string and unicode values under keys of their own', async () => {
    for (let i = 0; i < ROUTE_LIMITS.pushTest.limit; i++)
      await limits.wait('pushTest', '');

    expect(await limits.wait('pushTest', '')).toBeGreaterThanOrEqual(1);
    expect(await limits.wait('pushTest', 'ăîșț🚗')).toBeNull();
  });

  it('treats an IPv4 address and its IPv6-mapped form as one client', async () => {
    for (let i = 0; i < ROUTE_LIMITS.search.limit; i++)
      await limits.wait('search', '198.51.100.7');

    expect(
      await limits.wait('search', '::ffff:198.51.100.7'),
    ).toBeGreaterThanOrEqual(1);
  });

  it('counts two addresses of one IPv6 prefix as one client', async () => {
    for (let i = 0; i < ROUTE_LIMITS.search.limit; i++)
      await limits.wait('search', '2001:db8:1:2:aaaa::1');

    expect(
      await limits.wait('search', '2001:db8:1:2:bbbb::2'),
    ).toBeGreaterThanOrEqual(1);
  });

  it('admits the call when the store does not answer', async () => {
    const dead = new Redis('redis://127.0.0.1:1', {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
    });
    dead.on('error', () => undefined);

    expect(
      await new RateLimits(dead).wait('search', '198.51.100.1'),
    ).toBeNull();
    dead.disconnect();
  });
});

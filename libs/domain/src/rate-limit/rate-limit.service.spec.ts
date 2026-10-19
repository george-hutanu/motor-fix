import { createHash } from 'node:crypto';

import { HttpException, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { ROUTE_LIMITS } from './rate-limit.config';
import { RateLimits } from './rate-limit.service';

function countingRedis(ttl: number) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const redis = {
    multi() {
      const replies: [null, number][] = [];
      const chain = {
        exec: async () => replies,
        expire() {
          replies.push([null, 1]);
          return chain;
        },
        incr(key: string) {
          keys.push(key);
          counts.set(key, (counts.get(key) ?? 0) + 1);
          replies.push([null, counts.get(key) ?? 0]);
          return chain;
        },
        ttl() {
          replies.push([null, ttl]);
          return chain;
        },
      };
      return chain;
    },
  } as unknown as Redis;
  return { keys, redis };
}

const refusal = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return { body: error.getResponse(), status: error.getStatus() };
  }
  return null;
};

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

// @traces 1181-FR-001
// @traces 1181-FR-004
// @traces 1181-FR-005
// @traces 1181-FR-012
describe('the route limits', () => {
  beforeEach(() =>
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
  );
  afterEach(() => jest.restoreAllMocks());

  it('admits a key up to its limit, then refuses with rate_limited and the wait', async () => {
    const limits = new RateLimits(countingRedis(37).redis);
    const { limit } = ROUTE_LIMITS.pushTest;

    for (let i = 0; i < limit; i++) {
      await expect(
        limits.take('pushTest', 'account-1'),
      ).resolves.toBeUndefined();
    }

    expect(await refusal(limits.take('pushTest', 'account-1'))).toEqual({
      body: {
        code: 'rate_limited',
        message: 'Too many attempts; try again later',
        retryAfterSeconds: 37,
      },
      status: 429,
    });
  });

  it('counts each key apart, so a second account is never refused', async () => {
    const limits = new RateLimits(countingRedis(60).redis);
    for (let i = 0; i <= ROUTE_LIMITS.pushTest.limit; i++) {
      await limits.wait('pushTest', 'account-1');
    }

    await expect(limits.take('pushTest', 'account-2')).resolves.toBeUndefined();
  });

  it('keys a per-account rule by the digest of the id, never the id', async () => {
    const { keys, redis } = countingRedis(60);

    await new RateLimits(redis).take('quoteSend', 'account-1');

    expect(keys).toEqual([
      `${ROUTE_LIMITS.quoteSend.key}:${digest('account-1')}`,
    ]);
  });

  it('keys a per-address rule by the client, one count for both forms of an address', async () => {
    const { keys, redis } = countingRedis(60);
    const limits = new RateLimits(redis);

    await limits.take('search', '198.51.100.7');
    await limits.take('search', '::ffff:198.51.100.7');

    const key = `${ROUTE_LIMITS.search.key}:${digest('198.51.100.7')}`;
    expect(keys).toEqual([key, key]);
  });

  it('admits every call and logs a warning when the store does not answer', async () => {
    const down = {
      multi: () => {
        throw new Error('Redis did not answer');
      },
    } as unknown as Redis;
    const limits = new RateLimits(down);

    for (let i = 0; i <= ROUTE_LIMITS.signInAttempts.limit + 1; i++) {
      await expect(
        limits.take('signInAttempts', '198.51.100.7'),
      ).resolves.toBeUndefined();
    }
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('answers the wait without throwing, for a caller that refuses on its own', async () => {
    const limits = new RateLimits(countingRedis(12).redis);
    for (let i = 0; i < ROUTE_LIMITS.assistant.limit; i++) {
      expect(await limits.wait('assistant', 'account-1')).toBeNull();
    }

    expect(await limits.wait('assistant', 'account-1')).toBe(12);
  });

  it('counts every rule of the table under its own key, a new one included', async () => {
    const { keys, redis } = countingRedis(30);
    const limits = new RateLimits(redis);

    for (const rule of Object.keys(
      ROUTE_LIMITS,
    ) as (keyof typeof ROUTE_LIMITS)[])
      expect(await limits.wait(rule, '203.0.113.7')).toBeNull();

    expect(keys.map((key) => key.split(':').slice(0, 2).join(':'))).toEqual(
      Object.values(ROUTE_LIMITS).map((rule) => rule.key),
    );
  });
});

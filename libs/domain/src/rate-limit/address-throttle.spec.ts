import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AddressThrottle } from './address-throttle';

function countingRedis(ttl: number) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const expiries: unknown[][] = [];
  const redis = {
    multi() {
      const replies: [null, number][] = [];
      const chain = {
        exec: async () => replies,
        expire(key: string, ...rest: unknown[]) {
          expiries.push([key, ...rest]);
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
  return { expiries, keys, redis };
}

const rule = {
  key: 'places:lookup',
  limit: 3,
  name: 'Places',
  windowSeconds: 60,
};

describe('a limit per address over a window', () => {
  beforeEach(() =>
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
  );
  afterEach(() => jest.restoreAllMocks());

  it('admits the limit, then names the seconds left in the window', async () => {
    const throttle = new AddressThrottle(countingRedis(42).redis, rule);

    for (let i = 0; i < rule.limit; i++) {
      expect(await throttle.take('198.51.100.7')).toBeNull();
    }

    expect(await throttle.take('198.51.100.7')).toBe(42);
  });

  it('waits at least a second when the window is about to close', async () => {
    const throttle = new AddressThrottle(countingRedis(0).redis, {
      ...rule,
      limit: 0,
    });

    expect(await throttle.take('198.51.100.7')).toBe(1);
  });

  it('keys its count under its own prefix by a digest, for its own window', async () => {
    const { expiries, keys, redis } = countingRedis(60);

    await new AddressThrottle(redis, rule).take('198.51.100.7');

    const digest = createHash('sha256').update('198.51.100.7').digest('hex');
    expect(keys).toEqual([`places:lookup:${digest}`]);
    expect(expiries).toEqual([[keys[0], 60, 'NX']]);
  });

  it('admits every request when Redis does not answer', async () => {
    const down = {
      multi: () => {
        throw new Error('Redis did not answer');
      },
    } as unknown as Redis;
    const throttle = new AddressThrottle(down, rule);

    for (let i = 0; i < rule.limit + 2; i++) {
      expect(await throttle.take('198.51.100.7')).toBeNull();
    }
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('admits a request whose address cannot be read', async () => {
    const { keys, redis } = countingRedis(60);

    expect(await new AddressThrottle(redis, rule).take('')).toBeNull();
    expect(keys).toEqual([]);
  });
});

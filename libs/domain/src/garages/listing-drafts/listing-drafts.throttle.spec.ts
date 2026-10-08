import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { CREATE_PER_HOUR } from './listing-drafts';
import { ListingDraftThrottle } from './listing-drafts.throttle';

// Counts as Redis would, with every key living an hour from its first count.
function countingRedis() {
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
          replies.push([null, 1800]);
          return chain;
        },
      };
      return chain;
    },
  } as unknown as Redis;
  return { expiries, keys, redis };
}

describe('the create limit per address', () => {
  beforeEach(() =>
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
  );
  afterEach(() => jest.restoreAllMocks());

  it('admits ten drafts an hour, then names the wait', async () => {
    const throttle = new ListingDraftThrottle(countingRedis().redis);

    for (let i = 0; i < CREATE_PER_HOUR; i++) {
      expect(await throttle.take('198.51.100.7')).toBeNull();
    }

    expect(await throttle.take('198.51.100.7')).toBe(1800);
  });

  it('counts each address apart, and an IPv4 address in its mapped form as one', async () => {
    const throttle = new ListingDraftThrottle(countingRedis().redis);
    for (let i = 0; i < CREATE_PER_HOUR; i++) {
      await throttle.take('198.51.100.7');
    }

    expect(await throttle.take('::ffff:198.51.100.7')).toBe(1800);
    expect(await throttle.take('198.51.100.8')).toBeNull();
  });

  it('keys the count by a digest, never the address itself, for an hour', async () => {
    const { expiries, keys, redis } = countingRedis();

    await new ListingDraftThrottle(redis).take('198.51.100.7');

    const digest = createHash('sha256').update('198.51.100.7').digest('hex');
    expect(keys).toEqual([`listing-drafts:create:${digest}`]);
    expect(keys[0]).not.toContain('198.51.100.7');
    expect(expiries).toEqual([[keys[0], 3600, 'NX']]);
  });

  it('admits every draft when Redis does not answer, and says so in the log', async () => {
    const down = {
      multi: () => {
        throw new Error('Redis did not answer');
      },
    } as unknown as Redis;
    const throttle = new ListingDraftThrottle(down);

    for (let i = 0; i < CREATE_PER_HOUR + 2; i++) {
      expect(await throttle.take('198.51.100.7')).toBeNull();
    }
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('admits a request whose address cannot be read', async () => {
    const { keys, redis } = countingRedis();

    expect(await new ListingDraftThrottle(redis).take('')).toBeNull();
    expect(keys).toEqual([]);
  });
});

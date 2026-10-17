import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { CacheService, cacheKey } from './cache.service';
import { purgeAudience } from './purge';
import { redisUrlFor } from '../notifications/notifications.testing';

const redis = new Redis(redisUrlFor(2));
const reader = new Redis(redisUrlFor(2));
const cache = new CacheService(reader);

afterAll(() => {
  redis.disconnect();
  reader.disconnect();
});
afterEach(() => jest.restoreAllMocks());

const fill = async (
  tag: string,
  kind: 'driver-home' | 'garage-home' = 'driver-home',
) => {
  const key = cacheKey(kind, randomUUID(), 'x');
  await cache.warm(() =>
    cache.read({
      key,
      read: async () => ({ tags: [tag], value: 1 }),
      soft: 90,
      stale: false,
    }),
  );
  return key;
};

// @traces 1169-FR-006
describe('purging warm entries by audience', () => {
  it('purges nothing and calls no hook for an empty audience', async () => {
    const hook = jest.fn();

    await expect(purgeAudience(redis, [], hook)).resolves.toEqual([]);

    expect(hook).not.toHaveBeenCalled();
  });

  it('purges the account and the garage entries of one event and no one else', async () => {
    const [account, garage, stranger] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const a = await fill(`warm:account:${account}`);
    const g = await fill(`warm:garage:${garage}`, 'garage-home');
    const s = await fill(`warm:account:${stranger}`);
    const sg = await fill(`warm:garage:${stranger}`, 'garage-home');

    await purgeAudience(redis, [`account:${account}`, `garage:${garage}`]);

    expect(await redis.exists(a, g)).toBe(0);
    expect(await redis.exists(s, sg)).toBe(2);
  });

  it('hands each warm tag to the hook', async () => {
    const id = randomUUID();
    const hook = jest.fn();

    await purgeAudience(redis, [`account:${id}`, `garage:${id}`], hook);

    expect(hook.mock.calls.map(([tag]) => tag)).toEqual([
      `warm:account:${id}`,
      `warm:garage:${id}`,
    ]);
  });

  it.each([
    'accounts:1',
    'account',
    'public:account:1',
    'xaccount:1',
    'ACCOUNT:1',
    ' account:1',
    'garages:1',
  ])('names no warm tag for the audience key %s', async (key) => {
    const hook = jest.fn();

    await purgeAudience(redis, [key], hook);

    expect(hook).not.toHaveBeenCalled();
  });

  it('keeps a warm entry whose account only resembles the audience key', async () => {
    const id = randomUUID();
    const k = await fill(`warm:account:${id}`);

    await purgeAudience(redis, [`public:account:${id}`, `account${id}`]);

    expect(await redis.exists(k)).toBe(1);
  });

  it('purges the entry once when the audience repeats a key', async () => {
    const id = randomUUID();
    const k = await fill(`warm:account:${id}`);

    const purged = await purgeAudience(redis, Array(50).fill(`account:${id}`));

    expect(purged).toEqual([k]);
    expect(await redis.exists(k)).toBe(0);
  });

  it('purges the entry of an account whose id holds unicode and colons', async () => {
    const id = `ț:${randomUUID()}`;
    const k = await fill(`warm:account:${id}`);

    await purgeAudience(redis, [`account:${id}`]);

    expect(await redis.exists(k)).toBe(0);
  });

  it('purges ten thousand audience keys without dropping the matching one', async () => {
    const id = randomUUID();
    const k = await fill(`warm:garage:${id}`, 'garage-home');
    const audience = Array.from(
      { length: 10_000 },
      (_, i) => `account:bulk-${i}`,
    );
    audience.push(`garage:${id}`);

    await purgeAudience(redis, audience);

    expect(await redis.exists(k)).toBe(0);
  }, 60_000);

  it('still purges when the hook fails', async () => {
    const id = randomUUID();
    const k = await fill(`warm:account:${id}`);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await purgeAudience(redis, [`account:${id}`], () => {
      throw new Error('cdn down');
    });

    expect(await redis.exists(k)).toBe(0);
  });

  it('rejects when Redis refuses, so the relay retries the event', async () => {
    const refusing = new Redis(redisUrlFor(2));
    jest.spyOn(refusing, 'eval').mockRejectedValue(new Error('READONLY'));

    await expect(purgeAudience(refusing, ['account:1'])).rejects.toThrow(
      'READONLY',
    );
    refusing.disconnect();
  });
});

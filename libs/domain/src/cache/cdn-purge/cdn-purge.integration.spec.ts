// @traces 430-FR-004
import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { CDN_PURGE_KEY, CdnPurgeSender, cdnPurgeHook } from './cdn-purge';
import { redisUrlFor } from '../../notifications/notifications.testing';

const redis = new Redis(redisUrlFor(2));
const CONFIG = { apiKey: 'key-123', pullZoneId: '42' };

afterAll(() => redis.disconnect());
beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// Each test its own set, so suites sharing the database never meet.
const ownKey = () => `${CDN_PURGE_KEY}:test:${randomUUID()}`;

describe('the CDN purge queue in Redis', () => {
  it('keeps a tag queued many times once, and the sender drains it', async () => {
    const key = ownKey();
    const hook = cdnPurgeHook(redis, key);
    await hook('garage:g-1');
    await hook('garage:g-1');
    await hook('search');
    await hook('warm:account:a-1');

    expect((await redis.smembers(key)).sort()).toEqual([
      'garage:g-1',
      'search',
    ]);

    const send = jest.fn(async () => new Response(null, { status: 204 }));
    await new CdnPurgeSender(redis, CONFIG, send, key).tick();

    expect(send).toHaveBeenCalledTimes(2);
    expect(await redis.exists(key)).toBe(0);
  });

  it('returns a tag the CDN refused to the set for the next tick', async () => {
    const key = ownKey();
    await cdnPurgeHook(redis, key)('garage:g-2');

    const refuse = jest.fn(async () => new Response(null, { status: 503 }));
    await new CdnPurgeSender(redis, CONFIG, refuse, key).tick();

    expect(await redis.smembers(key)).toEqual(['garage:g-2']);
    await redis.del(key);
  });
});

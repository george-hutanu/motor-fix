import { randomUUID } from 'node:crypto';

import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { Redis } from 'ioredis';

import { CacheService, cacheKey } from './cache.service';
import { purgeTags } from './purge';
import { redisUrlFor } from '../notifications/notifications.testing';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const clients: Redis[] = [];
const client = () => {
  const redis = new Redis(redisUrlFor(2));
  clients.push(redis);
  return redis;
};
const other = client();

afterAll(() => {
  for (const redis of clients) redis.disconnect();
});
afterEach(() => jest.restoreAllMocks());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const warmKey = () => cacheKey('driver-home', randomUUID(), 'cars');

async function counts() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === 'motorfix_cache_total');
  return Object.fromEntries(
    (found?.dataPoints ?? []).map((point) => [
      `${point.attributes['kind']} ${point.attributes['outcome']}`,
      point.value as number,
    ]),
  );
}

async function counting(run: () => Promise<unknown>) {
  const before = await counts();
  await run();
  const after = await counts();
  return Object.fromEntries(
    Object.entries(after)
      .map(([name, value]) => [name, value - (before[name] ?? 0)])
      .filter(([, value]) => value !== 0),
  );
}

const warmed = (
  cache: CacheService,
  key: string,
  value: unknown = 1,
  ms = 0,
  tags = ['warm:account:a'],
) =>
  cache.warm(() =>
    cache.read({
      key,
      read: async () => {
        await sleep(ms);
        return { tags, value };
      },
      soft: 90,
      stale: false,
    }),
  );

// @traces 1169-prefetch-intent-FR-001
describe('taking a warm entry under pressure', () => {
  it('gives a hundred simultaneous takes exactly one answer', async () => {
    const caches = [0, 1, 2, 3].map(() => new CacheService(client()));
    const k = warmKey();
    await warmed(caches[0], k, { cars: 2 });

    const answers = await Promise.all(
      Array.from({ length: 100 }, (_, i) => caches[i % 4].take(k)),
    );

    expect(answers.filter((a) => a !== undefined)).toEqual([{ cars: 2 }]);
  });

  it('answers falsy values as hits instead of misses', async () => {
    const cache = new CacheService(client());
    const [zero, empty] = [warmKey(), warmKey()];
    await warmed(cache, zero, 0);
    await warmed(cache, empty, []);

    const outcomes = await counting(async () => {
      await expect(cache.take(zero)).resolves.toBe(0);
      await expect(cache.take(empty)).resolves.toEqual([]);
    });

    expect(outcomes).toEqual({ 'driver-home hit': 2 });
  });

  it('counts a key nobody warmed as one miss and not as a fallback', async () => {
    const cache = new CacheService(client());

    const outcomes = await counting(async () => {
      await expect(cache.take(warmKey())).resolves.toBeUndefined();
    });

    expect(outcomes).toEqual({ 'driver-home miss': 1 });
  });

  it.each([
    ['text that is not JSON', 'not json {'],
    ['a JSON number', '42'],
    ['a JSON null', 'null'],
    ['an object without an expiry', '{"v":"leaked"}'],
  ])(
    'answers nothing and removes the key when it holds %s',
    async (_n, raw) => {
      const cache = new CacheService(client());
      const k = warmKey();
      await other.set(k, raw);

      await expect(cache.take(k)).resolves.toBeUndefined();

      expect(await other.exists(k)).toBe(0);
    },
  );

  it('answers nothing, and does not throw, when the warm it waited for failed', async () => {
    const cache = new CacheService(client());
    const k = warmKey();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const warming = cache.warm(() =>
      cache.read({
        key: k,
        read: async () => {
          await sleep(100);
          throw new Error('database refused');
        },
        soft: 90,
        stale: false,
      }),
    );
    warming.catch(() => undefined);
    await sleep(20);

    await expect(cache.take(k)).resolves.toBeUndefined();
    await expect(warming).rejects.toThrow('database refused');
    expect(await other.exists(k)).toBe(0);
  });

  it('never serves an entry a purge removed while its read was in flight', async () => {
    const cache = new CacheService(client());
    const tag = `warm:account:${randomUUID()}`;
    const k = warmKey();

    const warming = warmed(cache, k, 'old', 150, [tag]);
    await sleep(40);
    await purgeTags(other, [tag]);
    await warming;

    await expect(cache.take(k)).resolves.toBeUndefined();
  });

  it('never answers an entry after a purge of its tag', async () => {
    const cache = new CacheService(client());
    const tag = `warm:account:${randomUUID()}`;
    const k = warmKey();
    await warmed(cache, k, 'old', 0, [tag]);

    await purgeTags(other, [tag]);

    await expect(cache.take(k)).resolves.toBeUndefined();
  });

  it('is available again once Redis answers after an outage', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const k = warmKey();
    await warmed(cache, k, 'kept');
    const getdel = jest
      .spyOn(redis, 'getdel')
      .mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(cache.take(k)).resolves.toBeUndefined();
    expect(cache.available).toBe(false);
    getdel.mockRestore();

    await expect(cache.take(k)).resolves.toBe('kept');
    expect(cache.available).toBe(true);
  });

  it('lets a warm of a key whose entry was taken fill it again', async () => {
    const cache = new CacheService(client());
    const k = warmKey();
    await warmed(cache, k, 'first');
    await cache.take(k);

    await warmed(cache, k, 'second');

    await expect(cache.take(k)).resolves.toBe('second');
  });
});

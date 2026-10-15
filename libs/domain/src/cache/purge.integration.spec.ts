import { randomUUID } from 'node:crypto';

import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { Redis } from 'ioredis';

import { CacheService, cacheKey } from './cache.service';
import { purgeAudience, purgeTags } from './purge';
import { redisUrlFor } from '../notifications/notifications.testing';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const redis = new Redis(redisUrlFor(2));
const reader = new Redis(redisUrlFor(2));
const cache = new CacheService(reader);

afterAll(() => {
  redis.disconnect();
  reader.disconnect();
});

async function purges() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === 'motorfix_cache_total');
  return Object.fromEntries(
    (found?.dataPoints ?? [])
      .filter((point) => point.attributes['outcome'] === 'purge')
      .map((point) => [point.attributes['kind'], point.value as number]),
  );
}

const fill = (key: string, tags: string[], value: unknown = 1) =>
  cache.read({ key, read: async () => ({ tags, value }), soft: 600 });

// @traces 1182-FR-005 1182-FR-006
describe('purging by tag', () => {
  it('removes every entry a tag names and the tag itself, and only those', async () => {
    const garage = `garage:${randomUUID()}`;
    const [a, b, c] = [
      cacheKey('profile', randomUUID(), '-'),
      cacheKey('home', randomUUID(), '-'),
      cacheKey('profile', randomUUID(), '-'),
    ];
    await fill(a, [garage]);
    await fill(b, [garage, 'search']);
    await fill(c, [`garage:${randomUUID()}`]);
    const before = await purges();

    const purged = await purgeTags(redis, [garage]);

    expect(purged.sort()).toEqual([a, b].sort());
    expect(await redis.exists(a, b, `v1:tag:${garage}`)).toBe(0);
    expect(await redis.exists(c)).toBe(1);
    const after = await purges();
    expect((after['profile'] ?? 0) - (before['profile'] ?? 0)).toBe(1);
    expect((after['home'] ?? 0) - (before['home'] ?? 0)).toBe(1);
  });

  it('refuses the store of a read that began before the purge', async () => {
    const garage = `garage:${randomUUID()}`;
    const key = cacheKey('profile', randomUUID(), '-');
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });

    const reading = cache.read({
      key,
      read: async () => {
        await held;
        return { tags: [garage], value: 'before the change' };
      },
      soft: 600,
    });
    // Let the read take its lock and start before the purge lands.
    await new Promise((r) => setTimeout(r, 50));
    await purgeTags(redis, [garage]);
    release();

    await expect(reading).resolves.toBe('before the change');
    expect(await redis.exists(key)).toBe(0);
    await fill(key, [garage], 'after the change');
    expect(await redis.exists(key)).toBe(1);
  });

  it('hands each purged tag to the hook, and succeeds with the default one', async () => {
    const tags = [`garage:${randomUUID()}`, 'search'];
    const hook = jest.fn();

    await purgeTags(redis, tags, hook);
    await expect(purgeTags(redis, tags)).resolves.toEqual([]);

    expect(hook.mock.calls).toEqual([[tags[0]], [tags[1]]]);
  });

  it('throws when Redis refuses the purge, so the relay retries the event', async () => {
    const broken = {
      eval: () => Promise.reject(new Error('Connection is closed.')),
    };

    await expect(purgeTags(broken, ['search'])).rejects.toThrow(
      'Connection is closed.',
    );
  });
});

// @traces 1182-FR-005 1182-FR-007 1182-FR-008
describe('purging for an event audience', () => {
  const tagged = async (audience: string[]) => {
    const seen: string[] = [];
    await purgeAudience(redis, audience, (tag) => seen.push(tag));
    return seen;
  };

  it('purges a garage’s tag for its public channel, and the search tag once', async () => {
    const [a, b] = [randomUUID(), randomUUID()];

    expect(
      await tagged([`garage:${a}`, `public:garage:${a}`, `public:garage:${b}`]),
    ).toEqual([`garage:${a}`, `garage:${b}`, 'search']);
    expect(await tagged(['public:search'])).toEqual(['search']);
    expect(await tagged(['public:search:brand-1'])).toEqual(['search']);
  });

  it('purges nothing for audiences that only look like a public one', async () => {
    const id = randomUUID();

    expect(
      await tagged([
        `garage:${id}`,
        `account:${id}`,
        ` public:garage:${id}`,
        'public:garage',
        '',
      ]),
    ).toEqual([]);
  });
});

import { randomUUID } from 'node:crypto';

import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { Redis } from 'ioredis';

import { CacheService, cacheKey, lockKey, purgedKey } from './cache.service';
import { redisUrlFor } from '../notifications/notifications.testing';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const redisUrl = redisUrlFor(11);
const clients: Redis[] = [];
const client = () => {
  const redis = new Redis(redisUrl);
  clients.push(redis);
  return redis;
};
const other = client();

afterAll(() => {
  for (const redis of clients) redis.disconnect();
});

afterEach(() => jest.restoreAllMocks());

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

// What the counter gained since `before`.
async function since(before: Record<string, number>) {
  const after = await counts();
  return Object.fromEntries(
    Object.entries(after)
      .map(([name, value]) => [name, value - (before[name] ?? 0)])
      .filter(([, value]) => value !== 0),
  );
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Lets each entry reach Redis, then holds the store's reply until released:
// what a reader of Redis sees in between is what a test that waits for the
// key sees before the service has heard back.
function holdStoreReplies(redis: Redis) {
  const evaluate = redis.eval.bind(redis);
  const landed = deferred();
  const gate = deferred();
  jest.spyOn(redis, 'eval').mockImplementation(async (...args) => {
    const reply = await evaluate(...args);
    if (String(args[0]).includes('ZADD')) {
      landed.resolve();
      await gate.promise;
    }
    return reply;
  });
  return { landed: landed.promise, release: gate.resolve };
}

async function lockFree(key: string) {
  const deadline = performance.now() + 5000;
  while ((await other.exists(lockKey(key))) !== 0) {
    if (performance.now() > deadline) throw new Error('the lock was kept');
  }
}

const key = () => cacheKey('profile', randomUUID(), '-');
const tag = () => `garage:${randomUUID()}`;

// @traces 1348-FR-006
describe('the cache service’s count of a fill', () => {
  it('has counted a miss by the time its entry can be seen in Redis, and counts it once', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    const held = holdStoreReplies(redis);
    const k = key();
    const before = await counts();

    const reading = cache.read({
      key: k,
      read: async () => ({ tags: [tag()], value: { name: 'Service Auto' } }),
      soft: 600,
    });
    await held.landed;

    expect(await other.exists(k)).toBe(1);
    expect(await since(before)).toEqual({ 'profile miss': 1 });

    held.release();
    await expect(reading).resolves.toEqual({ name: 'Service Auto' });
    expect(await since(before)).toEqual({ 'profile miss': 1 });
  });

  it('has counted a warm by the time its entry can be seen in Redis, and no miss', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    const held = holdStoreReplies(redis);
    const k = key();
    const before = await counts();

    const warming = cache.warm(() =>
      cache.read({ key: k, read: async () => ({ value: 7 }), soft: 600 }),
    );
    await held.landed;

    expect(await other.exists(k)).toBe(1);
    expect(await since(before)).toEqual({ 'profile warm': 1 });

    held.release();
    await warming;
    expect(await since(before)).toEqual({ 'profile warm': 1 });
  });

  it('has counted the miss of a not-found answer by the time its entry can be seen in Redis', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    const held = holdStoreReplies(redis);
    const k = key();
    const before = await counts();

    const reading = cache.read({
      key: k,
      read: async () => ({ negative: true, value: { refused: 404 } }),
      soft: 600,
    });
    await held.landed;

    expect(await other.exists(k)).toBe(1);
    expect(await since(before)).toEqual({ 'profile miss': 1 });

    held.release();
    await reading;
    expect(await since(before)).toEqual({ 'profile miss': 1 });
  });

  it('counts nothing for a stale entry’s refresh, neither when the refreshed entry lands nor after', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    const k = key();
    let version = 1;
    const read = async () => ({ value: { version } });
    await cache.read({ key: k, read, soft: 60 });
    version = 2;
    const later = Date.now() + 120_000;
    jest.spyOn(Date, 'now').mockImplementation(() => later);
    const held = holdStoreReplies(redis);
    const before = await counts();

    await expect(cache.read({ key: k, read, soft: 60 })).resolves.toEqual({
      version: 1,
    });
    await held.landed;

    expect(String(await other.get(k))).toContain('"version":2');
    expect(await since(before)).toEqual({ 'profile stale': 1 });

    held.release();
    await lockFree(k);
    expect(await since(before)).toEqual({ 'profile stale': 1 });
  });

  it('counts a miss once when the purge wins and nothing is stored', async () => {
    const cache = new CacheService(client());
    const k = key();
    const purged = tag();
    const before = await counts();

    try {
      await expect(
        cache.read({
          key: k,
          read: async () => {
            await other.set(purgedKey(purged), String(Date.now() + 60_000));
            return { tags: [purged], value: { name: 'Service Auto' } };
          },
          soft: 600,
        }),
      ).resolves.toEqual({ name: 'Service Auto' });

      expect(await other.exists(k)).toBe(0);
      expect(await since(before)).toEqual({ 'profile miss': 1 });
    } finally {
      await other.del(purgedKey(purged));
    }
  });

  it('counts nothing while the read function has not answered', async () => {
    const cache = new CacheService(client());
    const k = key();
    const reading = deferred();
    const answer = deferred();
    const before = await counts();

    const read = cache.read({
      key: k,
      read: async () => {
        reading.resolve();
        await answer.promise;
        return { value: 1 };
      },
      soft: 600,
    });
    await reading.promise;

    expect(await since(before)).toEqual({});

    answer.resolve();
    await read;
    expect(await since(before)).toEqual({ 'profile miss': 1 });
  });

  it('counts no miss or warm when the read function fails, and counts the next fill once', async () => {
    const cache = new CacheService(client());
    const k = key();
    const before = await counts();

    await expect(
      cache.read({
        key: k,
        read: async () => {
          throw new Error('database gone');
        },
        soft: 600,
      }),
    ).rejects.toThrow('database gone');
    await expect(
      cache.warm(() =>
        cache.read({
          key: k,
          read: async () => {
            throw new Error('database gone');
          },
          soft: 600,
        }),
      ),
    ).rejects.toThrow('database gone');

    const failed = await since(before);
    expect(failed['profile miss']).toBeUndefined();
    expect(failed['profile warm']).toBeUndefined();
    expect(await other.exists(k, lockKey(k))).toBe(0);

    await expect(
      cache.read({ key: k, read: async () => ({ value: 3 }), soft: 600 }),
    ).resolves.toBe(3);
    expect(await since(before)).toMatchObject({ 'profile miss': 1 });
  });

  it.each([
    ['zero', 0],
    ['an empty string', ''],
    ['false', false],
  ])(
    'counts a fill answering %s once, and the next read is a hit',
    async (_name, value) => {
      const cache = new CacheService(client());
      const k = key();
      let calls = 0;
      const read = async () => {
        calls += 1;
        return { value };
      };
      const before = await counts();

      await expect(cache.read({ key: k, read, soft: 600 })).resolves.toBe(
        value,
      );
      await expect(cache.read({ key: k, read, soft: 600 })).resolves.toBe(
        value,
      );

      expect(calls).toBe(1);
      expect(await since(before)).toEqual({
        'profile hit': 1,
        'profile miss': 1,
      });
    },
  );

  it('counts a plain read as a miss while a warm of another key is in flight, and the warm as a warm', async () => {
    const cache = new CacheService(client());
    const [inside, outside] = [key(), key()];
    const reading = deferred();
    const answer = deferred();
    const before = await counts();

    const warming = cache.warm(() =>
      cache.read({
        key: inside,
        read: async () => {
          reading.resolve();
          await answer.promise;
          return { value: 1 };
        },
        soft: 600,
      }),
    );
    await reading.promise;
    await cache.read({
      key: outside,
      read: async () => ({ value: 2 }),
      soft: 600,
    });

    expect(await since(before)).toEqual({ 'profile miss': 1 });

    answer.resolve();
    await warming;
    expect(await since(before)).toEqual({
      'profile miss': 1,
      'profile warm': 1,
    });
  });

  it('counts a miss, not a warm, for a read after a warm that failed', async () => {
    const cache = new CacheService(client());
    const before = await counts();

    await expect(
      cache.warm(async () => {
        throw new Error('warm failed');
      }),
    ).rejects.toThrow('warm failed');
    await cache.read({
      key: key(),
      read: async () => ({ value: 1 }),
      soft: 600,
    });

    expect(await since(before)).toEqual({ 'profile miss': 1 });
  });
});

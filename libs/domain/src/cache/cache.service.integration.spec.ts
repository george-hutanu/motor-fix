import { randomUUID } from 'node:crypto';

import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { type Command, Redis } from 'ioredis';

import { CacheService, cacheKey, lockKey } from './cache.service';
import { requestContext } from '../logging';
import { redisUrlFor } from '../notifications/notifications.testing';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const redisUrl = redisUrlFor(2);
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, check: () => Promise<boolean> | boolean) {
  const deadline = performance.now() + 5000;
  while (!(await check())) {
    if (performance.now() > deadline)
      throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

// A read function that counts its calls and answers after `ms`.
function source(answer: unknown = { name: 'Service Auto' }, ms = 100) {
  const calls = { count: 0 };
  const read = async () => {
    calls.count += 1;
    await sleep(ms);
    return { tags: ['garage:a'], value: answer };
  };
  return { calls, read };
}

const key = () => cacheKey('profile', randomUUID(), '-');

// @traces 1182-FR-001 1182-FR-002 1182-FR-003 1182-FR-004 1182-FR-015 1182-FR-016
describe('the cache service', () => {
  it('stores a miss and answers the next read from Redis', async () => {
    const cache = new CacheService(client());
    const { calls, read } = source();
    const k = key();

    const outcomes = await counting(async () => {
      await cache.read({ key: k, read, soft: 600 });
      await expect(cache.read({ key: k, read, soft: 600 })).resolves.toEqual({
        name: 'Service Auto',
      });
    });

    expect(calls.count).toBe(1);
    expect(outcomes).toEqual({ 'profile hit': 1, 'profile miss': 1 });
  });

  it('keeps an entry until 10 minutes after its jittered soft expiry, then it is gone', async () => {
    const cache = new CacheService(client());
    const k = key();

    await cache.read({ key: k, read: source().read, soft: 600 });

    const ttl = await other.pttl(k);
    expect(ttl).toBeGreaterThan(540_000 + 590_000);
    expect(ttl).toBeLessThanOrEqual(660_000 + 600_000);
    expect(await other.zrange('v1:tag:garage:a', '0', '-1')).toContain(k);
  });

  it('serves a stale entry at once and refreshes it once behind the read', async () => {
    const cache = new CacheService(client());
    const k = key();
    let version = 1;
    let calls = 0;
    const read = async () => {
      calls += 1;
      await sleep(200);
      return { value: { version: version } };
    };
    await cache.read({ key: k, read, soft: 60 });
    version = 2;
    const later = Date.now() + 120_000;
    jest.spyOn(Date, 'now').mockImplementation(() => later);

    const outcomes = await counting(async () => {
      const started = performance.now();
      const [first, second] = await Promise.all([
        cache.read({ key: k, read, soft: 60 }),
        cache.read({ key: k, read, soft: 60 }),
      ]);
      expect(performance.now() - started).toBeLessThan(150);
      expect([first, second]).toEqual([{ version: 1 }, { version: 1 }]);
    });

    expect(outcomes).toEqual({ 'profile stale': 2 });
    await until('the refresh', async () =>
      String(await other.get(k)).includes('"version":2'),
    );
    expect(calls).toBe(2);
  });

  it('lets one stale refresh run across instances', async () => {
    const [a, b] = [new CacheService(client()), new CacheService(client())];
    const k = key();
    let calls = 0;
    const read = async () => {
      calls += 1;
      await sleep(200);
      return { value: calls };
    };
    await a.read({ key: k, read, soft: 60 });
    const later = Date.now() + 120_000;
    jest.spyOn(Date, 'now').mockImplementation(() => later);

    await Promise.all([
      a.read({ key: k, read, soft: 60 }),
      b.read({ key: k, read, soft: 60 }),
    ]);
    await until('the refresh', async () => (await other.get(k)) !== null);
    await sleep(400);

    expect(calls).toBe(2);
  });

  it('makes one read for 50 concurrent reads on one instance', async () => {
    const cache = new CacheService(client());
    const { calls, read } = source();
    const k = key();

    const outcomes = await counting(async () => {
      const answers = await Promise.all(
        Array.from({ length: 50 }, () =>
          cache.read({ key: k, read, soft: 600 }),
        ),
      );
      expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    });

    expect(calls.count).toBe(1);
    expect(outcomes).toEqual({ 'profile coalesced': 49, 'profile miss': 1 });
  });

  it('makes one read for 50 concurrent reads across two instances sharing Redis', async () => {
    const [a, b] = [new CacheService(client()), new CacheService(client())];
    const { calls, read } = source({ name: 'Service Auto' }, 300);
    const k = key();

    const outcomes = await counting(async () => {
      const answers = await Promise.all(
        Array.from({ length: 50 }, (_, n) =>
          (n % 2 === 0 ? a : b).read({ key: k, read, soft: 600 }),
        ),
      );
      expect(
        answers.every((x) => JSON.stringify(x) === '{"name":"Service Auto"}'),
      ).toBe(true);
    });

    expect(calls.count).toBe(1);
    expect(outcomes).toEqual({ 'profile coalesced': 49, 'profile miss': 1 });
  });

  it('reads itself once a dead holder’s lock has expired, within 3 seconds', async () => {
    const cache = new CacheService(client());
    const { calls, read } = source({ name: 'fresh' }, 10);
    const k = key();
    await other.set(lockKey(k), 'someone-gone', 'PX', 3000);

    const started = Date.now();
    await expect(cache.read({ key: k, read, soft: 600 })).resolves.toEqual({
      name: 'fresh',
    });

    expect(Date.now() - started).toBeLessThan(3600);
    expect(calls.count).toBe(1);
    expect(await other.exists(k)).toBe(1);
  }, 10_000);

  it('stores nothing and rejects every waiter alike when the read fails', async () => {
    const cache = new CacheService(client());
    const k = key();
    let calls = 0;
    const read = async () => {
      calls += 1;
      await sleep(50);
      throw new Error('database gone');
    };

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => cache.read({ key: k, read, soft: 600 })),
    );

    expect(calls).toBe(1);
    expect(results.map((r) => r.status)).toEqual(Array(5).fill('rejected'));
    expect(await other.exists(k, lockKey(k))).toBe(0);
  });

  it('remembers a not-found answer for 60 seconds without reading again', async () => {
    const cache = new CacheService(client());
    const k = key();
    let calls = 0;
    const read = async () => {
      calls += 1;
      return { negative: true, value: { refused: 404 } };
    };

    const outcomes = await counting(async () => {
      await cache.read({ key: k, read, soft: 600 });
      await expect(cache.read({ key: k, read, soft: 600 })).resolves.toEqual({
        refused: 404,
      });
    });

    expect(calls).toBe(1);
    expect(outcomes).toEqual({ 'profile miss': 1, 'profile negative': 1 });
    const ttl = await other.pttl(k);
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThanOrEqual(66_000);
  });

  it('hands the tags of the answer served to the request', async () => {
    const cache = new CacheService(client());
    const k = key();
    const read = async () => ({ tags: ['garage:x', 'search'], value: 1 });
    const store: { cacheTags?: string[] } = {};

    await requestContext.run(store, () =>
      cache.read({ key: k, read, soft: 60 }),
    );
    const again: { cacheTags?: string[] } = {};
    await requestContext.run(again, () =>
      cache.read({ key: k, read, soft: 60 }),
    );

    expect(store.cacheTags).toEqual(['garage:x', 'search']);
    expect(again.cacheTags).toEqual(['garage:x', 'search']);
  });

  it('counts a warm-up fill as warm, and nothing for an entry already there', async () => {
    const cache = new CacheService(client());
    const k = key();
    const { read } = source(1, 0);

    const outcomes = await counting(() =>
      cache.warm(async () => {
        await cache.read({ key: k, read, soft: 600 });
        await cache.read({ key: k, read, soft: 600 });
      }),
    );

    expect(outcomes).toEqual({ 'profile warm': 1 });
  });

  // @traces 1348-FR-006
  it('counts the miss exactly once when the store fails', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const evaluate = redis.eval.bind(redis);
    jest
      .spyOn(redis, 'eval')
      .mockImplementation((...args) =>
        String(args[0]).includes('ZADD')
          ? Promise.reject(new Error('READONLY'))
          : evaluate(...args),
      );

    const outcomes = await counting(() =>
      expect(
        cache.read({ key: key(), read: source(5, 0).read, soft: 600 }),
      ).resolves.toBe(5),
    );

    expect(outcomes).toEqual({ 'profile miss': 1 });
  });

  it('reads a value that is not one of its entries as a miss, and writes over it', async () => {
    const cache = new CacheService(client());
    const k = key();
    await other.set(k, 'not json', 'PX', 60_000);

    await expect(
      cache.read({ key: k, read: source('fresh', 0).read, soft: 600 }),
    ).resolves.toBe('fresh');

    expect(String(await other.get(k))).toContain('"v":"fresh"');
  });

  it('keeps a tag no larger than its live entries', async () => {
    const cache = new CacheService(client());
    const tag = `garage:${randomUUID()}`;
    const gone = key();
    await other.zadd(`v1:tag:${tag}`, Date.now() - 1000, gone);

    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ tags: [tag], value: 1 }),
      soft: 600,
    });

    expect(await other.zrange(`v1:tag:${tag}`, '0', '-1')).toEqual([k]);
  });

  it('names the answer’s tags on the request while Redis is down', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(redis, 'sendCommand').mockImplementation((command: Command) => {
      command.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
      return command.promise;
    });
    const store: { cacheTags?: string[] } = {};

    await requestContext.run(store, () =>
      cache.read({
        key: key(),
        read: async () => ({ tags: ['garage:x'], value: 1 }),
        soft: 60,
      }),
    );

    expect(store.cacheTags).toEqual(['garage:x']);
  });

  it('answers from the read while Redis is down, warning once and logging the recovery', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const send = redis.sendCommand.bind(redis);
    let down = true;
    const commands: string[] = [];
    jest
      .spyOn(redis, 'sendCommand')
      .mockImplementation((command: Command, ...rest) => {
        commands.push(command.name);
        if (!down) return send(command, ...rest);
        command.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
        return command.promise;
      });
    const { calls, read } = source(7, 0);
    const k = key();

    const outcomes = await counting(async () => {
      await expect(cache.read({ key: k, read, soft: 600 })).resolves.toBe(7);
      await expect(cache.read({ key: k, read, soft: 600 })).resolves.toBe(7);
    });

    expect(calls.count).toBe(2);
    expect(outcomes).toEqual({ 'profile fallback': 2 });
    expect(commands.filter((name) => name === 'eval')).toEqual([]);
    expect(
      warn.mock.calls.filter(([m]) => /cache unavailable/.test(String(m))),
    ).toHaveLength(1);

    down = false;
    await cache.read({ key: k, read, soft: 600 });
    expect(
      log.mock.calls.filter(([m]) => /cache available again/.test(String(m))),
    ).toHaveLength(1);
  });
});

const warmKey = () => cacheKey('driver-home', randomUUID(), 'cars');

const failing = (redis: Redis) =>
  jest.spyOn(redis, 'sendCommand').mockImplementation((command: Command) => {
    command.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
    return command.promise;
  });

async function warmReads() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find(
      (metric) => metric.descriptor.name === 'motorfix_cache_warm_read_seconds',
    );
  return Object.fromEntries(
    (found?.dataPoints ?? []).map((point) => [
      String(point.attributes['kind']),
      (point.value as { count: number }).count,
    ]),
  );
}

// @traces 1169-FR-001 1169-FR-010 1169-FR-011
describe('the cache service’s warm entries', () => {
  const warmed = (cache: CacheService, k: string, ms = 0, value: unknown = 1) =>
    cache.warm(() =>
      cache.read({
        key: k,
        read: async () => {
          await sleep(ms);
          return { tags: ['warm:account:a'], value };
        },
        soft: 90,
        stale: false,
      }),
    );

  it('leaves Redis at its jittered soft expiry, with no stale window', async () => {
    const cache = new CacheService(client());
    const k = warmKey();

    await warmed(cache, k);

    const ttl = await other.pttl(k);
    expect(ttl).toBeGreaterThan(80_000);
    expect(ttl).toBeLessThanOrEqual(99_000);
  });

  it('answers a warm entry to one take, then none', async () => {
    const cache = new CacheService(client());
    const k = warmKey();

    const outcomes = await counting(async () => {
      await warmed(cache, k, 0, { items: ['car'] });
      await expect(cache.take(k)).resolves.toEqual({ items: ['car'] });
      await expect(cache.take(k)).resolves.toBeUndefined();
    });

    expect(outcomes).toEqual({
      'driver-home hit': 1,
      'driver-home miss': 1,
      'driver-home warm': 1,
    });
    expect(await other.exists(k)).toBe(0);
  });

  it('gives the entry to only one of two takes at once, across instances', async () => {
    const [a, b] = [new CacheService(client()), new CacheService(client())];
    const k = warmKey();
    await warmed(a, k);

    const answers = await Promise.all([a.take(k), b.take(k)]);

    expect(answers.filter((answer) => answer !== undefined)).toEqual([1]);
  });

  it('waits for a warm of the key still in flight and counts a hit', async () => {
    const cache = new CacheService(client());
    const k = warmKey();

    const outcomes = await counting(async () => {
      const warming = warmed(cache, k, 200, 'warmed');
      await sleep(50);
      await expect(cache.take(k)).resolves.toBe('warmed');
      await warming;
    });

    expect(outcomes).toEqual({ 'driver-home hit': 1, 'driver-home warm': 1 });
    expect(await other.exists(k)).toBe(0);
  });

  it('counts a take past the soft expiry as a miss and answers nothing', async () => {
    const cache = new CacheService(client());
    const k = warmKey();
    await warmed(cache, k);
    const later = Date.now() + 100_000;
    jest.spyOn(Date, 'now').mockImplementation(() => later);

    const outcomes = await counting(async () => {
      await expect(cache.take(k)).resolves.toBeUndefined();
    });

    expect(outcomes).toEqual({ 'driver-home miss': 1 });
  });

  it('answers nothing and counts a fallback while Redis is down, and says it is unavailable', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(cache.available).toBe(true);
    failing(redis);

    const outcomes = await counting(async () => {
      await expect(cache.take(warmKey())).resolves.toBeUndefined();
    });

    expect(outcomes).toEqual({ 'driver-home fallback': 1 });
    expect(cache.available).toBe(false);
  });

  it('names no warm tag on the request the warm runs in, nor on a take', async () => {
    const cache = new CacheService(client());
    const k = warmKey();
    const store: { cacheTags?: string[] } = {};

    await requestContext.run(store, async () => {
      await warmed(cache, k);
      await cache.take(k);
    });

    expect(store.cacheTags).toBeUndefined();
  });

  it('records the time of each read it warms, by kind', async () => {
    const cache = new CacheService(client());
    const before = await warmReads();

    await warmed(cache, warmKey(), 20);
    await cache.read({ key: warmKey(), read: source(1, 0).read, soft: 90 });

    const after = await warmReads();
    expect((after['driver-home'] ?? 0) - (before['driver-home'] ?? 0)).toBe(1);
  });
});

import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { CacheService, cacheKey, lockKey, tagKey } from './cache.service';
import { purgeAudience, purgeTags } from './purge';
import { redisUrlFor } from '../notifications/notifications.testing';

const clients: Redis[] = [];
const client = () => {
  const redis = new Redis(redisUrlFor(5));
  clients.push(redis);
  return redis;
};
const other = client();

afterAll(() => {
  for (const redis of clients) redis.disconnect();
});

afterEach(() => jest.restoreAllMocks());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = () => cacheKey('profile', randomUUID(), '-');

// @traces 1182-FR-005
describe('a purge racing a read', () => {
  it('leaves nothing behind when the purge lands while the read function runs', async () => {
    const cache = new CacheService(client());
    const tag = `garage:${randomUUID()}`;
    const k = key();
    let version = 1;
    const read = async () => {
      const seen = version;
      await sleep(200);
      return { tags: [tag], value: seen };
    };

    const pending = cache.read({ key: k, read, soft: 600 });
    await sleep(60);
    version = 2;
    await purgeTags(client(), [tag]);
    await pending;

    expect(await other.exists(k)).toBe(0);
    await expect(cache.read({ key: k, read, soft: 600 })).resolves.toBe(2);
  });

  it('refuses the refresh of a stale entry when a purge lands during it', async () => {
    const cache = new CacheService(client());
    const tag = `garage:${randomUUID()}`;
    const k = key();
    let version = 1;
    const read = async () => {
      const seen = version;
      await sleep(200);
      return { tags: [tag], value: seen };
    };
    await cache.read({ key: k, read, soft: 60 });
    const later = Date.now() + 120_000;
    jest.spyOn(Date, 'now').mockImplementation(() => later);

    await cache.read({ key: k, read, soft: 60 });
    await sleep(60);
    version = 2;
    await purgeTags(client(), [tag]);
    await sleep(400);
    jest.restoreAllMocks();

    expect(await other.get(k)).toBeNull();
  });

  it('lets a read that starts after the purge store its answer', async () => {
    const cache = new CacheService(client());
    const tag = `garage:${randomUUID()}`;
    const k = key();
    await purgeTags(client(), [tag]);
    await sleep(5);

    await cache.read({
      key: k,
      read: async () => ({ tags: [tag], value: 'after' }),
      soft: 600,
    });

    expect(await other.exists(k)).toBe(1);
  });

  it('purges while 20 concurrent reads of one key are in flight without leaving an old answer', async () => {
    const cache = new CacheService(client());
    const tag = `garage:${randomUUID()}`;
    const k = key();
    let version = 1;
    const read = async () => {
      const seen = version;
      await sleep(150);
      return { tags: [tag], value: seen };
    };

    const reads = Array.from({ length: 20 }, () =>
      cache.read({ key: k, read, soft: 600 }),
    );
    await sleep(40);
    version = 2;
    await purgeTags(client(), [tag]);
    await Promise.all(reads);

    await expect(cache.read({ key: k, read, soft: 600 })).resolves.toBe(2);
  });
});

// @traces 1182-FR-003
describe('a read function that throws', () => {
  it('frees the lock at once so another instance reads instead of waiting out 3 seconds', async () => {
    const [a, b] = [new CacheService(client()), new CacheService(client())];
    const k = key();
    const failing = async () => {
      await sleep(150);
      throw new Error('database gone');
    };
    const working = async () => ({ value: 'b' });

    const firstResult = a
      .read({ key: k, read: failing, soft: 600 })
      .catch((error: Error) => error.message);
    await sleep(30);
    const started = Date.now();
    const second = await b.read({ key: k, read: working, soft: 600 });

    expect(await firstResult).toBe('database gone');
    expect(second).toBe('b');
    expect(Date.now() - started).toBeLessThan(1500);
    expect(await other.exists(lockKey(k))).toBe(0);
  }, 10_000);

  it('serves the stale entry and stays callable when the refresh fails', async () => {
    const cache = new CacheService(client());
    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ value: 'old' }),
      soft: 60,
    });
    const later = Date.now() + 120_000;
    jest.spyOn(Date, 'now').mockImplementation(() => later);
    const failing = jest.fn(async (): Promise<{ value: string }> => {
      throw new Error('boom');
    });

    await expect(cache.read({ key: k, read: failing, soft: 60 })).resolves.toBe(
      'old',
    );
    await sleep(100);
    await expect(cache.read({ key: k, read: failing, soft: 60 })).resolves.toBe(
      'old',
    );
    await sleep(100);

    expect(failing).toHaveBeenCalled();
    expect(await other.exists(lockKey(k))).toBe(0);
  });

  it('does not remember a rejection: the next read calls the function again', async () => {
    const cache = new CacheService(client());
    const k = key();
    await expect(
      cache.read({
        key: k,
        read: async (): Promise<{ value: string }> => {
          throw new Error('first');
        },
        soft: 60,
      }),
    ).rejects.toThrow('first');

    await expect(
      cache.read({ key: k, read: async () => ({ value: 'ok' }), soft: 60 }),
    ).resolves.toBe('ok');
  });

  it('rejects when the read function throws synchronously', async () => {
    const cache = new CacheService(client());
    const read = (() => {
      throw new Error('sync');
    }) as () => Promise<{ value: number }>;

    await expect(cache.read({ key: key(), read, soft: 60 })).rejects.toThrow(
      'sync',
    );
  });
});

// @traces 1182-FR-005
describe('tags with odd characters', () => {
  const odd = [
    'garage:a:b:c',
    'has space',
    'new\nline',
    'glob*[x]?',
    'ünïcode-ăîșț-🚗',
    '{curly}',
    'a'.repeat(5000),
    '%s %d',
  ];

  it.each(odd)('stores and purges an entry tagged %j', async (raw) => {
    const cache = new CacheService(client());
    const tag = `${raw}-${randomUUID()}`;
    const [k, bystander] = [key(), key()];
    await cache.read({
      key: k,
      read: async () => ({ tags: [tag], value: 1 }),
      soft: 600,
    });
    await cache.read({
      key: bystander,
      read: async () => ({ tags: ['unrelated'], value: 1 }),
      soft: 600,
    });

    const removed = await purgeTags(client(), [tag]);

    expect(removed).toEqual([k]);
    expect(await other.exists(k)).toBe(0);
    expect(await other.exists(bystander)).toBe(1);
    expect(await other.exists(tagKey(tag))).toBe(0);
  });

  it('does not treat a glob tag as a pattern over other tags', async () => {
    const cache = new CacheService(client());
    const id = randomUUID();
    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ tags: [`garage:${id}`], value: 1 }),
      soft: 600,
    });

    await purgeTags(client(), ['garage:*', '*']);

    expect(await other.exists(k)).toBe(1);
  });

  it('removes an entry listed under 3 tags when only the last is purged', async () => {
    const cache = new CacheService(client());
    const tags = [randomUUID(), randomUUID(), randomUUID()];
    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ tags, value: 1 }),
      soft: 600,
    });

    await purgeTags(client(), [tags[2] as string]);

    expect(await other.exists(k)).toBe(0);
  });

  it('accepts the same tag twice in one entry and in one purge', async () => {
    const cache = new CacheService(client());
    const tag = randomUUID();
    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ tags: [tag, tag], value: 1 }),
      soft: 600,
    });

    const removed = await purgeTags(client(), [tag, tag]);

    expect(removed).toEqual([k]);
  });
});

// @traces 1182-FR-001
describe('keys with colons', () => {
  it('keeps the cache key of ("a:b") apart from the key of ("a", "b")', () => {
    expect(cacheKey('profile', 'a:b', '-')).not.toBe(
      cacheKey('profile', 'a', 'b', '-'),
    );
  });

  it('stores and reads back an entry whose key parts contain colons, spaces and unicode', async () => {
    const cache = new CacheService(client());
    const k = cacheKey('profile', `x:y:${randomUUID()}`, 'mărci: ăîș 🚗');
    const read = jest.fn(async () => ({ value: { ok: true } }));

    await cache.read({ key: k, read, soft: 600 });
    await expect(cache.read({ key: k, read, soft: 600 })).resolves.toEqual({
      ok: true,
    });

    expect(read).toHaveBeenCalledTimes(1);
  });
});

// @traces 1182-FR-001 1182-FR-004
describe('values that roundtrip', () => {
  it.each([
    ['null', null],
    ['an empty object', {}],
    ['an empty array', []],
    ['zero', 0],
    ['an empty string', ''],
    ['false', false],
    ['unicode text', { name: 'Șoseaua Ștefan cel Mare 🚗 \u0000 "q"' }],
  ])(
    'answers %s from Redis the same as the read gave it',
    async (_n, value) => {
      const cache = new CacheService(client());
      const k = key();
      const read = jest.fn(async () => ({ value }));

      await cache.read({ key: k, read, soft: 600 });
      await expect(cache.read({ key: k, read, soft: 600 })).resolves.toEqual(
        value,
      );

      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  it('roundtrips a 5 MB value', async () => {
    const cache = new CacheService(client());
    const k = key();
    const value = { blob: 'é'.repeat(2_500_000) };
    const read = jest.fn(async () => ({ value }));

    await cache.read({ key: k, read, soft: 600 });
    const again = await cache.read({ key: k, read, soft: 600 });

    expect(again).toEqual(value);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('answers 1000 distinct keys independently', async () => {
    const cache = new CacheService(client());
    const ids = Array.from({ length: 1000 }, () => key());
    const answers = await Promise.all(
      ids.map((k, n) =>
        cache.read({ key: k, read: async () => ({ value: n }), soft: 600 }),
      ),
    );

    expect(answers).toEqual(ids.map((_k, n) => n));
  });
});

// @traces 1182-FR-004
describe('the negative cache', () => {
  it('is not removed by the purge of the tag of a garage created later under that slug', async () => {
    const cache = new CacheService(client());
    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ negative: true, value: 404 }),
      soft: 600,
    });

    const removed = await purgeTags(client(), ['garage:new']);

    expect(removed).not.toContain(k);
    expect(await other.pttl(k)).toBeLessThanOrEqual(66_000);
  });
});

// @traces 1182-FR-007
describe('many made-up brands on one profile', () => {
  it('fills one stored entry when every unknown brand answers under the no-brand key', async () => {
    const cache = new CacheService(client());
    const garage = randomUUID();
    const shared = cacheKey('profile', garage, '-');
    const read = async () => ({
      key: shared,
      tags: [`garage:${garage}`],
      value: { id: garage },
    });

    await Promise.all(
      Array.from({ length: 300 }, (_x, n) =>
        cache.read({
          key: cacheKey('profile', garage, `made-up-${n}`),
          read,
          soft: 600,
        }),
      ),
    );

    expect(await other.zcard(tagKey(`garage:${garage}`))).toBe(1);
    expect(await other.exists(shared)).toBe(1);
  });

  it('answers a made-up brand from the no-brand entry without reading again', async () => {
    const cache = new CacheService(client());
    const garage = randomUUID();
    const shared = cacheKey('profile', garage, '-');
    const read = jest.fn(async () => ({
      key: shared,
      tags: [`garage:${garage}`],
      value: 'plain',
    }));

    await cache.read({
      key: cacheKey('profile', garage, 'zzz'),
      read,
      soft: 60,
    });
    await cache.read({ key: shared, read, soft: 60 });

    expect(read).toHaveBeenCalledTimes(1);
  });
});

// @traces 1182-FR-015
describe('Redis failing', () => {
  const dead = () => {
    const redis = new Redis({
      enableOfflineQueue: false,
      host: '127.0.0.1',
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      port: 1,
      retryStrategy: () => null,
    });
    clients.push(redis);
    return redis;
  };

  it('answers from the read function when the server cannot be reached', async () => {
    const cache = new CacheService(dead());
    const read = jest.fn(async () => ({ value: 'db' }));

    await expect(cache.read({ key: key(), read, soft: 60 })).resolves.toBe(
      'db',
    );
    await expect(cache.read({ key: key(), read, soft: 60 })).resolves.toBe(
      'db',
    );

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('answers 50 concurrent reads of one key from the database during an outage without hanging', async () => {
    const cache = new CacheService(dead());
    const read = jest.fn(async () => ({ value: 'db' }));

    const answers = await Promise.all(
      Array.from({ length: 50 }, () =>
        cache.read({ key: 'v1:profile:k', read, soft: 60 }),
      ),
    );

    expect(answers).toEqual(Array(50).fill('db'));
  }, 10_000);

  it('serves the database answer, not the stored one, when Redis starts failing after an entry was stored', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ value: 'old' }),
      soft: 60,
    });
    jest.spyOn(redis, 'get').mockRejectedValue(new Error('ECONNRESET'));
    jest.spyOn(redis, 'eval').mockRejectedValue(new Error('ECONNRESET'));
    jest.spyOn(redis, 'set').mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      cache.read({ key: k, read: async () => ({ value: 'db' }), soft: 60 }),
    ).resolves.toBe('db');
  });

  it('rejects with the read function’s own error when Redis is down too', async () => {
    const cache = new CacheService(dead());

    await expect(
      cache.read({
        key: key(),
        read: async (): Promise<{ value: string }> => {
          throw new Error('database gone');
        },
        soft: 60,
      }),
    ).rejects.toThrow('database gone');
  });

  it('answers from the database when Redis fails between the lock and the store', async () => {
    const redis = client();
    const cache = new CacheService(redis);
    const read = async () => {
      jest.spyOn(redis, 'eval').mockRejectedValue(new Error('ECONNRESET'));
      return { tags: ['t'], value: 'db' };
    };

    await expect(cache.read({ key: key(), read, soft: 60 })).resolves.toBe(
      'db',
    );
  });
});

// @traces 1182-FR-005 1182-FR-006
describe('purge edge cases', () => {
  it('purges nothing for an empty tag list and calls no hook', async () => {
    const hook = jest.fn();

    await expect(purgeTags(client(), [], hook)).resolves.toEqual([]);

    expect(hook).not.toHaveBeenCalled();
  });

  it('answers an empty list for a tag no entry holds and still hands it to the hook', async () => {
    const hook = jest.fn();
    const tag = `garage:${randomUUID()}`;

    await expect(purgeTags(client(), [tag], hook)).resolves.toEqual([]);

    expect(hook).toHaveBeenCalledWith(tag);
  });

  it('twice in a row removes the keys once and the second answers empty', async () => {
    const cache = new CacheService(client());
    const tag = randomUUID();
    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ tags: [tag], value: 1 }),
      soft: 60,
    });

    expect(await purgeTags(client(), [tag])).toEqual([k]);
    expect(await purgeTags(client(), [tag])).toEqual([]);
  });

  it('succeeds and removes the entries when the hook throws', async () => {
    const cache = new CacheService(client());
    const tag = randomUUID();
    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ tags: [tag], value: 1 }),
      soft: 60,
    });
    const hook = jest.fn(async () => {
      throw new Error('cdn down');
    });

    await expect(purgeTags(client(), [tag], hook)).resolves.toEqual([k]);

    expect(await other.exists(k)).toBe(0);
  });

  it('still purges the later tags when the hook throws on the first', async () => {
    const cache = new CacheService(client());
    const [first, second] = [randomUUID(), randomUUID()];
    const k = key();
    await cache.read({
      key: k,
      read: async () => ({ tags: [second], value: 1 }),
      soft: 60,
    });
    const hook = jest.fn(() => {
      throw new Error('cdn down');
    });

    await purgeTags(client(), [first, second], hook);

    expect(await other.exists(k)).toBe(0);
  });

  it('throws when Redis refuses the purge', async () => {
    const redis = { eval: jest.fn().mockRejectedValue(new Error('READONLY')) };

    await expect(purgeTags(redis, ['a'])).rejects.toThrow('READONLY');
  });

  it('keeps a purged tag’s tombstone for longer than any entry lives', async () => {
    const tag = randomUUID();

    await purgeTags(client(), [tag]);

    const ttl = await other.pttl(`v1:purged:${tag}`);
    expect(ttl).toBeGreaterThan(1_200_000);
    expect(ttl).toBeLessThanOrEqual(1_300_000);
  });

  it('maps a public garage audience to its garage tag and the search tag', async () => {
    const cache = new CacheService(client());
    const id = randomUUID();
    const [profile, home] = [key(), cacheKey('home', randomUUID(), '-')];
    await cache.read({
      key: profile,
      read: async () => ({ tags: [`garage:${id}`], value: 1 }),
      soft: 60,
    });
    await cache.read({
      key: home,
      read: async () => ({ tags: ['search'], value: 1 }),
      soft: 60,
    });

    const removed = await purgeAudience(client(), [`public:garage:${id}`]);

    expect([...removed].sort()).toEqual([profile, home].sort());
  });

  it('purges nothing for audiences that are neither a public garage nor a search one', async () => {
    await expect(
      purgeAudience(client(), [
        'account:abc',
        'public:garage:',
        '',
        'driver:x',
      ]),
    ).resolves.toEqual([]);
  });

  it('purges every garage in an audience list holding several', async () => {
    const cache = new CacheService(client());
    const ids = [randomUUID(), randomUUID()];
    const keys = ids.map(() => key());
    await Promise.all(
      ids.map((id, n) =>
        cache.read({
          key: keys[n] as string,
          read: async () => ({ tags: [`garage:${id}`], value: n }),
          soft: 60,
        }),
      ),
    );

    const removed = await purgeAudience(
      client(),
      ids.map((id) => `public:garage:${id}`),
    );

    expect([...removed].sort()).toEqual([...keys].sort());
  });
});

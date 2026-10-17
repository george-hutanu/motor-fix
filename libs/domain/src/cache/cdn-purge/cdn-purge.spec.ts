// @traces 430-FR-003 430-FR-004 430-FR-010
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

import { CdnPurgeSender, cdnPurgeHook } from './cdn-purge';

const CDN_PURGE_KEY = 'cdn:purge';
const CONFIG = { apiKey: 'key-123', pullZoneId: '42' };

// A Redis set in memory: SPOP takes members in insertion order here, which
// Redis does not promise; the tests never rely on which ones come first.
function fakeRedis(initial: string[] = []) {
  const set = new Set(initial);
  return {
    sadd: jest.fn(async (_key: string, ...members: string[]) => {
      for (const m of members) set.add(m);
      return members.length;
    }),
    set,
    spop: jest.fn(async (_key: string, count: number) => {
      const taken = [...set].slice(0, count);
      for (const m of taken) set.delete(m);
      return taken;
    }),
  };
}

function fakeFetch(status = 204) {
  return jest.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(null, { status }),
  );
}

let add: jest.Mock;

beforeEach(() => {
  add = jest.fn();
  jest.spyOn(metrics, 'getMeter').mockReturnValue({
    createCounter: () => ({ add }),
  } as unknown as ReturnType<typeof metrics.getMeter>);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// Whether the hook puts the tag in the purge set.
async function queued(tag: string) {
  const redis = fakeRedis();
  await cdnPurgeHook(redis)(tag);
  return redis.set.has(tag);
}

describe('the tags the CDN takes', () => {
  it.each(['garage:g-1', 'garage:0b6f2c1e', 'search'])(
    'takes %s',
    async (tag) => {
      expect(await queued(tag)).toBe(true);
    },
  );

  it.each([
    'warm:account:a-1',
    'warm:garage:g-1',
    'account:a-1',
    'garage:',
    'garage:a:b',
    'searches',
    'search:dacia',
  ])('refuses %s', async (tag) => {
    expect(await queued(tag)).toBe(false);
  });
});

describe('cdnPurgeHook', () => {
  it('queues a page tag in the purge set', async () => {
    const redis = fakeRedis();

    await cdnPurgeHook(redis)('garage:g-1');
    await cdnPurgeHook(redis)('search');

    expect(redis.sadd).toHaveBeenCalledWith(CDN_PURGE_KEY, 'garage:g-1');
    expect([...redis.set]).toEqual(['garage:g-1', 'search']);
  });

  it('never queues a sign-in warm tag', async () => {
    const redis = fakeRedis();

    await cdnPurgeHook(redis)('warm:account:a-1');

    expect(redis.sadd).not.toHaveBeenCalled();
  });
});

describe('CdnPurgeSender', () => {
  it('sends each queued tag to the pull zone, with the key as a header', async () => {
    const redis = fakeRedis(['garage:g-1', 'search']);
    const send = fakeFetch();

    await new CdnPurgeSender(redis, CONFIG, send).tick();

    expect(send).toHaveBeenCalledTimes(2);
    const [url, init] = send.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.bunny.net/pullzone/42/purgeCache');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('AccessKey')).toBe('key-123');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const bodies = send.mock.calls.map(([, i]) => JSON.parse(String(i?.body)));
    expect(bodies).toEqual([
      { CacheTag: 'garage:g-1' },
      { CacheTag: 'search' },
    ]);
    expect(add).toHaveBeenCalledWith(1, { outcome: 'sent' });
    expect(redis.set.size).toBe(0);
  });

  it('takes at most ten tags a tick', async () => {
    const redis = fakeRedis(
      Array.from({ length: 13 }, (_, i) => `garage:g-${i}`),
    );
    const send = fakeFetch();

    await new CdnPurgeSender(redis, CONFIG, send).tick();

    expect(redis.spop).toHaveBeenCalledWith(CDN_PURGE_KEY, 10);
    expect(send).toHaveBeenCalledTimes(10);
    expect(redis.set.size).toBe(3);
  });

  it('puts back a tag the CDN refused, counts it and logs it without the key', async () => {
    const redis = fakeRedis(['garage:g-1']);
    const warn = jest.spyOn(Logger.prototype, 'warn');

    await new CdnPurgeSender(redis, CONFIG, fakeFetch(429)).tick();

    expect([...redis.set]).toEqual(['garage:g-1']);
    expect(add).toHaveBeenCalledWith(1, { outcome: 'failed' });
    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual(['cdn purge failed garage:g-1 status 429']);
    expect(lines.join('')).not.toContain('key-123');
  });

  it('puts back a tag whose call failed outright', async () => {
    const redis = fakeRedis(['search']);
    const send = jest.fn(async () => {
      throw new Error('timeout');
    });

    await new CdnPurgeSender(redis, CONFIG, send).tick();

    expect([...redis.set]).toEqual(['search']);
    expect(add).toHaveBeenCalledWith(1, { outcome: 'failed' });
  });

  it('keeps going when Redis is down, and sends nothing', async () => {
    const redis = fakeRedis();
    redis.spop.mockRejectedValue(new Error('down'));
    const send = fakeFetch();

    await expect(
      new CdnPurgeSender(redis, CONFIG, send).tick(),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('ticks every five seconds once started, and never two ticks at once', async () => {
    jest.useFakeTimers();
    const redis = fakeRedis(['search']);
    let release: () => void = () => undefined;
    const send = jest.fn(
      () =>
        new Promise<Response>((done) => {
          release = () => done(new Response(null, { status: 204 }));
        }),
    );
    const sender = new CdnPurgeSender(redis, CONFIG, send);

    sender.start();
    await jest.advanceTimersByTimeAsync(4_999);
    expect(redis.spop).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(redis.spop).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(redis.spop).toHaveBeenCalledTimes(1);

    release();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(redis.spop).toHaveBeenCalledTimes(2);
    await sender.stop();
  });

  it('stops ticking once stopped, after the tick in flight', async () => {
    jest.useFakeTimers();
    const redis = fakeRedis();
    const sender = new CdnPurgeSender(redis, CONFIG, fakeFetch());

    sender.start();
    await jest.advanceTimersByTimeAsync(5_000);
    await sender.stop();
    await jest.advanceTimersByTimeAsync(20_000);

    expect(redis.spop).toHaveBeenCalledTimes(1);
  });
});

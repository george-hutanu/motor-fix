// @traces 430-FR-003 430-FR-004 430-FR-010
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

import { CdnPurgeSender, cdnPurgeHook } from './cdn-purge';

const CONFIG = { apiKey: 'key-123', pullZoneId: '42' };

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

const answering = (...statuses: number[]) =>
  jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const status = statuses.shift() ?? 204;
    return new Response(null, { status });
  });

let add: jest.Mock;
let warn: jest.SpyInstance;

beforeEach(() => {
  add = jest.fn();
  jest.spyOn(metrics, 'getMeter').mockReturnValue({
    createCounter: () => ({ add }),
  } as unknown as ReturnType<typeof metrics.getMeter>);
  warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// Whether the hook puts the tag in the purge set.
async function queued(tag: string) {
  const redis = fakeRedis();
  await cdnPurgeHook(redis)(tag);
  return redis.sadd.mock.calls.length > 0;
}

describe('the tag check under hostile input', () => {
  it.each([
    'garage:g-1\n',
    'garage:\ng-1',
    'garage:g 1',
    'garage: ',
    'garage:\t',
    'garage:g\r\nX-Evil: 1',
    '',
    ' search',
    'search ',
    'search\n',
    'SEARCH',
    'Garage:g-1',
    'garage:g-1,garage:g-2',
    '*',
  ])('refuses %j', async (tag) => {
    expect(await queued(tag)).toBe(false);
  });

  it('keeps no state between calls', async () => {
    expect(await queued('search')).toBe(true);
    expect(await queued('search')).toBe(true);
  });
});

describe('cdnPurgeHook under hostile input', () => {
  it.each(['garage:g-1\n', 'garage:', 'warm:garage:g-1', 'search\n', ''])(
    'never queues %j',
    async (tag) => {
      const redis = fakeRedis();

      await cdnPurgeHook(redis)(tag);

      expect(redis.sadd).not.toHaveBeenCalled();
    },
  );

  it('queues one tag once however often it is handed over', async () => {
    const redis = fakeRedis();

    for (let i = 0; i < 50; i += 1) await cdnPurgeHook(redis)('search');

    expect([...redis.set]).toEqual(['search']);
  });
});

describe('CdnPurgeSender under hostile input', () => {
  it('does nothing for an empty queue', async () => {
    const send = answering();

    await new CdnPurgeSender(fakeRedis(), CONFIG, send).tick();

    expect(send).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('sends exactly ten tags in one tick and leaves none behind', async () => {
    const redis = fakeRedis(
      Array.from({ length: 10 }, (_, i) => `garage:${i}`),
    );
    const send = answering();

    await new CdnPurgeSender(redis, CONFIG, send).tick();

    expect(send).toHaveBeenCalledTimes(10);
    expect(redis.set.size).toBe(0);
  });

  it('drains a queue of 95 tags in ten ticks', async () => {
    const redis = fakeRedis(
      Array.from({ length: 95 }, (_, i) => `garage:${i}`),
    );
    const send = answering();
    const sender = new CdnPurgeSender(redis, CONFIG, send);

    for (let i = 0; i < 10; i += 1) await sender.tick();

    expect(send).toHaveBeenCalledTimes(95);
    expect(redis.set.size).toBe(0);
  });

  it('never sends a member of the queue that is not a page tag', async () => {
    const redis = fakeRedis(['warm:account:a-1', 'garage:g-1', 'junk', '']);
    const send = answering();

    await new CdnPurgeSender(redis, CONFIG, send).tick();

    const bodies = send.mock.calls.map(([, i]) => JSON.parse(String(i?.body)));
    expect(bodies).toEqual([{ CacheTag: 'garage:g-1' }]);
  });

  it('puts back only the tag that failed and still sends the rest', async () => {
    const redis = fakeRedis(['garage:a', 'garage:b', 'garage:c']);
    const send = answering(204, 500, 204);

    await new CdnPurgeSender(redis, CONFIG, send).tick();

    expect(send).toHaveBeenCalledTimes(3);
    expect([...redis.set]).toEqual(['garage:b']);
    expect(add).toHaveBeenCalledWith(1, { outcome: 'sent' });
    expect(add).toHaveBeenCalledWith(1, { outcome: 'failed' });
    expect(add).toHaveBeenCalledTimes(3);
  });

  it.each([200, 201, 204])('counts %i as sent', async (status) => {
    const redis = fakeRedis(['search']);

    await new CdnPurgeSender(redis, CONFIG, answering(status)).tick();

    expect(add).toHaveBeenCalledWith(1, { outcome: 'sent' });
    expect(redis.set.size).toBe(0);
  });

  it.each([400, 401, 404, 429, 500, 503])(
    'counts %i as failed and keeps the tag',
    async (status) => {
      const redis = fakeRedis(['search']);

      await new CdnPurgeSender(redis, CONFIG, answering(status)).tick();

      expect(add).toHaveBeenCalledWith(1, { outcome: 'failed' });
      expect([...redis.set]).toEqual(['search']);
    },
  );

  it('survives a failed put-back when Redis went away mid-batch', async () => {
    const redis = fakeRedis(['search']);
    redis.sadd.mockRejectedValue(new Error('down'));

    await expect(
      new CdnPurgeSender(redis, CONFIG, answering(500)).tick(),
    ).resolves.toBeUndefined();
  });

  it('never logs the key or the text of a failure that contains it', async () => {
    const redis = fakeRedis(['search']);
    const send = jest.fn(async () => {
      throw new Error('connect failed for AccessKey key-123');
    });

    await new CdnPurgeSender(redis, CONFIG, send).tick();

    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain(
      'key-123',
    );
    expect(add).toHaveBeenCalledWith(1, { outcome: 'failed' });
  });

  it('puts back a tag when the call throws something that is not an Error', async () => {
    const redis = fakeRedis(['search']);
    const send = jest.fn(async () => {
      throw 'boom';
    });

    await new CdnPurgeSender(redis, CONFIG, send).tick();

    expect([...redis.set]).toEqual(['search']);
  });

  it('puts the tag back under the key it took it from', async () => {
    const redis = fakeRedis();
    redis.set.add('search');

    await new CdnPurgeSender(redis, CONFIG, answering(500), 'other:key').tick();

    expect(redis.spop).toHaveBeenCalledWith('other:key', 10);
    expect(redis.sadd).toHaveBeenCalledWith('other:key', 'search');
  });

  it('sends the tag as data in a JSON body', async () => {
    const redis = fakeRedis(['garage:a"b\\c']);
    const send = answering();

    await new CdnPurgeSender(redis, CONFIG, send).tick();

    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toEqual({
      CacheTag: 'garage:a"b\\c',
    });
  });

  it('ticks once per five seconds when started twice', async () => {
    jest.useFakeTimers();
    const redis = fakeRedis();
    const sender = new CdnPurgeSender(redis, CONFIG, answering());

    sender.start();
    sender.start();
    await jest.advanceTimersByTimeAsync(5_000);
    await sender.stop();

    expect(redis.spop).toHaveBeenCalledTimes(1);
  });

  it('keeps ticking after a tick that found Redis down', async () => {
    jest.useFakeTimers();
    const redis = fakeRedis();
    redis.spop.mockRejectedValueOnce(new Error('down'));
    const sender = new CdnPurgeSender(redis, CONFIG, answering());

    sender.start();
    await jest.advanceTimersByTimeAsync(10_000);
    await sender.stop();

    expect(redis.spop).toHaveBeenCalledTimes(2);
  });

  it('waits for the send in flight when stopped', async () => {
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
    await jest.advanceTimersByTimeAsync(5_000);

    let stopped = false;
    const stopping = sender.stop().then(() => {
      stopped = true;
    });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('stops cleanly when it never started and when stopped twice', async () => {
    const sender = new CdnPurgeSender(fakeRedis(), CONFIG, answering());

    await expect(sender.stop()).resolves.toBeUndefined();
    await expect(sender.stop()).resolves.toBeUndefined();
  });

  it('ticks again after a stop and a start', async () => {
    jest.useFakeTimers();
    const redis = fakeRedis();
    const sender = new CdnPurgeSender(redis, CONFIG, answering());

    sender.start();
    await sender.stop();
    sender.start();
    await jest.advanceTimersByTimeAsync(5_000);
    await sender.stop();

    expect(redis.spop).toHaveBeenCalledTimes(1);
  });
});

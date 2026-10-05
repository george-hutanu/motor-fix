import { EventEmitter } from 'node:events';

import { LiveHub, publishLive } from './live.hub';

class Sink extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  failWrites = false;
  write(chunk: string) {
    if (this.failWrites) throw new Error('write after end');
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
  }
  events() {
    return this.chunks
      .filter((c) => c.startsWith('event:'))
      .map((c) => (c.split('\n')[0] ?? '').replace(/^event: /, ''));
  }
  pings() {
    return this.chunks.filter((c) => c.startsWith(':')).length;
  }
}

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const MINUTE = 60_000;
const SECOND = 1_000;

let hub: LiveHub;
let publish: jest.Mock;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  publish = jest.fn(async () => 1);
  hub = new LiveHub(async () => ({
    mechanics: new Map(),
    off: new Set(),
    owners: new Set(['g1']),
    receptionists: new Set(),
  }));
});

afterEach(() => {
  hub.shutdown();
  jest.useRealTimers();
});

const open = (
  accountId: string,
  channels: string[],
  expiresAt = NOW + 15 * MINUTE,
) => {
  const sink = new Sink();
  const id = hub.open(sink, {
    accountId,
    channels,
    expiresAt,
    garageId: channels.includes('garage:x') ? 'x' : null,
    role: channels.includes('garage:x') ? 'garage' : 'driver',
  });
  return { id, sink };
};

const good = {
  at: new Date(NOW).toISOString(),
  id: '7d8e5d4a-1f7a-4c0b-9a51-3a3b6a1c2d01',
  kind: 'live.test',
};

describe('LiveHub fan-out input', () => {
  it.each([
    ['an empty string', ''],
    ['not json', '{nope'],
    ['json null', 'null'],
    ['a json number', '7'],
    ['a json string', '"account:a1"'],
    ['a json array', '[]'],
    ['an empty object', '{}'],
    ['no audience', JSON.stringify({ event: good })],
    ['no event', JSON.stringify({ audience: ['account:a1'] })],
    ['a null event', JSON.stringify({ audience: ['account:a1'], event: null })],
    [
      'an audience that is a string',
      JSON.stringify({ audience: 'account:a1', event: good }),
    ],
    [
      'an audience that is an object',
      JSON.stringify({ audience: { 0: 'account:a1' }, event: good }),
    ],
    [
      'an audience of numbers',
      JSON.stringify({ audience: [1, null, {}], event: good }),
    ],
    [
      'an event with a numeric kind',
      JSON.stringify({ audience: ['account:a1'], event: { ...good, kind: 7 } }),
    ],
    [
      'an event with no id',
      JSON.stringify({
        audience: ['account:a1'],
        event: { at: good.at, kind: good.kind },
      }),
    ],
  ])('drops a message with %s and leaves every stream open', (_, raw) => {
    const { sink } = open('a1', ['account:a1', 'system']);

    expect(() => hub.deliver(raw)).not.toThrow();

    expect(sink.events()).toEqual(['hello']);
    expect(sink.ended).toBe(false);
  });

  it('still forwards a good message after a bad one', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.deliver('{nope');
    hub.deliver(JSON.stringify({ audience: ['account:a1'], event: good }));

    expect(sink.events()).toEqual(['hello', 'live.test']);
  });

  it('reaches nobody when the audience is empty', () => {
    const { sink } = open('a1', ['account:a1', 'system']);

    hub.deliver(JSON.stringify({ audience: [], event: good }));

    expect(sink.events()).toEqual(['hello']);
  });

  it('reaches nobody from a stream opened with no channels', () => {
    const { sink } = open('a1', []);

    hub.deliver(JSON.stringify({ audience: ['system', ''], event: good }));

    expect(sink.events()).toEqual(['hello']);
  });

  it('does not treat object prototype names as channels', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.deliver(
      JSON.stringify({
        audience: ['__proto__', 'constructor', 'toString', 'hasOwnProperty'],
        event: good,
      }),
    );

    expect(sink.events()).toEqual(['hello']);
  });

  it('matches channel keys exactly, not by prefix or case', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.deliver(
      JSON.stringify({
        audience: ['account:a10', 'account:a', 'ACCOUNT:A1', ' account:a1'],
        event: good,
      }),
    );

    expect(sink.events()).toEqual(['hello']);
  });

  it('sends once when the audience lists the same channel repeatedly', () => {
    const { sink } = open('a1', ['account:a1', 'system']);

    hub.deliver(
      JSON.stringify({
        audience: ['account:a1', 'account:a1', 'system', 'system'],
        event: good,
      }),
    );

    expect(sink.events()).toEqual(['hello', 'live.test']);
  });

  it('handles an audience of ten thousand channels', () => {
    const { sink } = open('a1', ['account:a1']);
    const audience = Array.from({ length: 10_000 }, (_, i) => `account:x${i}`);
    audience.push('account:a1');

    hub.deliver(JSON.stringify({ audience, event: good }));

    expect(sink.events()).toEqual(['hello', 'live.test']);
  });

  it('delivers once to each of a thousand streams across accounts', () => {
    const sinks = Array.from(
      { length: 1_000 },
      (_, i) => open(`a${i}`, [`account:a${i}`, 'system']).sink,
    );

    hub.deliver(JSON.stringify({ audience: ['system'], event: good }));

    for (const sink of sinks)
      expect(sink.events()).toEqual(['hello', 'live.test']);
  });

  it('cannot be made to inject a second event through a newline in the kind', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.deliver(
      JSON.stringify({
        audience: ['account:a1'],
        event: { ...good, kind: 'live.test\nevent: bye' },
      }),
    );

    for (const chunk of sink.chunks.slice(1)) {
      expect(chunk).toMatch(/^event: [^\n\r]+\ndata: [^\n\r]+\n\n$/);
    }
    expect(sink.events()).not.toContain('bye');
  });

  it('keeps newlines in the id inside the one data line', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.deliver(
      JSON.stringify({
        audience: ['account:a1'],
        event: { ...good, id: 'line1\nline2\r\n\r\nevent: bye' },
      }),
    );

    expect(sink.events()).not.toContain('bye');
    for (const chunk of sink.chunks.slice(1)) {
      expect(chunk).toMatch(/^event: [^\n\r]+\ndata: [^\n\r]+\n\n$/);
    }
  });

  it('writes only kind, id and time of an event, never other fields', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.deliver(
      JSON.stringify({
        audience: ['account:a1'],
        event: { ...good, email: 'andrei@example.com', phone: '+40700000000' },
      }),
    );

    const data = JSON.parse(
      (sink.chunks[1]?.split('\n')[1] ?? '').replace(/^data: /, ''),
    );
    expect(data).toEqual(good);
  });

  it('survives a stream whose write throws and still serves the others', () => {
    const broken = open('a1', ['system']);
    const healthy = open('b2', ['system']);
    broken.sink.failWrites = true;

    expect(() =>
      hub.deliver(JSON.stringify({ audience: ['system'], event: good })),
    ).not.toThrow();

    expect(healthy.sink.events()).toEqual(['hello', 'live.test']);
  });
});

describe('LiveHub lifetime', () => {
  it('ends a stream opened with an already expired token with bye expired', () => {
    const { sink } = open('a1', ['account:a1'], NOW - SECOND);

    jest.advanceTimersByTime(1);

    expect(sink.events().at(-1)).toBe('bye');
    expect(sink.chunks.at(-1)).toContain('"reason":"expired"');
    expect(sink.ended).toBe(true);
  });

  it('ends at the exact expiry instant', () => {
    const { sink } = open('a1', ['account:a1'], NOW + 10 * SECOND);

    jest.advanceTimersByTime(10 * SECOND);

    expect(sink.ended).toBe(true);
  });

  it('keeps the stream open one millisecond before expiry', () => {
    const { sink } = open('a1', ['account:a1'], NOW + 10 * SECOND);

    jest.advanceTimersByTime(10 * SECOND - 1);

    expect(sink.ended).toBe(false);
  });

  it('says bye as the last thing written and writes nothing after it', () => {
    const { sink } = open('a1', ['account:a1', 'system'], NOW + 30 * SECOND);

    jest.advanceTimersByTime(30 * SECOND);
    const written = sink.chunks.length;
    hub.deliver(JSON.stringify({ audience: ['system'], event: good }));
    jest.advanceTimersByTime(5 * MINUTE);

    expect(sink.chunks).toHaveLength(written);
    expect(sink.events().filter((e) => e === 'bye')).toHaveLength(1);
  });

  it('does not ping a stream that expires inside the heartbeat window', () => {
    const { sink } = open('a1', ['account:a1'], NOW + 24 * SECOND);

    jest.advanceTimersByTime(30 * SECOND);

    expect(sink.pings()).toBe(0);
  });

  it('pings every 25 seconds of silence', () => {
    const { sink } = open('a1', ['account:a1']);

    jest.advanceTimersByTime(24_999);
    expect(sink.pings()).toBe(0);
    jest.advanceTimersByTime(1);
    expect(sink.pings()).toBe(1);
    jest.advanceTimersByTime(50 * SECOND);
    expect(sink.pings()).toBe(3);
  });

  it('leaves no timers running after the stream closes', () => {
    const { sink } = open('a1', ['account:a1']);

    sink.emit('close');

    expect(jest.getTimerCount()).toBe(0);
  });

  it('leaves no timers running after shutdown', () => {
    open('a1', ['account:a1']);
    open('b2', ['account:b2']);

    hub.shutdown();

    expect(jest.getTimerCount()).toBe(0);
  });

  it('tolerates a close event emitted twice and after shutdown', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.shutdown();

    expect(() => {
      sink.emit('close');
      sink.emit('close');
    }).not.toThrow();
  });

  it('says shutdown only once when shutdown is called twice', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.shutdown();
    hub.shutdown();

    expect(sink.events().filter((e) => e === 'bye')).toHaveLength(1);
  });

  it('shuts down an empty hub', () => {
    expect(() => hub.shutdown()).not.toThrow();
  });
});

describe('LiveHub stream cap', () => {
  it('keeps all ten streams of an account open', () => {
    const streams = Array.from({ length: 10 }, () =>
      open('a1', ['account:a1']),
    );

    for (const { sink } of streams) expect(sink.ended).toBe(false);
  });

  it('evicts in opening order when streams open within the same millisecond', () => {
    const streams = Array.from({ length: 12 }, () =>
      open('a1', ['account:a1']),
    );

    expect(streams[0]?.sink.chunks.join('')).toContain('"reason":"evicted"');
    expect(streams[1]?.sink.chunks.join('')).toContain('"reason":"evicted"');
    for (const { sink } of streams.slice(2)) expect(sink.ended).toBe(false);
  });

  it('never holds more than ten streams of one account however many open', () => {
    const streams = Array.from({ length: 200 }, () =>
      open('a1', ['account:a1']),
    );

    hub.deliver(JSON.stringify({ audience: ['account:a1'], event: good }));

    const receiving = streams.filter(({ sink }) =>
      sink.events().includes('live.test'),
    );
    expect(receiving.map((s) => s.sink)).toEqual(
      streams.slice(-10).map((s) => s.sink),
    );
  });

  it('counts accounts separately', () => {
    const others = Array.from({ length: 10 }, () => open('b2', ['account:b2']));
    Array.from({ length: 10 }, () => open('a1', ['account:a1']));

    for (const { sink } of others) expect(sink.ended).toBe(false);
  });

  it('writes bye to an evicted stream once even if it then closes', () => {
    const streams = Array.from({ length: 11 }, () =>
      open('a1', ['account:a1']),
    );

    streams[0]?.sink.emit('close');

    expect(streams[0]?.sink.events().filter((e) => e === 'bye')).toHaveLength(
      1,
    );
  });

  it('gives every stream a different connection id', () => {
    const ids = new Set(
      Array.from({ length: 50 }, (_, i) => open(`a${i}`, []).id),
    );

    expect(ids.size).toBe(50);
  });
});

describe('publishing to the fan-out', () => {
  it('passes the audience list to the fan-out channel unchanged and in order', async () => {
    const audience = ['account:z', 'system', 'admin'];

    await publishLive({ publish }, good, audience);

    const [, message] = publish.mock.calls[0] as [string, string];
    expect(JSON.parse(message)).toEqual({ audience, event: good });
  });

  it('publishes once per call, so the same call twice is two messages', async () => {
    await publishLive({ publish }, good, ['system']);
    await publishLive({ publish }, good, ['system']);

    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('does not deliver to its own streams directly, only through the fan-out', async () => {
    const { sink } = open('a1', ['account:a1']);

    await publishLive({ publish }, good, ['account:a1']);

    expect(sink.events()).toEqual(['hello']);
  });

  it('rejects when the publisher fails with something other than an Error', async () => {
    publish.mockRejectedValueOnce('down');

    await expect(publishLive({ publish }, good, ['system'])).rejects.toBe(
      'down',
    );
  });
});

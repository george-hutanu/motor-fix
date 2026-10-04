import { EventEmitter } from 'node:events';

import { LIVE_CHANNEL, LiveHub } from './live.hub';

class Sink extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
  }
  messages() {
    return this.chunks
      .filter((c) => c.startsWith('event:'))
      .map((c) => {
        const [event, data] = c.split('\n');
        return {
          data: JSON.parse((data ?? '').replace(/^data: /, '')),
          event: (event ?? '').replace(/^event: /, ''),
        };
      });
  }
  pings() {
    return this.chunks.filter((c) => c.startsWith(':')).length;
  }
}

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const MINUTE = 60_000;

let publish: jest.Mock;
let hub: LiveHub;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  publish = jest.fn(async () => 1);
  hub = new LiveHub({ publish });
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
  const id = hub.open(sink, { accountId, channels, expiresAt });
  return { id, sink };
};

const fanOut = (audience: unknown, event: unknown = testEvent) =>
  hub.deliver(JSON.stringify({ audience, event }));

const testEvent = {
  at: new Date(NOW).toISOString(),
  id: '7d8e5d4a-1f7a-4c0b-9a51-3a3b6a1c2d01',
  kind: 'live.test',
};

describe('LiveHub', () => {
  it('greets a new stream with hello and its connection id', () => {
    const { id, sink } = open('a1', ['account:a1', 'system']);

    expect(sink.messages()).toEqual([
      {
        data: { at: new Date(NOW).toISOString(), id, kind: 'hello' },
        event: 'hello',
      },
    ]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes each message as an event line and one data line', () => {
    const { sink } = open('a1', ['account:a1']);

    fanOut(['account:a1']);

    expect(sink.chunks.at(-1)).toBe(
      `event: live.test\ndata: ${JSON.stringify(testEvent)}\n\n`,
    );
  });

  it('forwards an event only to the streams whose channels meet its audience', () => {
    const driver = open('a1', ['account:a1', 'system']);
    const garage = open('g1', ['account:g1', 'system', 'garage:x']);
    const admin = open('ad', ['account:ad', 'system', 'admin']);

    fanOut(['garage:x', 'admin']);

    expect(driver.sink.messages().map((m) => m.event)).toEqual(['hello']);
    expect(garage.sink.messages().map((m) => m.event)).toEqual([
      'hello',
      'live.test',
    ]);
    expect(admin.sink.messages().map((m) => m.event)).toEqual([
      'hello',
      'live.test',
    ]);
  });

  it('sends an event once to a stream that meets its audience on several channels', () => {
    const { sink } = open('g1', ['account:g1', 'system', 'garage:x']);

    fanOut(['account:g1', 'garage:x', 'system']);

    expect(sink.messages().filter((m) => m.event === 'live.test')).toHaveLength(
      1,
    );
  });

  it('reaches every open stream of one account', () => {
    const phone = open('a1', ['account:a1']);
    const laptop = open('a1', ['account:a1']);

    fanOut(['account:a1']);

    for (const { sink } of [phone, laptop]) {
      expect(sink.messages().at(-1)?.event).toBe('live.test');
    }
  });

  it.each([
    ['not JSON', '{nope'],
    ['no audience', JSON.stringify({ event: testEvent })],
    [
      'an audience that is not a list',
      JSON.stringify({ audience: 'system', event: testEvent }),
    ],
    ['no event', JSON.stringify({ audience: ['system'] })],
    [
      'an event without a kind',
      JSON.stringify({ audience: ['system'], event: { at: 'x', id: 'y' } }),
    ],
  ])('drops a fan-out message with %s and keeps the stream open', (_, raw) => {
    const { sink } = open('a1', ['account:a1', 'system']);

    expect(() => hub.deliver(raw)).not.toThrow();

    expect(sink.messages().map((m) => m.event)).toEqual(['hello']);
    expect(sink.ended).toBe(false);
  });

  it('sends a comment line after 25 seconds without an event', () => {
    const { sink } = open('a1', ['account:a1']);

    jest.advanceTimersByTime(24_999);
    expect(sink.pings()).toBe(0);

    jest.advanceTimersByTime(1);
    expect(sink.pings()).toBe(1);
    expect(sink.chunks.at(-1)).toMatch(/^:.*\n\n$/);
  });

  it('counts the 25 seconds from the last message sent', () => {
    const { sink } = open('a1', ['account:a1']);

    jest.advanceTimersByTime(20_000);
    fanOut(['account:a1']);
    jest.advanceTimersByTime(20_000);
    expect(sink.pings()).toBe(0);

    jest.advanceTimersByTime(5_000);
    expect(sink.pings()).toBe(1);
  });

  it('says bye with reason expired and ends the stream when its token expires', () => {
    const { id, sink } = open('a1', ['account:a1'], NOW + 15 * MINUTE);

    jest.advanceTimersByTime(15 * MINUTE - 1);
    expect(sink.ended).toBe(false);

    jest.advanceTimersByTime(1);
    expect(sink.messages().at(-1)).toEqual({
      data: {
        at: new Date(NOW + 15 * MINUTE).toISOString(),
        id,
        kind: 'bye',
        reason: 'expired',
      },
      event: 'bye',
    });
    expect(sink.ended).toBe(true);
  });

  it('closes the oldest stream of an account when an eleventh opens', () => {
    const streams = Array.from({ length: 10 }, (_, i) => {
      jest.advanceTimersByTime(i);
      return open('a1', ['account:a1']);
    });
    const other = open('b2', ['account:b2']);

    const eleventh = open('a1', ['account:a1']);

    const [oldest, ...rest] = streams;
    expect(oldest?.sink.messages().at(-1)).toMatchObject({
      data: { kind: 'bye', reason: 'evicted' },
    });
    expect(oldest?.sink.ended).toBe(true);
    for (const { sink } of [...rest, other, eleventh]) {
      expect(sink.ended).toBe(false);
    }

    fanOut(['account:a1']);
    expect(oldest?.sink.messages().at(-1)?.event).toBe('bye');
    expect(eleventh.sink.messages().at(-1)?.event).toBe('live.test');
  });

  it('releases a stream whose client went away', () => {
    const { sink } = open('a1', ['account:a1']);

    sink.emit('close');
    fanOut(['account:a1']);
    jest.advanceTimersByTime(15 * MINUTE);

    expect(sink.messages().map((m) => m.event)).toEqual(['hello']);
    expect(sink.pings()).toBe(0);
  });

  it('frees the slot of a stream that went away', () => {
    const first = open('a1', ['account:a1']);
    first.sink.emit('close');
    const streams = Array.from({ length: 10 }, () =>
      open('a1', ['account:a1']),
    );

    for (const { sink } of streams) expect(sink.ended).toBe(false);
  });

  it('says bye with reason shutdown to every stream when the copy shuts down', () => {
    const a = open('a1', ['account:a1']);
    const b = open('b2', ['account:b2']);

    hub.shutdown();

    for (const { sink } of [a, b]) {
      expect(sink.messages().at(-1)).toMatchObject({
        data: { kind: 'bye', reason: 'shutdown' },
      });
      expect(sink.ended).toBe(true);
    }
  });

  it('publishes an event with its audience on the one fan-out channel', async () => {
    await hub.publish(testEvent, ['account:a1']);

    expect(publish).toHaveBeenCalledWith(
      LIVE_CHANNEL,
      JSON.stringify({ audience: ['account:a1'], event: testEvent }),
    );
    expect(LIVE_CHANNEL).toBe('live:events');
  });

  it('lets a failed publish reach the caller', async () => {
    publish.mockRejectedValueOnce(new Error('Connection is closed.'));

    await expect(hub.publish(testEvent, ['account:a1'])).rejects.toThrow();
  });
});

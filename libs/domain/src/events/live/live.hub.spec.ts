import { EventEmitter } from 'node:events';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import type { Mock } from 'vitest';

import {
  LIVE_CHANNEL,
  LIVE_HEADERS,
  LiveHub,
  publishLive,
  RECONNECT_AFTER_MS,
} from './live.hub';
import type { ReplayRow } from './live.replay';

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

let publish: Mock;
let hub: LiveHub;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  publish = vi.fn(async () => 1);
  hub = new LiveHub(async () => ({
    mechanics: new Map(),
    off: new Set(),
    owners: new Set(['g1']),
    receptionists: new Set(),
  }));
});

afterEach(() => {
  hub.shutdown();
  vi.useRealTimers();
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

  it('forwards an event only to the streams whose channels meet its audience', async () => {
    const driver = open('a1', ['account:a1', 'system']);
    const garage = open('g1', ['account:g1', 'system', 'garage:x']);
    const admin = open('ad', ['account:ad', 'system', 'admin']);

    await fanOut(['garage:x', 'admin']);

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

    vi.advanceTimersByTime(24_999);
    expect(sink.pings()).toBe(0);

    vi.advanceTimersByTime(1);
    expect(sink.pings()).toBe(1);
    expect(sink.chunks.at(-1)).toMatch(/^:.*\n\n$/);
  });

  it('counts the 25 seconds from the last message sent', () => {
    const { sink } = open('a1', ['account:a1']);

    vi.advanceTimersByTime(20_000);
    fanOut(['account:a1']);
    vi.advanceTimersByTime(20_000);
    expect(sink.pings()).toBe(0);

    vi.advanceTimersByTime(5_000);
    expect(sink.pings()).toBe(1);
  });

  it('says bye with reason expired and ends the stream when its token expires', () => {
    const { id, sink } = open('a1', ['account:a1'], NOW + 15 * MINUTE);

    vi.advanceTimersByTime(15 * MINUTE - 1);
    expect(sink.ended).toBe(false);

    vi.advanceTimersByTime(1);
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
      vi.advanceTimersByTime(i);
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
    vi.advanceTimersByTime(15 * MINUTE);

    expect(sink.messages().map((m) => m.event)).toEqual(['hello']);
    expect(sink.pings()).toBe(0);
  });

  it('keeps no stream whose client left before it opened', () => {
    const gone = Object.assign(new Sink(), { destroyed: true });

    hub.open(gone, {
      accountId: 'a1',
      channels: ['account:a1'],
      expiresAt: NOW + 15 * MINUTE,
      garageId: null,
      role: 'driver',
    });
    const streams = Array.from({ length: 10 }, () =>
      open('a1', ['account:a1']),
    );
    vi.advanceTimersByTime(25_000);

    expect(gone.chunks).toEqual([]);
    for (const { sink } of streams) expect(sink.ended).toBe(false);
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
    await publishLive({ publish }, testEvent, ['account:a1']);

    expect(publish).toHaveBeenCalledWith(
      LIVE_CHANNEL,
      JSON.stringify({ audience: ['account:a1'], event: testEvent }),
    );
    expect(LIVE_CHANNEL).toBe('live:events');
  });

  it('lets a failed publish reach the caller', async () => {
    publish.mockRejectedValueOnce(new Error('Connection is closed.'));

    await expect(
      publishLive({ publish }, testEvent, ['account:a1']),
    ).rejects.toThrow();
  });
});

// @traces 430-FR-006
describe('the headers a live stream opens with', () => {
  it('ask every proxy and edge to pass it through unbuffered and untouched', () => {
    expect(LIVE_HEADERS).toEqual({
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
  });
});

// Every frame written, in order: its id line when it has one, its kind and
// its data. Comment lines and the retry line are left out.
const frames = (sink: Sink) =>
  sink.chunks
    .filter((c) => !c.startsWith(':') && !c.startsWith('retry:'))
    .map((chunk) => {
      const lines = Object.fromEntries(
        chunk
          .trim()
          .split('\n')
          .map((line) => {
            const at = line.indexOf(': ');
            return [line.slice(0, at), line.slice(at + 2)];
          }),
      );
      return {
        data: JSON.parse(lines['data'] ?? 'null'),
        event: lines['event'],
        id: lines['id'] as string | undefined,
      };
    });

const row = (position: number): ReplayRow => ({
  createdAt: new Date(NOW - (100 - position) * 1000),
  id: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
  position: BigInt(position),
});

const created = (position: number | string | undefined, unreadCount = 4) =>
  JSON.stringify({
    audience: ['account:a1'],
    event: {
      at: new Date(NOW).toISOString(),
      id: `live-${position}`,
      kind: 'notification.created',
      unreadCount,
    },
    ...(position !== undefined && { position: String(position) }),
  });

// Taken before any test fakes the timers.
const realSetImmediate = globalThis.setImmediate;
const flush = () => new Promise((resolve) => realSetImmediate(resolve));

function replaying(
  replay: (
    accountId: string,
    since: bigint,
  ) => Promise<{ rows: ReplayRow[]; unreadCount: number }>,
  reconnectAfterMs?: number,
) {
  const replayHub = new LiveHub(
    async () => ({
      mechanics: new Map(),
      off: new Set(),
      owners: new Set(),
      receptionists: new Set(),
    }),
    { reconnectAfterMs, replay },
  );
  const start = (since: bigint | null, expiresAt = NOW + 15 * MINUTE) => {
    const sink = new Sink();
    const id = replayHub.open(sink, {
      accountId: 'a1',
      channels: ['account:a1', 'system'],
      expiresAt,
      garageId: null,
      role: 'driver',
      since,
    });
    return { id, sink };
  };
  return { hub: replayHub, start };
}

// @traces 1190-FR-002
describe('the position a notification frame carries', () => {
  it('writes the position as the id line of a notification.created frame, with its count', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.deliver(created(42, 3));

    expect(sink.chunks.at(-1)).toBe(
      `id: 42\nevent: notification.created\ndata: ${JSON.stringify({
        at: new Date(NOW).toISOString(),
        id: 'live-42',
        kind: 'notification.created',
        unreadCount: 3,
      })}\n\n`,
    );
  });

  it('gives no other kind an id line, and the count only to a read', () => {
    const { sink } = open('a1', ['account:a1']);
    const envelope = (kind: string) =>
      JSON.stringify({
        audience: ['account:a1'],
        event: {
          at: new Date(NOW).toISOString(),
          id: 'x',
          kind,
          unreadCount: 2,
        },
        position: '9',
      });

    hub.deliver(envelope('notification.read'));
    hub.deliver(envelope('live.test'));

    expect(frames(sink).slice(1)).toEqual([
      {
        data: {
          at: new Date(NOW).toISOString(),
          id: 'x',
          kind: 'notification.read',
          unreadCount: 2,
        },
        event: 'notification.read',
        id: undefined,
      },
      {
        data: { at: new Date(NOW).toISOString(), id: 'x', kind: 'live.test' },
        event: 'live.test',
        id: undefined,
      },
    ]);
  });

  it.each([
    ['no position', undefined],
    ['a position that is not a number', 'abc'],
    ['a negative position', '-4'],
    ['a position with a line break', '4\nevent: bye'],
    ['a position past 18 digits', '1234567890123456789'],
  ])('writes no id line for %s', (_, position) => {
    const { sink } = open('a1', ['account:a1']);

    hub.deliver(created(position));

    expect(frames(sink).at(-1)).toMatchObject({
      event: 'notification.created',
      id: undefined,
    });
  });

  it('drops a count that is not a whole number at or above zero', () => {
    const { sink } = open('a1', ['account:a1']);

    hub.deliver(created(5, -1));
    hub.deliver(created(6, 1.5));

    for (const frame of frames(sink).slice(1)) {
      expect(frame.data).not.toHaveProperty('unreadCount');
    }
  });

  it('publishes the position with the event when one is given', async () => {
    const event = {
      ...testEvent,
      kind: 'notification.created',
      unreadCount: 1,
    };

    await publishLive({ publish }, event, ['account:a1'], 12n);

    expect(publish).toHaveBeenCalledWith(
      LIVE_CHANNEL,
      JSON.stringify({ audience: ['account:a1'], event, position: '12' }),
    );
  });
});

// @traces 1190-FR-003
// @traces 1190-FR-004
describe('replaying what a returning stream missed', () => {
  it('writes the missed rows oldest first, each with its position and the count read once', async () => {
    const replay = vi.fn(async () => ({
      rows: [row(5), row(6), row(7)],
      unreadCount: 3,
    }));
    const { start } = replaying(replay);

    const { sink } = start(4n);
    await flush();

    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith('a1', 4n);
    expect(frames(sink).slice(1)).toEqual(
      [5, 6, 7].map((p) => ({
        data: {
          at: row(p).createdAt.toISOString(),
          id: row(p).id,
          kind: 'notification.created',
          unreadCount: 3,
        },
        event: 'notification.created',
        id: String(p),
      })),
    );
  });

  it('reads nothing back for a first stream', async () => {
    const replay = vi.fn(async () => ({ rows: [row(1)], unreadCount: 1 }));
    const { start } = replaying(replay);

    const { sink } = start(null);
    await flush();

    expect(replay).not.toHaveBeenCalled();
    expect(frames(sink).map((f) => f.event)).toEqual(['hello']);
  });

  it('holds live events until the replay is written, then drops a notification it already replayed', async () => {
    let answer: (value: { rows: ReplayRow[]; unreadCount: number }) => void =
      () => undefined;
    const { start, hub: replayHub } = replaying(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { sink } = start(4n);

    await replayHub.deliver(created(8, 3));
    await replayHub.deliver(
      JSON.stringify({ audience: ['system'], event: testEvent }),
    );
    await replayHub.deliver(created(6, 2));
    expect(frames(sink).map((f) => f.event)).toEqual(['hello']);

    answer({ rows: [row(5), row(6)], unreadCount: 2 });
    await flush();

    expect(
      frames(sink)
        .slice(1)
        .map((f) => [f.event, f.id]),
    ).toEqual([
      ['notification.created', '5'],
      ['notification.created', '6'],
      ['notification.created', '8'],
      ['live.test', undefined],
    ]);
  });

  it('drops a notification announced late that the replay already wrote', async () => {
    const { start, hub: replayHub } = replaying(async () => ({
      rows: [row(5), row(6)],
      unreadCount: 2,
    }));
    const { sink } = start(4n);
    await flush();

    await replayHub.deliver(created(6));
    await replayHub.deliver(created(7));

    expect(
      frames(sink)
        .slice(1)
        .map((f) => f.id),
    ).toEqual(['5', '6', '7']);
  });

  it('goes live with what it held when the replay read fails, warning once', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    let fail: (error: Error) => void = () => undefined;
    const { start, hub: replayHub } = replaying(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const { sink } = start(4n);
    await replayHub.deliver(created(9));

    fail(new Error('database is down'));
    await flush();

    expect(
      frames(sink)
        .slice(1)
        .map((f) => f.id),
    ).toEqual(['9']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sink.ended).toBe(false);
    warn.mockRestore();
  });

  it('writes nothing to a stream that closed while its replay was read', async () => {
    let answer: (value: { rows: ReplayRow[]; unreadCount: number }) => void =
      () => undefined;
    const { start } = replaying(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { sink } = start(4n);

    sink.emit('close');
    answer({ rows: [row(5)], unreadCount: 1 });
    await flush();

    expect(frames(sink).map((f) => f.event)).toEqual(['hello']);
  });
});

// @traces 1190-FR-006
describe('the limits a stream lives within', () => {
  it('tells a signed-in client to wait three seconds before it reconnects, before hello', () => {
    const { sink } = open('a1', ['account:a1']);

    expect(sink.chunks[0]).toBe('retry: 3000\n\n');
    expect(frames(sink)[0]?.event).toBe('hello');
  });

  it('gives a visitor stream no retry line', () => {
    const sink = new Sink();
    hub.open(sink, {
      address: '10.0.0.1',
      channels: ['public:search'],
      public: true,
    });

    expect(sink.chunks.some((c) => c.startsWith('retry:'))).toBe(false);
  });

  it('asks the client to reconnect and ends the stream after the planned time', () => {
    const { start } = replaying(
      async () => ({ rows: [], unreadCount: 0 }),
      14 * MINUTE,
    );
    const { id, sink } = start(null, NOW + 30 * MINUTE);

    vi.advanceTimersByTime(14 * MINUTE - 1);
    expect(sink.ended).toBe(false);

    vi.advanceTimersByTime(1);
    expect(frames(sink).at(-1)).toEqual({
      data: {
        at: new Date(NOW + 14 * MINUTE).toISOString(),
        id,
        kind: 'reconnect',
      },
      event: 'reconnect',
      id: undefined,
    });
    expect(sink.ended).toBe(true);
  });

  it('plans the reconnect a minute before the 15 minutes a stream may stay open', () => {
    expect(RECONNECT_AFTER_MS).toBe(14 * MINUTE);
  });

  it('lets an earlier token expiry close the stream first', () => {
    const { start } = replaying(
      async () => ({ rows: [], unreadCount: 0 }),
      14 * MINUTE,
    );
    const { sink } = start(null, NOW + 5 * MINUTE);

    vi.advanceTimersByTime(14 * MINUTE);

    expect(frames(sink).filter((f) => f.event === 'reconnect')).toEqual([]);
    expect(frames(sink).at(-1)?.data).toMatchObject({
      kind: 'bye',
      reason: 'expired',
    });
  });
});

// @traces 1190-FR-014
describe('the live stream counts', () => {
  const reader = countedMetrics();
  const replays = (outcome: string) =>
    counterTotal(reader, 'motorfix_live_replays_total', { outcome });
  const replayed = () =>
    counterTotal(reader, 'motorfix_live_replayed_rows_total', {});
  const closes = (reason: string) =>
    counterTotal(reader, 'motorfix_live_stream_closes_total', { reason });

  it('counts each replay by what it found, and the rows it wrote', async () => {
    const before = {
      capped: await replays('capped'),
      none: await replays('none'),
      rows: await replayed(),
      some: await replays('some'),
    };
    const sizes = [0, 2, 200];
    const { start } = replaying(async () => {
      const size = sizes.shift() ?? 0;
      return {
        rows: Array.from({ length: size }, (_, i) => row(i + 1)),
        unreadCount: size,
      };
    });

    for (let i = 0; i < 3; i++) start(1n);
    await flush();

    expect(await replays('none')).toBe(before.none + 1);
    expect(await replays('some')).toBe(before.some + 1);
    expect(await replays('capped')).toBe(before.capped + 1);
    expect(await replayed()).toBe(before.rows + 202);
  });

  it('counts each close the server makes by its reason', async () => {
    const before = {
      expired: await closes('expired'),
      reconnect: await closes('reconnect'),
      shutdown: await closes('shutdown'),
    };
    const { start, hub: replayHub } = replaying(
      async () => ({ rows: [], unreadCount: 0 }),
      14 * MINUTE,
    );
    start(null, NOW + 30 * MINUTE);
    start(null, NOW + 5 * MINUTE);
    start(null, NOW + 30 * MINUTE);

    vi.advanceTimersByTime(5 * MINUTE);
    replayHub.shutdown();

    expect(await closes('expired')).toBe(before.expired + 1);
    expect(await closes('shutdown')).toBe(before.shutdown + 2);
    expect(await closes('reconnect')).toBe(before.reconnect);
  });
});

// @traces 056-FR-010
describe('the mechanic card events', () => {
  let load: Mock;
  let team: LiveHub;

  beforeEach(() => {
    load = vi.fn(async () => ({
      mechanics: new Map(),
      off: new Set(),
      owners: new Set(['ion']),
      receptionists: new Set(['maria']),
    }));
    team = new LiveHub(load);
  });

  afterEach(() => team.shutdown());

  const staff = (accountId: string, role: 'garage' | 'receptionist') => {
    const sink = new Sink();
    team.open(sink, {
      accountId,
      channels: [`account:${accountId}`, 'garage:g1'],
      expiresAt: NOW + 15 * MINUTE,
      garageId: 'g1',
      role,
    });
    return sink;
  };

  const visitor = (channels: string[]) => {
    const sink = new Sink();
    team.open(sink, { address: '10.0.0.9', channels, public: true });
    return sink;
  };

  const send = (audience: string[], kind: string, id = 'e1') =>
    team.deliver(
      JSON.stringify({
        audience,
        event: { at: new Date(NOW).toISOString(), id, kind },
      }),
    );

  const kinds = (sink: Sink) =>
    sink
      .messages()
      .map((m) => m.event)
      .filter((kind) => kind !== 'hello');

  it('reads the garage access again at once after a card is removed', async () => {
    staff('ion', 'garage');
    await send(['garage:g1'], 'request.created');
    expect(load).toHaveBeenCalledTimes(1);

    await send(['garage:g1'], 'mechanic.removed', 'e2');
    await send(['garage:g1'], 'request.updated', 'e3');

    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each(['mechanic.added', 'mechanic.removed'])(
    'gives %s to the owner by the team capability, never to a receptionist',
    async (kind) => {
      const owner = staff('ion', 'garage');
      const receptionist = staff('maria', 'receptionist');

      await send(['garage:g1'], kind);

      expect(kinds(owner)).toEqual([kind]);
      expect(kinds(receptionist)).toEqual([]);
    },
  );

  it.each(['mechanic.added', 'mechanic.removed'])(
    "lets the garage's and the mechanic's public pages hear %s",
    async (kind) => {
      const page = visitor(['public:garage:g1']);
      const profile = visitor(['public:mechanic:m1']);

      await send(['garage:g1', 'public:garage:g1'], kind);
      await send(['garage:g1', 'public:mechanic:m1'], kind, 'e2');

      expect(kinds(page)).toEqual([kind]);
      expect(kinds(profile)).toEqual([kind]);
    },
  );
});

// @traces 427-FR-010
describe('the time block events', () => {
  const KINDS = [
    'time_block.created',
    'time_block.updated',
    'time_block.deleted',
  ];
  let team: LiveHub;

  beforeEach(() => {
    team = new LiveHub(async () => ({
      mechanics: new Map([
        [
          'mihai',
          {
            canAnswerQuotes: false,
            canMoveBookings: false,
            canRecordFinalPrice: false,
          },
        ],
      ]),
      off: new Set(),
      owners: new Set(['ion']),
      receptionists: new Set(['maria']),
    }));
  });

  afterEach(() => team.shutdown());

  const staff = (
    accountId: string,
    role: 'garage' | 'receptionist' | 'mechanic',
    channels: string[] = [],
  ) => {
    const sink = new Sink();
    team.open(sink, {
      accountId,
      channels: [`account:${accountId}`, 'garage:g1', ...channels],
      expiresAt: NOW + 15 * MINUTE,
      garageId: 'g1',
      role,
    });
    return sink;
  };
  const kinds = (sink: Sink) =>
    sink
      .messages()
      .map((m) => m.event)
      .filter((kind) => kind !== 'hello');
  const send = (audience: string[], kind: string) =>
    team.deliver(
      JSON.stringify({
        audience,
        event: { at: new Date(NOW).toISOString(), id: kind, kind },
      }),
    );

  it.each(KINDS)(
    'gives %s to the owner, a receptionist and the mechanic on her channel',
    async (kind) => {
      const owner = staff('ion', 'garage');
      const desk = staff('maria', 'receptionist');
      const mihai = staff('mihai', 'mechanic', ['mechanic:m1']);

      await send(['garage:g1', 'mechanic:m1', 'public:garage:g1'], kind);

      expect(kinds(owner)).toEqual([kind]);
      expect(kinds(desk)).toEqual([kind]);
      expect(kinds(mihai)).toEqual([kind]);
    },
  );

  it.each(KINDS)("lets the garage's public page hear %s", async (kind) => {
    const page = new Sink();
    team.open(page, {
      address: '10.0.0.9',
      channels: ['public:garage:g1'],
      public: true,
    });

    await send(['garage:g1', 'public:garage:g1'], kind);

    expect(kinds(page)).toEqual([kind]);
  });
});

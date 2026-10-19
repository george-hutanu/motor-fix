import { EventEmitter } from 'node:events';

import { LiveHub } from './live.hub';
import type { ReplayRow } from './live.replay';

class Sink extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  destroyed = false;
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
  }
}

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const MINUTE = 60_000;

type Found = { rows: ReplayRow[]; unreadCount: number };

const row = (position: number): ReplayRow => ({
  createdAt: new Date(NOW - (1000 - position) * 1000),
  id: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
  position: BigInt(position),
});

const rows = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => row(from + i));

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
        event: lines['event'] as string,
        id: lines['id'] as string | undefined,
      };
    });

const live = (
  kind: string,
  position?: unknown,
  extra: Record<string, unknown> = {},
  audience = ['account:a1'],
) =>
  JSON.stringify({
    audience,
    event: {
      at: new Date(NOW).toISOString(),
      id: `e-${String(position)}`,
      kind,
      ...extra,
    },
    ...(position !== undefined && { position }),
  });

const flush = () =>
  new Promise((resolve) =>
    jest.requireActual('node:timers').setImmediate(resolve),
  );

function build(
  replay?: (a: string, s: bigint) => Promise<Found>,
  reconnectAfterMs?: number,
) {
  const hub = new LiveHub(
    async () => ({
      mechanics: new Map(),
      off: new Set(),
      owners: new Set(),
      receptionists: new Set(),
    }),
    { reconnectAfterMs, replay },
  );
  const start = (since: bigint | null | undefined, accountId = 'a1') => {
    const sink = new Sink();
    const id = hub.open(sink, {
      accountId,
      channels: [`account:${accountId}`, 'system'],
      expiresAt: NOW + 15 * MINUTE,
      garageId: null,
      role: 'driver',
      since,
    });
    return { id, sink };
  };
  return { hub, start };
}

let hubs: LiveHub[] = [];
const make = (...args: Parameters<typeof build>) => {
  const built = build(...args);
  hubs.push(built.hub);
  return built;
};

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => {
  for (const hub of hubs) hub.shutdown();
  hubs = [];
  jest.useRealTimers();
});

// @traces 1190-FR-003
describe('replay: empty, one and many', () => {
  it('writes nothing after hello for an empty replay and goes on live', async () => {
    const { hub, start } = make(async () => ({ rows: [], unreadCount: 0 }));
    const { sink } = start(5n);
    await flush();

    await hub.deliver(live('notification.created', '6', { unreadCount: 1 }));

    expect(frames(sink).map((f) => [f.event, f.id])).toEqual([
      ['hello', undefined],
      ['notification.created', '6'],
    ]);
  });

  it('replays a single row', async () => {
    const { start } = make(async () => ({ rows: [row(9)], unreadCount: 2 }));
    const { sink } = start(8n);
    await flush();

    expect(frames(sink).map((f) => f.id)).toEqual([undefined, '9']);
  });

  it('writes exactly the rows a full page returns, in order, each once', async () => {
    const { start } = make(async () => ({
      rows: rows(1001, 1200),
      unreadCount: 200,
    }));
    const { sink } = start(1000n);
    await flush();

    const ids = frames(sink)
      .slice(1)
      .map((f) => f.id);
    expect(ids).toEqual(rows(1001, 1200).map((r) => String(r.position)));
  });

  it('reads a position beyond 2^53 without losing digits', async () => {
    const big = 900719925474099301n;
    const replay = jest.fn(async () => ({
      rows: [{ ...row(1), position: big + 1n }],
      unreadCount: 1,
    }));
    const { start } = make(replay);
    const { sink } = start(big);
    await flush();

    expect(replay).toHaveBeenCalledWith('a1', big);
    expect(frames(sink)[1]?.id).toBe('900719925474099302');
  });

  it('does not ask for a replay when the hub has none configured, and drops nothing on the client position alone', async () => {
    const { hub, start } = make(undefined);
    const { sink } = start(10n);
    await flush();

    await hub.deliver(live('notification.created', '10', { unreadCount: 1 }));
    await hub.deliver(live('notification.created', '11', { unreadCount: 2 }));

    expect(frames(sink).map((f) => f.id)).toEqual([undefined, '10', '11']);
  });

  it('replays nothing for an absent position', async () => {
    const replay = jest.fn(async () => ({ rows: [row(1)], unreadCount: 1 }));
    const { start } = make(replay);

    start(undefined);
    start(null);
    await flush();

    expect(replay).not.toHaveBeenCalled();
  });

  it('asks the replay for the stream own account only', async () => {
    const replay = jest.fn(async () => ({ rows: [], unreadCount: 0 }));
    const { start } = make(replay);

    start(3n, 'a2');
    await flush();

    expect(replay).toHaveBeenCalledWith('a2', 3n);
  });
});

// @traces 1190-FR-004
describe('replay: events that arrive while it is read', () => {
  const gate = () => {
    let open: (value: Found) => void = () => undefined;
    const promise = new Promise<Found>((resolve) => {
      open = resolve;
    });
    return { open, promise };
  };

  it('holds every kind until the replay is written, in arrival order', async () => {
    const g = gate();
    const { hub, start } = make(() => g.promise);
    const { sink } = start(4n);

    await hub.deliver(live('live.test', undefined));
    await hub.deliver(live('notification.read', undefined, { unreadCount: 1 }));
    await hub.deliver(live('notification.created', '8', { unreadCount: 2 }));
    expect(frames(sink).map((f) => f.event)).toEqual(['hello']);

    g.open({ rows: [row(5), row(6)], unreadCount: 2 });
    await flush();

    expect(frames(sink).map((f) => [f.event, f.id])).toEqual([
      ['hello', undefined],
      ['notification.created', '5'],
      ['notification.created', '6'],
      ['live.test', undefined],
      ['notification.read', undefined],
      ['notification.created', '8'],
    ]);
  });

  it('drops a held notification at the last replayed position and keeps the one just above', async () => {
    const g = gate();
    const { hub, start } = make(() => g.promise);
    const { sink } = start(4n);

    await hub.deliver(live('notification.created', '6', { unreadCount: 3 }));
    await hub.deliver(live('notification.created', '7', { unreadCount: 3 }));
    g.open({ rows: [row(5), row(6)], unreadCount: 3 });
    await flush();

    expect(frames(sink).map((f) => f.id)).toEqual([undefined, '5', '6', '7']);
  });

  it('drops nothing live on the position the client named when the replay found nothing: it may be no position of this account', async () => {
    const { hub, start } = make(async () => ({ rows: [], unreadCount: 0 }));
    const { sink } = start(20n);
    await flush();

    await hub.deliver(live('notification.created', '19', { unreadCount: 1 }));
    await hub.deliver(live('notification.created', '20', { unreadCount: 1 }));
    await hub.deliver(live('notification.created', '21', { unreadCount: 1 }));

    expect(frames(sink).map((f) => f.id)).toEqual([
      undefined,
      '19',
      '20',
      '21',
    ]);
  });

  it('never drops a read, whatever position its envelope carries', async () => {
    const { hub, start } = make(async () => ({
      rows: rows(1, 3),
      unreadCount: 0,
    }));
    const { sink } = start(0n);
    await flush();

    await hub.deliver(live('notification.read', '1', { unreadCount: 0 }));

    expect(frames(sink).at(-1)).toMatchObject({
      data: { kind: 'notification.read', unreadCount: 0 },
      event: 'notification.read',
    });
  });

  it('delivers a live notification without a position even after a replay', async () => {
    const { hub, start } = make(async () => ({
      rows: [row(5)],
      unreadCount: 1,
    }));
    const { sink } = start(4n);
    await flush();

    await hub.deliver(
      live('notification.created', undefined, { unreadCount: 1 }),
    );

    expect(frames(sink).at(-1)?.event).toBe('notification.created');
    expect(frames(sink).at(-1)?.id).toBeUndefined();
  });

  it('keeps two streams replaying at once apart', async () => {
    const one = gate();
    const two = gate();
    const answers = [one, two];
    const { start } = make(
      () => (answers.shift() as ReturnType<typeof gate>).promise,
    );
    const first = start(1n);
    const second = start(1n);

    two.open({ rows: [row(2)], unreadCount: 1 });
    await flush();
    expect(frames(first.sink).map((f) => f.id)).toEqual([undefined]);
    expect(frames(second.sink).map((f) => f.id)).toEqual([undefined, '2']);

    one.open({ rows: [row(2), row(3)], unreadCount: 2 });
    await flush();
    expect(frames(first.sink).map((f) => f.id)).toEqual([undefined, '2', '3']);
  });
});

// @traces 1190-FR-003
describe('replay: the read failing', () => {
  it('goes live with what it held when the read throws before returning a promise', async () => {
    const { hub, start } = make(() => {
      throw new Error('boom');
    });
    const { sink } = start(1n);
    await hub.deliver(live('notification.created', '9', { unreadCount: 1 }));
    await flush();

    expect(frames(sink).map((f) => [f.event, f.id])).toEqual([
      ['hello', undefined],
      ['notification.created', '9'],
    ]);
  });

  it('goes live with what it held when the read rejects with a non-error', async () => {
    const { hub, start } = make(() => Promise.reject('down'));
    const { sink } = start(1n);
    await hub.deliver(live('live.test', undefined));
    await flush();

    expect(frames(sink).map((f) => f.event)).toEqual(['hello', 'live.test']);
  });

  it('writes nothing when the read resolves with rows after the planned close', async () => {
    let answer: (f: Found) => void = () => undefined;
    const { start } = make(
      () =>
        new Promise<Found>((resolve) => {
          answer = resolve;
        }),
      MINUTE,
    );
    const { sink } = start(1n);

    jest.advanceTimersByTime(MINUTE);
    answer({ rows: [row(2)], unreadCount: 1 });
    await flush();

    expect(frames(sink).map((f) => f.event)).toEqual(['hello', 'reconnect']);
  });
});

// @traces 1190-FR-002
describe('the id line, hostile envelopes', () => {
  const sinkFor = () => {
    const { hub, start } = make();
    const { sink } = start(null);
    return { hub, sink };
  };

  it.each([
    ['a different kind', 'live.test'],
    ['a read', 'notification.read'],
    ['a job update', 'job.updated'],
  ])(
    'writes no id line for %s even when the envelope has a position',
    async (_n, kind) => {
      const { hub, sink } = sinkFor();

      await hub.deliver(live(kind, '12'));

      expect(frames(sink).at(-1)?.id).toBeUndefined();
    },
  );

  it.each([
    ['letters', 'abc'],
    ['negative', '-4'],
    ['a decimal', '1.5'],
    ['an exponent', '1e3'],
    ['too long', '9'.repeat(19)],
    ['a number', 12],
    ['null', null],
    ['an object', { toString: () => '5' }],
    ['a newline injection', '5\nevent: bye'],
    ['empty', ''],
  ])('writes no id line for a position that is %s', async (_n, position) => {
    const { hub, sink } = sinkFor();

    await hub.deliver(
      live('notification.created', position as never, { unreadCount: 1 }),
    );

    const last = frames(sink).at(-1);
    expect(last?.event).toBe('notification.created');
    expect(last?.id).toBeUndefined();
    expect(sink.chunks.join('')).not.toMatch(/^event: bye/m);
  });

  it.each([
    ['negative', -1],
    ['a decimal', 1.5],
    ['text', '3'],
    ['null', null],
    ['NaN as text', 'NaN'],
  ])('carries no count that is %s', async (_n, count) => {
    const { hub, sink } = sinkFor();

    await hub.deliver(
      live('notification.created', '3', { unreadCount: count }),
    );

    expect(frames(sink).at(-1)?.data).not.toHaveProperty('unreadCount');
  });

  it('carries a count of zero', async () => {
    const { hub, sink } = sinkFor();

    await hub.deliver(live('notification.read', undefined, { unreadCount: 0 }));

    expect(frames(sink).at(-1)?.data.unreadCount).toBe(0);
  });

  it('strips fields it does not know from every kind', async () => {
    const { hub, sink } = sinkFor();

    await hub.deliver(
      live('live.test', undefined, { secret: 'x', unreadCount: 4 }),
    );

    expect(Object.keys(frames(sink).at(-1)?.data).sort()).toEqual([
      'at',
      'id',
      'kind',
    ]);
  });
});

// @traces 1190-FR-006
describe('the planned close, edges', () => {
  it('sends reconnect then ends exactly once, and writes nothing afterwards', async () => {
    const { hub, start } = make(undefined, 1000);
    const { sink } = start(null);

    jest.advanceTimersByTime(1000);
    await hub.deliver(live('live.test', undefined));
    jest.advanceTimersByTime(60_000);

    expect(frames(sink).map((f) => f.event)).toEqual(['hello', 'reconnect']);
    expect(sink.chunks.filter((c) => c.startsWith(':'))).toEqual([]);
    expect(sink.ended).toBe(true);
  });

  it('does not close a stream that was never given an interval', () => {
    const { start } = make();
    const { sink } = start(null);

    jest.advanceTimersByTime(14 * MINUTE + 1);

    expect(sink.ended).toBe(false);
  });

  it('closes each stream on its own clock', () => {
    const { start } = make(undefined, 1000);
    const early = start(null);
    jest.advanceTimersByTime(600);
    const late = start(null);

    jest.advanceTimersByTime(400);

    expect(early.sink.ended).toBe(true);
    expect(late.sink.ended).toBe(false);
  });

  it('opens the stream with the retry line before hello', () => {
    const { start } = make();
    const { sink } = start(null);

    expect(sink.chunks[0]).toBe('retry: 3000\n\n');
    expect(sink.chunks[1]).toMatch(/^event: hello/);
  });

  it('opens nothing for a sink that is already gone', () => {
    const { hub } = make();
    const sink = new Sink();
    sink.destroyed = true;

    const id = hub.open(sink, {
      accountId: 'a1',
      channels: ['account:a1'],
      expiresAt: NOW + MINUTE,
      garageId: null,
      role: 'driver',
      since: 5n,
    });

    expect(id).toBeNull();
    expect(sink.chunks).toEqual([]);
  });
});

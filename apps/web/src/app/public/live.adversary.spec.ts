import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import { HttpErrorResponse } from '@angular/common/http';
import {
  createEnvironmentInjector,
  EnvironmentInjector,
  PLATFORM_ID,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PublicLive, publicLiveResource } from './live';

globalThis.TextEncoder ??= NodeEncoder as typeof TextEncoder;
globalThis.TextDecoder ??= NodeDecoder as unknown as typeof TextDecoder;

class Body {
  private queue: string[] = [];
  private waiting: ((r: ReadableStreamReadResult<Uint8Array>) => void) | null =
    null;
  private done = false;
  readonly reader = {
    cancel: async () => this.end(),
    read: () =>
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        const text = this.queue.shift();
        if (text !== undefined)
          resolve({ done: false, value: new TextEncoder().encode(text) });
        else if (this.done) resolve({ done: true, value: undefined });
        else this.waiting = resolve;
      }),
    releaseLock: () => undefined,
  };
  send(text: string) {
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = null;
      waiting({ done: false, value: new TextEncoder().encode(text) });
    } else this.queue.push(text);
  }
  end() {
    this.done = true;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.({ done: true, value: undefined });
  }
}

let bodies: Body[];
let answers: ('open' | 'fail' | number)[];
let fetchMock: jest.Mock;

const settle = () => jest.advanceTimersByTimeAsync(0);
const elapse = (ms: number) => jest.advanceTimersByTimeAsync(ms);

const event = (kind: string, id = 'g-1') =>
  `event: ${kind}\ndata: ${JSON.stringify({ at: '2026-10-07T12:00:00.000Z', id, kind })}\n\n`;

function setUp(platform = 'browser') {
  bodies = [];
  answers = [];
  jest.spyOn(Math, 'random').mockImplementation(() => 0.5);
  fetchMock = jest.fn(async (_url: string, init: RequestInit) => {
    const answer = answers.shift() ?? 'open';
    if (answer === 'fail') throw new TypeError('Failed to fetch');
    const body = new Body();
    bodies.push(body);
    init.signal?.addEventListener('abort', () => body.end());
    if (typeof answer === 'number')
      return { body: null, ok: false, status: answer };
    return { body: { getReader: () => body.reader }, ok: true, status: 200 };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  return TestBed.inject(PublicLive);
}

const urls = () =>
  fetchMock.mock.calls.map(([url]) => {
    const parsed = new URL(url as string, 'http://x');
    return `${parsed.pathname}${parsed.search}`;
  });
const signalOf = (call: number) =>
  (fetchMock.mock.calls[call] as [string, RequestInit])[1]
    .signal as AbortSignal;

// A view's own injector, destroyed when the view goes away.
function view() {
  return createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  TestBed.resetTestingModule();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('PublicLive under hostile use', () => {
  it('encodes ids that carry reserved characters', async () => {
    const live = setUp();

    live.register({ garage: 'a&mechanics=x y' });
    await settle();

    const query = new URL(urls()[0] ?? '', 'http://x').searchParams;
    expect(Object.fromEntries(query)).toEqual({ garages: 'a&mechanics=x y' });
  });

  it('lets each field follow its own newest view', async () => {
    const live = setUp();
    live.register({ garage: 'g-1' });
    live.register({ brand: 'b-1' });
    const leave = live.register({ garage: 'g-2' });
    await settle();

    expect(urls()).toEqual(['/api/v1/live/public?garages=g-2&brand=b-1']);

    leave();
    await settle();

    expect(urls().at(-1)).toBe('/api/v1/live/public?garages=g-1&brand=b-1');
  });

  it('keeps the stream when an older view leaves and the names stay the same', async () => {
    const live = setUp();
    const leaveOld = live.register({ garage: 'g-1' });
    live.register({ garage: 'g-1' });
    await settle();

    leaveOld();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(live.state()).toBe('open');
  });

  it('opens nothing for a view that leaves in the tick it arrived', async () => {
    const live = setUp();

    live.register({ garage: 'g-1' })();
    await elapse(5_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(live.state()).toBe('closed');
  });

  it('closes the stream only once when a view leaves twice', async () => {
    const live = setUp();
    const leave = live.register({ garage: 'g-1' });
    live.register({ garage: 'g-1' });
    await settle();

    leave();
    leave();
    await settle();

    expect(signalOf(0).aborted).toBe(false);
    expect(live.state()).toBe('open');
  });

  it('opens a new stream when a view arrives after the last one left', async () => {
    const live = setUp();
    live.register({ garage: 'g-1' })();
    await settle();

    live.register({ garage: 'g-1' });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(live.state()).toBe('open');
  });

  it.each([401, 403, 429, 500, 503])(
    'stays reconnecting, throws nothing and never polls when the stream answers %i',
    async (status) => {
      const live = setUp();
      answers = Array(30).fill(status);
      const states = new Set<string>();

      live.register({ garage: 'g-1' });
      for (let s = 0; s < 120; s++) {
        await elapse(1_000);
        states.add(live.state());
      }

      expect(states).toEqual(new Set(['reconnecting']));
      expect(urls().every((u) => u.startsWith('/api/v1/live/public'))).toBe(
        true,
      );
      expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
    },
  );

  it('treats an answer with no body as a failure to open', async () => {
    const live = setUp();
    fetchMock.mockImplementationOnce(async () => ({
      body: null,
      ok: true,
      status: 200,
    }));

    live.register({ garage: 'g-1' });
    await settle();

    expect(live.state()).toBe('reconnecting');
  });

  it('treats 60 silent seconds as a drop and opens a fresh stream', async () => {
    const live = setUp();
    live.register({ garage: 'g-1' });
    await settle();

    await elapse(75_000);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(signalOf(0).aborted).toBe(true);
  });

  it('reads an event split across two chunks', async () => {
    const live = setUp();
    const seen: string[] = [];
    live.on(['garage.updated']).subscribe((m) => seen.push(m.id));
    live.register({ garage: 'g-1' });
    await settle();

    const frame = event('garage.updated', 'g-1');
    bodies[0]?.send(frame.slice(0, 20));
    await settle();
    bodies[0]?.send(frame.slice(20));
    await settle();

    expect(seen).toEqual(['g-1']);
  });

  it('ignores a frame whose data is not json and keeps reading', async () => {
    const live = setUp();
    const seen: string[] = [];
    live.on(['garage.updated']).subscribe((m) => seen.push(m.id));
    live.register({ garage: 'g-1' });
    await settle();

    bodies[0]?.send('event: garage.updated\ndata: {not json\n\n');
    bodies[0]?.send(event('garage.updated', 'g-2'));
    await settle();

    expect(seen).toEqual(['g-2']);
    expect(live.state()).toBe('open');
  });

  it('ignores a kind it does not know', async () => {
    const live = setUp();
    const seen: string[] = [];
    live.on(['garage.updated']).subscribe((m) => seen.push(m.kind));
    live.register({ garage: 'g-1' });
    await settle();

    bodies[0]?.send(event('totally.unknown', 'g-1'));
    await settle();

    expect(seen).toEqual([]);
  });

  it('stops passing events to a subscriber that unsubscribed', async () => {
    const live = setUp();
    const seen: string[] = [];
    const sub = live.on(['garage.updated']).subscribe((m) => seen.push(m.id));
    live.register({ garage: 'g-1' });
    await settle();

    sub.unsubscribe();
    bodies[0]?.send(event('garage.updated', 'g-1'));
    await settle();

    expect(seen).toEqual([]);
  });

  it('announces a resync on the first open and on every re-open, never otherwise', async () => {
    const live = setUp();
    let resyncs = 0;
    live.resync.subscribe(() => resyncs++);

    live.register({ garage: 'g-1' });
    await settle();
    expect(resyncs).toBe(1);

    await elapse(20_000);
    bodies[0]?.send(event('garage.updated'));
    await settle();
    expect(resyncs).toBe(1);

    bodies[0]?.end();
    await elapse(1_100);
    expect(resyncs).toBe(2);
  });

  it('never sends a request other than the stream while views are open and the stream is down', async () => {
    const live = setUp();
    answers = Array(50).fill('fail');

    live.register({ garage: 'g-1' });
    await elapse(10 * 60_000);

    const targets = new Set(urls().map((u) => u.split('?')[0]));
    expect(targets).toEqual(new Set(['/api/v1/live/public']));
  });
});

describe('publicLiveResource under hostile use', () => {
  const PROFILE = ['garage.updated'] as const;

  it('runs one read at a time when events arrive while a read is in flight', async () => {
    setUp();
    let running = 0;
    let peak = 0;
    const load = jest.fn(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((ok) => setTimeout(ok, 1_000));
      running--;
      return { name: 'Atelier' };
    });
    runInInjectionContext(view(), () =>
      publicLiveResource(
        load,
        PROFILE,
        () => ({ garage: 'g-1' }),
        () => 'g-1',
      ),
    );
    await elapse(3_000);

    for (let i = 0; i < 5; i++) {
      bodies[0]?.send(event('garage.updated'));
      await elapse(400);
    }
    await elapse(5_000);

    expect(peak).toBe(1);
  });

  it('re-reads for any object when no id is given', async () => {
    setUp();
    const load = jest.fn(async () => ({ items: [] }));
    runInInjectionContext(view(), () =>
      publicLiveResource(load, PROFILE, () => ({ brand: 'b-1' })),
    );
    await settle();
    load.mockClear();

    bodies[0]?.send(event('garage.updated', 'anything'));
    await elapse(300);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows no error and keeps no value when the first read fails, and never retries on a timer', async () => {
    setUp();
    const load = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 500 });
    });
    const ref = runInInjectionContext(view(), () =>
      publicLiveResource(
        load,
        PROFILE,
        () => ({ garage: 'g-1' }),
        () => 'g-1',
      ),
    );
    await settle();
    load.mockClear();

    for (let beat = 0; beat < 12; beat++) {
      await elapse(25_000);
      bodies[0]?.send(': heartbeat\n\n');
    }

    expect(ref.value()).toBeUndefined();
    expect(ref.gone()).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('clears gone when a later re-read succeeds again', async () => {
    setUp();
    let status: number | null = null;
    const load = jest.fn(async () => {
      if (status) throw new HttpErrorResponse({ status });
      return { name: 'Atelier' };
    });
    const ref = runInInjectionContext(view(), () =>
      publicLiveResource(
        load,
        PROFILE,
        () => ({ garage: 'g-1' }),
        () => 'g-1',
      ),
    );
    await settle();
    status = 410;
    bodies[0]?.send(event('garage.updated'));
    await elapse(300);
    expect(ref.gone()).toBe(true);

    status = null;
    bodies[0]?.send(event('garage.updated'));
    await elapse(300);

    expect(ref.gone()).toBe(false);
  });

  it('keeps the same value object when a re-read answers identical data', async () => {
    setUp();
    const load = jest.fn(async () => ({ list: [{ id: 1 }, { id: 2 }] }));
    const ref = runInInjectionContext(view(), () =>
      publicLiveResource(
        load,
        PROFILE,
        () => ({ garage: 'g-1' }),
        () => 'g-1',
      ),
    );
    await settle();
    const before = ref.value();

    bodies[0]?.send(event('garage.updated'));
    await elapse(300);

    expect(ref.value()).toBe(before);
  });

  it('sends no request but its own reads while the page is rendered on the server', async () => {
    setUp('server');
    runInInjectionContext(view(), () =>
      publicLiveResource(
        async () => ({ name: 'Atelier' }),
        PROFILE,
        () => ({ garage: 'g-1' }),
        () => 'g-1',
      ),
    );
    await elapse(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

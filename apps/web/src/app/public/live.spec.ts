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
  signal,
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

describe('PublicLive', () => {
  it('opens no stream while no public view is open', async () => {
    setUp();

    await elapse(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens nothing while the page is rendered on the server', async () => {
    const live = setUp('server');

    live.register({ garage: 'g-1' });
    await elapse(5_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(live.state()).toBe('closed');
  });

  it('opens one stream for a view, naming what it shows and sending no token', async () => {
    const live = setUp();

    live.register({ garage: 'g-1' });
    await settle();

    expect(urls()).toEqual(['/api/v1/live/public?garages=g-1']);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({
      Accept: 'text/event-stream',
      'ngsw-bypass': 'true',
    });
    expect(live.state()).toBe('open');
  });

  it('opens one stream for views opened in the same tick, with what each names', async () => {
    const live = setUp();

    live.register({ brand: 'b-1' });
    live.register({ garage: 'g-1', mechanic: 'm-1' });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const query = new URL(urls()[0] ?? '', 'http://x').searchParams;
    expect(Object.fromEntries(query)).toEqual({
      brand: 'b-1',
      garages: 'g-1',
      mechanics: 'm-1',
    });
  });

  it('re-opens once, for the newest view, when a second view names another garage', async () => {
    const live = setUp();
    live.register({ garage: 'g-1' });
    await settle();

    const leave = live.register({ garage: 'g-2' });
    await settle();

    expect(urls()).toEqual([
      '/api/v1/live/public?garages=g-1',
      '/api/v1/live/public?garages=g-2',
    ]);
    expect(signalOf(0).aborted).toBe(true);

    leave();
    await settle();

    expect(urls().at(-1)).toBe('/api/v1/live/public?garages=g-1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the stream when a view that changes nothing opens', async () => {
    const live = setUp();
    live.register({ garage: 'g-1' });
    await settle();

    live.register({ garage: 'g-1' });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('closes the stream when the last view goes away', async () => {
    const live = setUp();
    const leave = live.register({ garage: 'g-1' });
    await settle();

    leave();
    await settle();

    expect(signalOf(0).aborted).toBe(true);
    expect(live.state()).toBe('closed');
    await elapse(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tries again on the backoff after a dropped stream, and is never polling', async () => {
    const live = setUp();
    const states = new Set<string>();
    live.register({ garage: 'g-1' });
    await settle();

    answers = ['fail', 'fail', 'fail', 'fail'];
    bodies[0]?.end();
    for (let second = 0; second < 47; second++) {
      await elapse(1_000);
      states.add(live.state());
    }
    await elapse(2_000);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(live.state()).toBe('open');
    expect(states).toEqual(new Set(['reconnecting']));
    expect(live.state()).toBe('open');
  });

  it.each([
    [60_000, 2],
    [50_000, 1],
  ])(
    'after a tab hidden for %i ms wakes, has opened %i streams',
    async (hiddenFor, streams) => {
      const live = setUp();
      let visibility: DocumentVisibilityState = 'visible';
      jest
        .spyOn(document, 'visibilityState', 'get')
        .mockImplementation(() => visibility);
      live.register({ garage: 'g-1' });
      await settle();

      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      for (let slept = 0; slept < hiddenFor; slept += 10_000) {
        await elapse(10_000);
        bodies[0]?.send(': heartbeat\n\n');
      }
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(fetchMock).toHaveBeenCalledTimes(streams);
      expect(signalOf(0).aborted).toBe(streams === 2);
      expect(live.state()).toBe('open');
    },
  );

  it('passes on the events of its stream, filtered by kind and id', async () => {
    const live = setUp();
    const seen: string[] = [];
    live
      .on(['review.posted'], { id: 'g-1' })
      .subscribe((m) => seen.push(`${m.kind} ${m.id}`));
    live.register({ garage: 'g-1' });
    await settle();

    bodies[0]?.send(event('hello', 'c-1'));
    bodies[0]?.send(event('review.posted', 'g-1'));
    bodies[0]?.send(event('review.posted', 'g-2'));
    bodies[0]?.send(event('garage.updated', 'g-1'));
    await settle();

    expect(seen).toEqual(['review.posted g-1']);
  });
});

describe('publicLiveResource', () => {
  const PROFILE = ['garage.updated', 'review.posted'] as const;

  it('reads at once, and again when the stream opens', async () => {
    setUp();
    const load = jest.fn(async () => ({ name: 'Atelier' }));
    const ref = runInInjectionContext(view(), () =>
      publicLiveResource(
        load,
        PROFILE,
        () => ({ garage: 'g-1' }),
        () => 'g-1',
      ),
    );
    await settle();

    expect(ref.value()).toEqual({ name: 'Atelier' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('re-reads on its kinds about its object, once for a burst, and not for another object', async () => {
    setUp();
    const load = jest.fn(async () => ({ name: 'Atelier' }));
    runInInjectionContext(view(), () =>
      publicLiveResource(
        load,
        PROFILE,
        () => ({ garage: 'g-1' }),
        () => 'g-1',
      ),
    );
    await settle();
    load.mockClear();

    for (let i = 0; i < 10; i++) bodies[0]?.send(event('review.posted'));
    bodies[0]?.send(event('review.posted', 'g-2'));
    bodies[0]?.send(event('price_list.updated'));
    await elapse(300);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('re-reads a results view on a change to any garage', async () => {
    setUp();
    const load = jest.fn(async () => ({ items: [] }));
    runInInjectionContext(view(), () =>
      publicLiveResource(
        load,
        [
          'garage.updated',
          'verification.decided',
          'garage.suspended',
          'garage.restored',
        ],
        () => ({ brand: 'b-1' }),
      ),
    );
    await settle();

    for (const kind of [
      'garage.updated',
      'verification.decided',
      'garage.suspended',
      'garage.restored',
    ]) {
      load.mockClear();
      bodies[0]?.send(event(kind, `g-${kind}`));
      await elapse(300);
      expect({ kind, reads: load.mock.calls.length }).toEqual({
        kind,
        reads: 1,
      });
    }
  });

  it('re-reads on every re-open of the stream', async () => {
    setUp();
    const load = jest.fn(async () => ({ name: 'Atelier' }));
    runInInjectionContext(view(), () =>
      publicLiveResource(
        load,
        PROFILE,
        () => ({ garage: 'g-1' }),
        () => 'g-1',
      ),
    );
    await settle();
    load.mockClear();

    bodies[0]?.end();
    await elapse(1_100);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps what it showed when a re-read fails, and tries again on no timer', async () => {
    setUp();
    let fail = false;
    const load = jest.fn(async () => {
      if (fail) throw new HttpErrorResponse({ status: 503 });
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
    fail = true;

    bodies[0]?.send(event('garage.updated'));
    await elapse(300);
    load.mockClear();
    for (let beat = 0; beat < 12; beat++) {
      await elapse(25_000);
      bodies[0]?.send(': heartbeat\n\n');
    }

    expect(ref.value()).toEqual({ name: 'Atelier' });
    expect(ref.failed()).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it.each([404, 410])(
    'marks the view gone when a re-read answers %i, keeping what it showed',
    async (status) => {
      setUp();
      let answer: number | null = null;
      const load = jest.fn(async () => {
        if (answer) throw new HttpErrorResponse({ status: answer });
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
      answer = status;

      bodies[0]?.send(event('garage.updated'));
      await elapse(300);

      expect(ref.gone()).toBe(true);
      expect(ref.value()).toEqual({ name: 'Atelier' });
    },
  );

  it('re-opens for the garage a view learns after its first read', async () => {
    setUp();
    const id = signal<string | undefined>(undefined);
    runInInjectionContext(view(), () =>
      publicLiveResource(
        async () => {
          id.set('g-9');
          return { id: 'g-9' };
        },
        PROFILE,
        () => ({ garage: id() }),
        () => id() ?? '',
      ),
    );
    await settle();
    TestBed.tick();
    await settle();

    expect(urls().at(-1)).toBe('/api/v1/live/public?garages=g-9');
  });

  it('closes the stream and drops a read in flight when its view goes away', async () => {
    setUp();
    let finish: (value: { name: string }) => void = () => undefined;
    const injector = view();
    const ref = runInInjectionContext(injector, () =>
      publicLiveResource(
        () => new Promise<{ name: string }>((ok) => (finish = ok)),
        PROFILE,
        () => ({ garage: 'g-1' }),
        () => 'g-1',
      ),
    );
    await settle();

    injector.destroy();
    finish({ name: 'Atelier' });
    await settle();

    expect(ref.value()).toBeUndefined();
    expect(TestBed.inject(PublicLive).state()).toBe('closed');
  });
});

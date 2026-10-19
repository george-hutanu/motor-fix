import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';

import { Live, liveResource } from './live';
import { Session } from './session';
import { withoutTabs, withTabs } from '../live/tab-fakes.testing';

// jsdom has neither; the browser and Node both do.
globalThis.TextEncoder ??= NodeEncoder as typeof TextEncoder;
globalThis.TextDecoder ??= NodeDecoder as unknown as typeof TextDecoder;

// One controllable response body per fetch call.
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
let fetchMock: jest.Mock;
let tokens: string[];
let renew: jest.Mock;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setUp(platform = 'browser') {
  bodies = [];
  tokens = ['token-1', 'token-2', 'token-3'];
  renew = jest.fn(async () => {
    tokens.shift();
    return true;
  });
  fetchMock = jest.fn(async () => {
    const body = new Body();
    bodies.push(body);
    return {
      body: { getReader: () => body.reader },
      ok: true,
      status: 200,
    };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: Session,
        useValue: {
          current: () => ({ id: 'a1', role: 'driver' }),
          renew,
          token: () => tokens[0],
        },
      },
    ],
  });
  const live = TestBed.inject(Live);
  const seen: LiveMessage[] = [];
  live.events.subscribe((m) => seen.push(m));
  return { live, seen };
}

const event = (kind: string, extra: Record<string, string> = {}) =>
  `event: ${kind}\ndata: ${JSON.stringify({ at: '2026-10-04T12:00:00.000Z', id: 'e-1', kind, ...extra })}\n\n`;

afterEach(() => TestBed.resetTestingModule());

describe('Live', () => {
  it('opens the stream with the access token in the Authorization header, never in the address', async () => {
    const { live } = setUp();

    live.open();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/live');
    expect(init.headers).toMatchObject({
      Accept: 'text/event-stream',
      Authorization: 'Bearer token-1',
      'ngsw-bypass': 'true',
    });
    expect(url).not.toContain('token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('opens one stream per tab however often it is asked', async () => {
    const { live } = setUp();

    live.open();
    live.open();
    await flush();
    live.open();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens nothing while the page is rendered on the server', async () => {
    const { live } = setUp('server');

    live.open();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes on every event the server sends, skipping comment lines', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();

    bodies[0]?.send(event('hello'));
    bodies[0]?.send(': ping\n\n');
    bodies[0]?.send(event('live.test'));
    await flush();

    expect(seen.map((m) => m.kind)).toEqual(['hello', 'live.test']);
    expect(seen[1]).toEqual({
      at: '2026-10-04T12:00:00.000Z',
      id: 'e-1',
      kind: 'live.test',
    });
  });

  it('puts together an event that arrives in pieces', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();
    const whole = event('live.test') + event('hello');

    bodies[0]?.send(whole.slice(0, 9));
    bodies[0]?.send(whole.slice(9, 40));
    bodies[0]?.send(whole.slice(40));
    await flush();

    expect(seen.map((m) => m.kind)).toEqual(['live.test', 'hello']);
  });

  it.each(['expired', 'shutdown'])(
    'renews the token and reconnects within 3 seconds after bye %s',
    async (reason) => {
      jest.useFakeTimers();
      try {
        const { live } = setUp();
        live.open();
        await flush();

        bodies[0]?.send(event('bye', { reason }));
        bodies[0]?.end();
        await flush();
        jest.advanceTimersByTime(3_000);
        await flush();

        expect(renew).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('does not reconnect after bye evicted', async () => {
    const { live } = setUp();
    live.open();
    await flush();

    bodies[0]?.send(event('bye', { reason: 'evicted' }));
    bodies[0]?.end();
    await flush();
    await new Promise((r) => setTimeout(r, 50));

    expect(renew).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect when the renewal fails', async () => {
    const { live } = setUp();
    renew.mockResolvedValueOnce(false);
    live.open();
    await flush();

    bodies[0]?.send(event('bye', { reason: 'expired' }));
    bodies[0]?.end();
    await flush();
    await new Promise((r) => setTimeout(r, 50));

    expect(renew).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the stream when closed and does not reopen it', async () => {
    const { live } = setUp();
    live.open();
    await flush();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    live.close();
    bodies[0]?.end();
    await flush();
    await new Promise((r) => setTimeout(r, 50));

    expect(init.signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens a fresh stream when opened again after closing', async () => {
    const { live } = setUp();
    live.open();
    await flush();
    live.close();

    live.open();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens nothing when there is no access token', async () => {
    const { live } = setUp();
    tokens = [];

    live.open();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Live.on', () => {
  it('gives a view only the kinds and the object it asked for', async () => {
    const { live } = setUp();
    const quotes: LiveMessage[] = [];
    const any: LiveMessage[] = [];
    live
      .on(['quote.sent'], { id: 'request-123' })
      .subscribe((m) => quotes.push(m));
    live.on(['quote.sent', 'quote.accepted']).subscribe((m) => any.push(m));
    live.open();
    await flush();

    bodies[0]?.send(event('quote.sent', { id: 'request-456' }));
    bodies[0]?.send(event('quote.accepted', { id: 'request-123' }));
    bodies[0]?.send(event('quote.sent', { id: 'request-123' }));
    bodies[0]?.send(event('live.test', { id: 'request-123' }));
    await flush();

    expect(quotes.map((m) => [m.kind, m.id])).toEqual([
      ['quote.sent', 'request-123'],
    ]);
    expect(any.map((m) => [m.kind, m.id])).toEqual([
      ['quote.sent', 'request-456'],
      ['quote.accepted', 'request-123'],
      ['quote.sent', 'request-123'],
    ]);
  });

  it('refuses a kind outside the catalogue at compile time', () => {
    const { live } = setUp();
    // @ts-expect-error: not an event kind
    expect(() => live.on(['quote.snet'])).not.toThrow();
  });
});

describe('liveResource', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function view(id = 'request-123') {
    let reads = 0;
    const { ref } = await viewOf(async () => ({ id, reads: ++reads }), id);
    return { reads: () => reads, ref };
  }

  it('loads the view’s data first, through the given call', async () => {
    const { ref, reads } = await view();

    expect(reads()).toBe(1);
    expect(ref.value()).toEqual({ id: 'request-123', reads: 1 });
  });

  it('does nothing when the event is about another object, and re-reads for its own', async () => {
    const { ref, reads } = await view();

    bodies[0]?.send(event('quote.sent', { id: 'request-456' }));
    await wait(400);
    expect(reads()).toBe(1);

    bodies[0]?.send(event('quote.sent', { id: 'request-123' }));
    await wait(400);
    expect(reads()).toBe(2);
    expect(ref.value()).toEqual({ id: 'request-123', reads: 2 });
  });

  it('re-reads once for the events of 300 ms', async () => {
    const { reads } = await view();

    for (let i = 0; i < 3; i++) {
      bodies[0]?.send(event('quote.sent', { id: 'request-123' }));
      await wait(50);
    }
    await wait(400);

    expect(reads()).toBe(2);
  });

  async function viewOf<T>(load: () => Promise<T>, id = 'request-123') {
    const { live } = setUp();
    const ref = TestBed.runInInjectionContext(() =>
      liveResource(load, ['quote.sent'], () => id),
    );
    live.open();
    await flush();
    await wait(10);
    const send = async () => {
      bodies[0]?.send(event('quote.sent', { id }));
      await wait(400);
    };
    return { ref, send };
  }

  it('keeps every unchanged row as it was and replaces only the one that changed', async () => {
    let rows = [
      { id: 'a', price: 100 },
      { id: 'b', price: 200 },
    ];
    const { ref, send } = await viewOf(
      async () => JSON.parse(JSON.stringify(rows)) as typeof rows,
    );
    const [a, b] = ref.value() ?? [];

    rows = [
      { id: 'a', price: 100 },
      { id: 'b', price: 250 },
    ];
    await send();

    expect(ref.value()?.[0]).toBe(a);
    expect(ref.value()?.[1]).not.toBe(b);
    expect(ref.value()?.[1]).toEqual({ id: 'b', price: 250 });
  });

  it('keeps the very same value when a re-read brings nothing new', async () => {
    const { ref, send } = await viewOf(async () => ({ id: 'r', price: 1 }));
    const before = ref.value();

    await send();

    expect(ref.value()).toBe(before);
  });

  it('keeps the data on screen and shows no error when a re-read fails, and reads again on the next event', async () => {
    let fail = false;
    let reads = 0;
    const { ref, send } = await viewOf(async () => {
      reads++;
      if (fail) throw new HttpErrorResponse({ status: 503 });
      return { reads };
    });

    fail = true;
    await send();
    expect(reads).toBe(2);
    expect(ref.value()).toEqual({ reads: 1 });
    expect(ref.error()).toBeUndefined();
    expect(ref.gone()).toBe(false);

    fail = false;
    await send();
    expect(ref.value()).toEqual({ reads: 3 });
  });

  it('reads again 60 seconds after a failed re-read', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      let fail = false;
      let reads = 0;
      const { ref, send } = await viewOf(async () => {
        reads++;
        if (fail) throw new HttpErrorResponse({ status: 0 });
        return { reads };
      });
      fail = true;
      await send();
      fail = false;
      expect(reads).toBe(2);

      jest.advanceTimersByTime(59_000);
      await flush();
      expect(reads).toBe(2);
      jest.advanceTimersByTime(1_000);
      await flush();

      expect(reads).toBe(3);
      expect(ref.value()).toEqual({ reads: 3 });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([400, 403])(
    'does not read again after a read refused with %s',
    async (status) => {
      jest.useFakeTimers({ advanceTimers: true });
      try {
        let reads = 0;
        const { ref } = await viewOf(async () => {
          reads++;
          throw new HttpErrorResponse({ status });
        });

        jest.advanceTimersByTime(120_000);
        await flush();

        expect(reads).toBe(1);
        expect((ref.error() as HttpErrorResponse).status).toBe(status);
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('marks the object gone when its re-read answers 404, and keeps what was shown', async () => {
    let gone = false;
    const { ref, send } = await viewOf(async () => {
      if (gone) throw new HttpErrorResponse({ status: 404 });
      return { id: 'quote-1' };
    });
    expect(ref.gone()).toBe(false);

    gone = true;
    await send();

    expect(ref.gone()).toBe(true);
    expect(ref.value()).toEqual({ id: 'quote-1' });
  });

  it('leaves no retry behind when the view is gone before its re-read fails', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      let reads = 0;
      let fail: (() => void) | undefined;
      const { send } = await viewOf(async () => {
        reads++;
        if (reads === 2) {
          await new Promise<void>((_, reject) => {
            fail = () => reject(new HttpErrorResponse({ status: 503 }));
          });
        }
        return { reads };
      });
      await send();

      TestBed.resetTestingModule();
      fail?.();
      await flush();

      expect(jest.getTimerCount()).toBe(0);
      jest.advanceTimersByTime(60_000);
      await flush();
      expect(reads).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives the error of a first read that fails, with nothing to show', async () => {
    const failure = new HttpErrorResponse({ status: 500 });
    const { ref } = await viewOf(async () => {
      throw failure;
    });

    expect(ref.value()).toBeUndefined();
    expect(ref.error()).toBe(failure);
  });

  it('reads once more after a read still running, however many events came meanwhile', async () => {
    let reads = 0;
    let finish: (() => void) | undefined;
    const { ref, send } = await viewOf(async () => {
      reads++;
      if (reads === 2) {
        await new Promise<void>((r) => {
          finish = r;
        });
      }
      return { reads };
    });

    await send();
    // A background re-read keeps the data on screen: not a loading state.
    expect(ref.isLoading()).toBe(false);
    await send();
    await send();
    finish?.();
    await wait(10);

    expect(reads).toBe(3);
    expect(ref.value()).toEqual({ reads: 3 });
    expect(ref.isLoading()).toBe(false);
  });

  it('re-reads on every event of its kinds when it follows no one object', async () => {
    const { live } = setUp();
    let reads = 0;
    TestBed.runInInjectionContext(() =>
      liveResource(async () => ++reads, ['quote.sent']),
    );
    live.open();
    await flush();
    await wait(10);

    bodies[0]?.send(event('quote.sent', { id: 'request-1' }));
    await wait(400);
    bodies[0]?.send(event('quote.sent', { id: 'request-2' }));
    await wait(400);
    bodies[0]?.send(event('quote.withdrawn', { id: 'request-1' }));
    await wait(400);

    expect(reads).toBe(3);
  });

  it('says a read failed, a re-read after data included, until a read succeeds again', async () => {
    let fail = false;
    const { ref, send } = await viewOf(async () => {
      if (fail) throw new HttpErrorResponse({ status: 503 });
      return { ok: true };
    });
    expect(ref.failed()).toBe(false);

    fail = true;
    await send();
    expect(ref.failed()).toBe(true);

    fail = false;
    await send();
    expect(ref.failed()).toBe(false);
  });

  it('says the first read failed', async () => {
    const { ref } = await viewOf(async () => {
      throw new HttpErrorResponse({ status: 500 });
    });

    expect(ref.failed()).toBe(true);
  });
});

const headersOf = (call: number) =>
  ((fetchMock.mock.calls[call] as [string, RequestInit])[1].headers ??
    {}) as Record<string, string>;

const created = (position: string) =>
  `id: ${position}\nevent: notification.created\ndata: ${JSON.stringify({ at: '2026-10-19T12:00:00.000Z', id: `n-${position}`, kind: 'notification.created' })}\n\n`;

// @traces 1190-FR-008
describe('Live: where a stream picks up', () => {
  it('names no position on its first stream, and the latest it saw on every one after', async () => {
    jest.useFakeTimers();
    try {
      const { live } = setUp();
      live.open();
      await flush();

      bodies[0]?.send(created('5'));
      bodies[0]?.send(created('9'));
      bodies[0]?.send(event('live.test'));
      bodies[0]?.end();
      await flush();
      jest.advanceTimersByTime(3_500);
      await flush();

      expect(headersOf(0)).not.toHaveProperty('Last-Event-ID');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(headersOf(1)).toMatchObject({ 'Last-Event-ID': '9' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reopens at once after a planned reconnect, without renewing, and re-reads the views', async () => {
    const { live } = setUp();
    let resyncs = 0;
    live.resync.subscribe(() => resyncs++);
    live.open();
    await flush();
    bodies[0]?.send(created('3'));

    bodies[0]?.send(event('reconnect'));
    bodies[0]?.end();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renew).not.toHaveBeenCalled();
    expect(headersOf(1)).toMatchObject({
      Authorization: 'Bearer token-1',
      'Last-Event-ID': '3',
    });
    expect(resyncs).toBe(1);
    expect(live.state()).toBe('open');
  });
});

// @traces 1190-FR-006
describe('Live: the wait the server asks for', () => {
  it('waits the retry the server sent before its first reopen after a drop', async () => {
    jest.useFakeTimers();
    try {
      const { live } = setUp();
      live.open();
      await flush();
      bodies[0]?.send('retry: 3000\n\n');
      bodies[0]?.send(event('hello'));

      bodies[0]?.end();
      await flush();
      jest.advanceTimersByTime(2_999);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps its own backoff for the tries after that', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const { live } = setUp();
      live.open();
      await flush();
      bodies[0]?.send('retry: 3000\n\n');
      fetchMock.mockRejectedValueOnce(new TypeError('network'));
      bodies[0]?.end();
      await flush();
      jest.advanceTimersByTime(3_000);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(1_999);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(1);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });
});

// @traces 1190-FR-009
describe('Live: leaving the page for the back/forward cache', () => {
  it('closes its stream on pagehide, keeps it closed, and wants it again on pageshow from its latest position', async () => {
    jest.useFakeTimers();
    try {
      const { live } = setUp();
      live.open();
      await flush();
      bodies[0]?.send(created('12'));
      await flush();
      const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];

      window.dispatchEvent(new Event('pagehide'));
      bodies[0]?.end();
      await flush();
      jest.advanceTimersByTime(60_000);
      await flush();
      expect(first.signal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('pageshow'));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(headersOf(1)).toMatchObject({ 'Last-Event-ID': '12' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens nothing on pageshow when the stream was not wanted', async () => {
    const { live } = setUp();
    live.open();
    await flush();
    live.close();

    window.dispatchEvent(new Event('pageshow'));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Tabs of one browser, as Live services sharing the fakes.
function tabsOf(count: number) {
  const locks = withTabs();
  bodies = [];
  tokens = ['token-1', 'token-2', 'token-3'];
  renew = jest.fn(async () => {
    tokens.shift();
    return true;
  });
  fetchMock = jest.fn(async () => {
    const body = new Body();
    bodies.push(body);
    return { body: { getReader: () => body.reader }, ok: true, status: 200 };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      {
        provide: Session,
        useValue: {
          current: () => ({ id: 'a1', role: 'driver' }),
          renew,
          token: () => tokens[0],
        },
      },
    ],
  });
  const tabs = Array.from({ length: count }, () => {
    const live = TestBed.runInInjectionContext(() => new Live());
    const seen: LiveMessage[] = [];
    let resyncs = 0;
    live.events.subscribe((m) => seen.push(m));
    live.resync.subscribe(() => resyncs++);
    return {
      live,
      resyncs: () => resyncs,
      seen,
    };
  });
  return { locks, tabs };
}

// @traces 1190-FR-007
// @traces 1190-FR-010
describe('Live: one stream per browser', () => {
  afterEach(() => withoutTabs());

  it('opens one stream for two tabs, and the other tab hears its events and state', async () => {
    const { locks, tabs } = tabsOf(2);
    const [holder, follower] = tabs;

    holder?.live.open();
    await flush();
    follower?.live.open();
    await flush();
    bodies[0]?.send(event('hello'));
    bodies[0]?.send(event('live.test'));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(locks.isHeld('mf-live:a1:driver')).toBe(true);
    expect(follower?.seen.map((m) => m.kind)).toEqual(['hello', 'live.test']);
    expect(follower?.live.state()).toBe('open');
    expect(follower?.live.offline()).toBe(false);
  });

  it('keeps the lock through a drop, fans out reconnecting and the re-read, and reopens itself', async () => {
    jest.useFakeTimers();
    try {
      const { tabs } = tabsOf(2);
      const [holder, follower] = tabs;
      holder?.live.open();
      await flush();
      follower?.live.open();
      await flush();
      bodies[0]?.send(event('hello'));
      await flush();

      bodies[0]?.end();
      await flush();
      expect(follower?.live.state()).toBe('reconnecting');

      jest.advanceTimersByTime(1_200);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(follower?.live.state()).toBe('open');
      expect(follower?.resyncs()).toBe(1);
      expect(holder?.resyncs()).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the lock through a token renewal', async () => {
    const { locks, tabs } = tabsOf(2);
    const [holder, follower] = tabs;
    holder?.live.open();
    await flush();
    follower?.live.open();
    await flush();

    bodies[0]?.send(event('bye', { reason: 'expired' }));
    bodies[0]?.end();
    await flush();

    expect(renew).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(1)).toMatchObject({ Authorization: 'Bearer token-2' });
    expect(locks.isHeld('mf-live:a1:driver')).toBe(true);
  });

  it('hands the stream to the other tab when the holder closes, from the latest position either saw', async () => {
    const { tabs } = tabsOf(2);
    const [holder, follower] = tabs;
    holder?.live.open();
    await flush();
    follower?.live.open();
    await flush();
    bodies[0]?.send(event('hello'));
    bodies[0]?.send(created('7'));
    await flush();

    holder?.live.close();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(1)).toMatchObject({ 'Last-Event-ID': '7' });
    bodies[1]?.send(event('live.test'));
    await flush();
    expect(follower?.seen.at(-1)?.kind).toBe('live.test');
    expect(follower?.resyncs()).toBe(1);
  });

  it('lets the lock go when evicted', async () => {
    const { locks, tabs } = tabsOf(1);
    tabs[0]?.live.open();
    await flush();

    bodies[0]?.send(event('bye', { reason: 'evicted' }));
    bodies[0]?.end();
    await flush();

    expect(locks.isHeld('mf-live:a1:driver')).toBe(false);
    expect(tabs[0]?.live.state()).toBe('closed');
  });

  it('lets the lock go when the browser goes offline, so another tab may take it', async () => {
    const { tabs } = tabsOf(2);
    const [holder, follower] = tabs;
    holder?.live.open();
    await flush();
    follower?.live.open();
    await flush();
    const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];

    window.dispatchEvent(new Event('offline'));
    await flush();

    expect(first.signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('closes the stream and lets the lock go on pagehide, and takes it again on pageshow', async () => {
    const { locks, tabs } = tabsOf(1);
    tabs[0]?.live.open();
    await flush();
    bodies[0]?.send(created('4'));
    await flush();

    window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(locks.isHeld('mf-live:a1:driver')).toBe(false);

    window.dispatchEvent(new Event('pageshow'));
    await flush();
    expect(locks.isHeld('mf-live:a1:driver')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(1)).toMatchObject({ 'Last-Event-ID': '4' });
  });

  it('gives each tab its own stream where the browser cannot share one', async () => {
    withoutTabs();
    const { tabs } = tabsOf(2);
    withoutTabs();

    tabs[0]?.live.open();
    tabs[1]?.live.open();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

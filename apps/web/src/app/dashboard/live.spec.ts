import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';

import { Live, liveResource } from './live';
import { Session } from './session';

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
      { provide: Session, useValue: { renew, token: () => tokens[0] } },
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

  it.each([
    'expired',
    'shutdown',
  ])('renews the token and reconnects within 3 seconds after bye %s', async (reason) => {
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
  });

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
    const { live } = setUp();
    let reads = 0;
    const ref = TestBed.runInInjectionContext(() =>
      liveResource(
        async () => {
          reads++;
          return { id, reads };
        },
        ['quote.sent'],
        () => id,
      ),
    );
    live.open();
    await flush();
    await wait(10);
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
});

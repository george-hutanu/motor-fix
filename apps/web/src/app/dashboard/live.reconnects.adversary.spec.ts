import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';

import { Live } from './live';
import { Session } from './session';
import { FakeChannel, withoutTabs, withTabs } from '../live/tab-fakes.testing';

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
let fetchMock: jest.Mock;
let account: { id: string; role: string } | null;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setUp(count = 1) {
  bodies = [];
  account = { id: 'a1', role: 'driver' };
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
          current: () => account,
          renew: async () => true,
          token: () => 'token-1',
        },
      },
    ],
  });
  return Array.from({ length: count }, () => {
    const live = TestBed.runInInjectionContext(() => new Live());
    const seen: LiveMessage[] = [];
    live.events.subscribe((m) => seen.push(m));
    return { live, seen };
  });
}

const created = (position: string) =>
  `id: ${position}\nevent: notification.created\ndata: ${JSON.stringify({ at: '2026-10-19T12:00:00.000Z', id: `n-${position}`, kind: 'notification.created' })}\n\n`;

const lastEventId = (call: number) =>
  (
    (fetchMock.mock.calls[call] as [string, RequestInit])[1].headers as Record<
      string,
      string
    >
  )['Last-Event-ID'];

afterEach(() => {
  TestBed.resetTestingModule();
  withoutTabs();
});

// @traces 1190-FR-008
describe('Live: the position it keeps, hostile input', () => {
  it('sends the highest position seen, comparing numbers and not text', async () => {
    jest.useFakeTimers();
    try {
      const [{ live }] = setUp();
      live.open();
      await flush();
      for (const p of ['9', '10', '2', '009']) bodies[0]?.send(created(p));
      await flush();
      bodies[0]?.end();
      await flush();
      jest.advanceTimersByTime(5_000);
      await flush();

      expect(lastEventId(1)).toBe('10');
    } finally {
      jest.useRealTimers();
    }
  });

  it('tells two positions beyond 2^53 apart', async () => {
    jest.useFakeTimers();
    try {
      const [{ live }] = setUp();
      live.open();
      await flush();
      bodies[0]?.send(created('900719925474099301'));
      bodies[0]?.send(created('900719925474099302'));
      bodies[0]?.send(created('900719925474099300'));
      await flush();
      bodies[0]?.end();
      await flush();
      jest.advanceTimersByTime(5_000);
      await flush();

      expect(lastEventId(1)).toBe('900719925474099302');
    } finally {
      jest.useRealTimers();
    }
  });

  it('forgets the position and the server wait on close, so another account starts clean', async () => {
    jest.useFakeTimers();
    try {
      const [{ live }] = setUp();
      live.open();
      await flush();
      bodies[0]?.send(`retry: 9000\n\n${created('44')}`);
      await flush();
      live.close();

      live.open();
      await flush();

      expect(lastEventId(1)).toBeUndefined();
      bodies[1]?.end();
      await flush();
      jest.advanceTimersByTime(1_200);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not reopen before the retry the server asked for, and does at it', async () => {
    jest.useFakeTimers();
    try {
      const [{ live }] = setUp();
      live.open();
      await flush();
      bodies[0]?.send('retry: 3000\n\n');
      await flush();
      bodies[0]?.end();
      await flush();

      jest.advanceTimersByTime(2_899);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(101);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reopens at once after each of several planned reconnects, keeping the position', async () => {
    const [{ live }] = setUp();
    live.open();
    await flush();
    bodies[0]?.send(created('5'));
    for (let i = 0; i < 3; i++) {
      bodies[i]?.send(
        `event: reconnect\ndata: ${JSON.stringify({ at: '2026-10-19T12:00:00.000Z', id: 'c', kind: 'reconnect' })}\n\n`,
      );
      bodies[i]?.end();
      await flush();
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect([1, 2, 3].map(lastEventId)).toEqual(['5', '5', '5']);
  });
});

// @traces 1190-FR-009
describe('Live: pagehide and pageshow, out of order', () => {
  it('opens one stream however many pageshow events follow one pagehide', async () => {
    const [{ live }] = setUp();
    live.open();
    await flush();

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('pageshow'));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens nothing on pageshow when close was called while the page was hidden', async () => {
    const [{ live }] = setUp();
    live.open();
    await flush();
    window.dispatchEvent(new Event('pagehide'));
    live.close();

    window.dispatchEvent(new Event('pageshow'));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a single stream when the view opens again before pageshow', async () => {
    const [{ live }] = setUp();
    live.open();
    await flush();
    window.dispatchEvent(new Event('pagehide'));

    live.open();
    await flush();
    window.dispatchEvent(new Event('pageshow'));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports the state closed while hidden', async () => {
    const [{ live }] = setUp();
    live.open();
    await flush();
    bodies[0]?.send(created('1'));
    await flush();

    window.dispatchEvent(new Event('pagehide'));

    expect(live.state()).toBe('closed');
  });

  it('re-reads the open views on pageshow', async () => {
    const [{ live }] = setUp();
    let resyncs = 0;
    live.resync.subscribe(() => resyncs++);
    live.open();
    await flush();
    bodies[0]?.send(created('1'));
    await flush();

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    await flush();

    expect(resyncs).toBe(1);
  });
});

// @traces 1190-FR-007
describe('Live: handover between tabs', () => {
  beforeEach(() => withTabs());

  it('opens the stream in only one of three tabs', async () => {
    const tabs = setUp(3);

    for (const { live } of tabs) live.open();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hands the next tab the latest position, which it only heard from the holder', async () => {
    const [holder, follower, third] = setUp(3);
    holder?.live.open();
    await flush();
    follower?.live.open();
    third?.live.open();
    await flush();
    bodies[0]?.send(created('12'));
    await flush();

    holder?.live.close();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastEventId(1)).toBe('12');
  });

  it('gives each role its own stream', async () => {
    const [one, two] = setUp(2);
    one?.live.open();
    await flush();
    account = { id: 'a1', role: 'garage' };
    two?.live.open();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not reopen an evicted holder, and lets another tab try once', async () => {
    const tabs = setUp(2);
    for (const { live } of tabs) live.open();
    await flush();

    bodies[0]?.send(
      `event: bye\ndata: ${JSON.stringify({ at: '2026-10-19T12:00:00.000Z', id: 'b', kind: 'bye', reason: 'evicted' })}\n\n`,
    );
    bodies[0]?.end();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ends after every tab is evicted, without trading the stream forever', async () => {
    const tabs = setUp(3);
    for (const { live } of tabs) live.open();
    await flush();

    for (let i = 0; i < 6; i++) {
      bodies[i]?.send(
        `event: bye\ndata: ${JSON.stringify({ at: '2026-10-19T12:00:00.000Z', id: 'b', kind: 'bye', reason: 'evicted' })}\n\n`,
      );
      bodies[i]?.end();
      await flush();
    }

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('opens its own stream when the account is not known yet', async () => {
    const [{ live }] = setUp();
    account = null;

    live.open();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a message on the channel that is not one a holder sends', async () => {
    const [{ live, seen }, follower] = setUp(2);
    live.open();
    await flush();
    follower?.live.open();
    await flush();
    const stranger = new FakeChannel('mf-live:a1:driver');

    stranger.postMessage(null);
    stranger.postMessage({ type: 'message' });
    stranger.postMessage({ type: 'state' });
    await flush();

    expect(follower?.seen).toEqual([]);
    expect(follower?.live.state()).toBe('open');
    expect(seen).toEqual([]);
  });

  it('survives a position on the channel that is not a number', async () => {
    const [holder, follower] = setUp(2);
    holder?.live.open();
    await flush();
    follower?.live.open();
    await flush();
    const stranger = new FakeChannel('mf-live:a1:driver');
    const message = {
      at: '2026-10-19T12:00:00.000Z',
      id: 'x',
      kind: 'live.test',
    };
    const failures: unknown[] = [];
    const onError = (e: PromiseRejectionEvent | ErrorEvent) => failures.push(e);
    window.addEventListener('error', onError);

    stranger.postMessage({ message, position: 'abc', type: 'message' });
    await flush();
    window.removeEventListener('error', onError);
    holder?.live.close();
    await flush();

    expect(failures).toEqual([]);
    expect(lastEventId(1)).toBeUndefined();
  });
});

// @traces 1190-FR-010
describe('Live: without the browser primitives', () => {
  it('opens a stream per tab, each naming the position it saw', async () => {
    withoutTabs();
    const [one, two] = setUp(2);
    one?.live.open();
    two?.live.open();
    await flush();
    bodies[0]?.send(created('7'));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(two?.seen).toEqual([]);
    expect(lastEventId(0)).toBeUndefined();
  });
});

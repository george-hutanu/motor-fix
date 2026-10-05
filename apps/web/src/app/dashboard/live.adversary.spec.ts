import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';

import { Live } from './live';
import { Session } from './session';

globalThis.TextEncoder ??= NodeEncoder as typeof TextEncoder;
globalThis.TextDecoder ??= NodeDecoder as unknown as typeof TextDecoder;

class Body {
  private queue: Uint8Array[] = [];
  private waiting: ((r: ReadableStreamReadResult<Uint8Array>) => void) | null =
    null;
  private done = false;
  readonly reader = {
    cancel: async () => this.end(),
    read: () =>
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        const value = this.queue.shift();
        if (value !== undefined) resolve({ done: false, value });
        else if (this.done) resolve({ done: true, value: undefined });
        else this.waiting = resolve;
      }),
    releaseLock: () => undefined,
  };
  send(text: string | Uint8Array) {
    const value =
      typeof text === 'string' ? new TextEncoder().encode(text) : text;
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = null;
      waiting({ done: false, value });
    } else this.queue.push(value);
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
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setUp(response?: (body: Body) => unknown) {
  bodies = [];
  tokens = ['token-1', 'token-2', 'token-3', 'token-4'];
  renew = jest.fn(async () => {
    tokens.shift();
    return true;
  });
  fetchMock = jest.fn(async () => {
    const body = new Body();
    bodies.push(body);
    return (
      response?.(body) ?? {
        body: { getReader: () => body.reader },
        ok: true,
        status: 200,
      }
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: Session, useValue: { renew, token: () => tokens[0] } },
    ],
  });
  const live = TestBed.inject(Live);
  const seen: LiveMessage[] = [];
  live.events.subscribe((m) => seen.push(m));
  return { live, seen };
}

const event = (kind: string, extra: Record<string, string> = {}, id = 'e-1') =>
  `event: ${kind}\ndata: ${JSON.stringify({ at: '2026-10-04T12:00:00.000Z', id, kind, ...extra })}\n\n`;

const bye = (reason: string) => event('bye', { reason });

afterEach(() => {
  TestBed.resetTestingModule();
  jest.useRealTimers();
});

describe('Live reconnecting', () => {
  it('reconnects after every expiry, so a dashboard open for an hour stays live', async () => {
    jest.useFakeTimers();
    const { live } = setUp();
    live.open();
    await flush();

    for (let round = 1; round <= 3; round++) {
      bodies[round - 1]?.send(bye('expired'));
      bodies[round - 1]?.end();
      await flush();
      jest.advanceTimersByTime(3_000);
      await flush();
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(renew).toHaveBeenCalledTimes(3);
  });

  it('renews once when the stream ends twice after bye', async () => {
    jest.useFakeTimers();
    const { live } = setUp();
    live.open();
    await flush();

    bodies[0]?.send(bye('expired'));
    bodies[0]?.end();
    bodies[0]?.end();
    await flush();
    jest.advanceTimersByTime(3_000);
    await flush();

    expect(renew).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not reconnect when the stream drops without a bye', async () => {
    const { live } = setUp();
    live.open();
    await flush();

    bodies[0]?.send(event('hello'));
    bodies[0]?.end();
    await flush();
    await new Promise((r) => setTimeout(r, 50));

    expect(renew).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after a bye with a reason it does not know', async () => {
    const { live } = setUp();
    live.open();
    await flush();

    bodies[0]?.send(bye('banned'));
    bodies[0]?.end();
    await flush();
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect when closed while the renewal is still running', async () => {
    jest.useFakeTimers();
    const { live } = setUp();
    let finish: (ok: boolean) => void = () => undefined;
    renew.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    live.open();
    await flush();
    bodies[0]?.send(bye('expired'));
    bodies[0]?.end();
    await flush();

    live.close();
    finish(true);
    await flush();
    jest.advanceTimersByTime(10_000);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the stream it reconnected and opens no other when closed after a reconnect', async () => {
    jest.useFakeTimers();
    const { live } = setUp();
    live.open();
    await flush();
    bodies[0]?.send(bye('shutdown'));
    bodies[0]?.end();
    await flush();

    live.close();
    bodies.at(-1)?.end();
    jest.advanceTimersByTime(10_000);
    await flush();

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls.at(-1)?.[1].signal?.aborted).toBe(true);
  });

  it('does not reconnect when the renewal throws', async () => {
    const { live } = setUp();
    renew.mockRejectedValueOnce(new Error('refresh failed'));
    live.open();
    await flush();

    bodies[0]?.send(bye('expired'));
    bodies[0]?.end();
    await flush();
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps delivering events from the new stream to the same subscribers', async () => {
    jest.useFakeTimers();
    const { live, seen } = setUp();
    live.open();
    await flush();
    bodies[0]?.send(bye('shutdown'));
    bodies[0]?.end();
    await flush();
    jest.advanceTimersByTime(3_000);
    await flush();

    bodies[1]?.send(event('live.test', {}, 'e-9'));
    await flush();

    expect(seen.filter((m) => m.kind === 'live.test')).toHaveLength(1);
  });

  it('opens the reconnect with a stream that is not already aborted', async () => {
    jest.useFakeTimers();
    const { live } = setUp();
    live.open();
    await flush();
    bodies[0]?.send(bye('expired'));
    bodies[0]?.end();
    await flush();
    jest.advanceTimersByTime(3_000);
    await flush();

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(false);
  });
});

describe('Live failing connections', () => {
  it('does not throw or reconnect when the request rejects', async () => {
    const { live } = setUp();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(() => live.open()).not.toThrow();
    await flush();
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(renew).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])(
    'emits nothing and does not reconnect on a %s answer',
    async (status) => {
      const { live, seen } = setUp((body) => ({
        body: { getReader: () => body.reader },
        ok: false,
        status,
      }));

      live.open();
      await flush();
      await new Promise((r) => setTimeout(r, 50));

      expect(seen).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('does not throw when the response has no body', async () => {
    const { live, seen } = setUp(() => ({ body: null, ok: true, status: 200 }));

    expect(() => live.open()).not.toThrow();
    await flush();

    expect(seen).toEqual([]);
  });

  it('opens nothing when the access token is an empty string', async () => {
    const { live } = setUp();
    tokens = [''];

    live.open();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('can be opened again after a request that failed', async () => {
    const { live } = setUp();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    live.open();
    await flush();

    live.close();
    live.open();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Live closing', () => {
  it('closes without throwing before it was ever opened, and twice', () => {
    const { live } = setUp();

    expect(() => {
      live.close();
      live.close();
    }).not.toThrow();
  });

  it('emits nothing after it is closed', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();
    live.close();

    bodies[0]?.send(event('live.test'));
    await flush();

    expect(seen).toEqual([]);
  });

  it('never opens a connection when closed and asked to open on the server', async () => {
    bodies = [];
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: Session, useValue: { renew: jest.fn(), token: () => 'x' } },
      ],
    });
    const live = TestBed.inject(Live);

    live.open();
    live.close();
    live.open();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Live reading the stream', () => {
  it('reads CRLF line endings', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();

    bodies[0]?.send(event('live.test').replace(/\n/g, '\r\n'));
    await flush();

    expect(seen.map((m) => m.kind)).toEqual(['live.test']);
  });

  it('keeps reading after a data line that is not json', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();

    bodies[0]?.send('event: live.test\ndata: {nope\n\n');
    bodies[0]?.send(event('live.test', {}, 'e-2'));
    await flush();

    expect(seen.map((m) => m.id)).toEqual(['e-2']);
  });

  it('keeps reading after a block with no data line', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();

    bodies[0]?.send('event: live.test\n\n');
    bodies[0]?.send(event('live.test', {}, 'e-2'));
    await flush();

    expect(seen.map((m) => m.id)).toEqual(['e-2']);
  });

  it('reads a multibyte character split across two chunks', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();
    const bytes = new TextEncoder().encode(event('live.test', {}, 'ăâ-ț'));
    const cut = bytes.indexOf(0xc4) + 1;

    bodies[0]?.send(bytes.slice(0, cut));
    bodies[0]?.send(bytes.slice(cut));
    await flush();

    expect(seen.map((m) => m.id)).toEqual(['ăâ-ț']);
  });

  it('reads an event delivered one byte at a time', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();

    for (const byte of new TextEncoder().encode(event('live.test'))) {
      bodies[0]?.send(new Uint8Array([byte]));
    }
    await new Promise((resolve) => setTimeout(resolve));

    expect(seen.map((m) => m.kind)).toEqual(['live.test']);
  });

  it('reads many events in one chunk, in order', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();

    bodies[0]?.send(
      Array.from({ length: 500 }, (_, i) =>
        event('live.test', {}, `e-${i}`),
      ).join(''),
    );
    await flush();

    expect(seen.map((m) => m.id)).toEqual(
      Array.from({ length: 500 }, (_, i) => `e-${i}`),
    );
  });

  it('does not emit a half event when the stream ends in the middle of it', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();

    bodies[0]?.send(event('live.test').slice(0, 30));
    bodies[0]?.end();
    await flush();

    expect(seen).toEqual([]);
  });

  it('skips comment lines mixed into an event block', async () => {
    const { live, seen } = setUp();
    live.open();
    await flush();

    bodies[0]?.send(
      `: ping\nevent: live.test\n: ping\ndata: ${JSON.stringify({ at: 'a', id: 'e-3', kind: 'live.test' })}\n\n`,
    );
    await flush();

    expect(seen.map((m) => m.id)).toEqual(['e-3']);
  });
});

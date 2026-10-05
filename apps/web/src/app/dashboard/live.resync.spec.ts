import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Live, liveResource } from './live';
import { Session } from './session';

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

type Answer = 'open' | 'fail' | 401 | 503;

let bodies: Body[];
let answers: Answer[];
let fetchMock: jest.Mock;
let renew: jest.Mock;
let random: number;

const settle = () => jest.advanceTimersByTimeAsync(0);
const elapse = (ms: number) => jest.advanceTimersByTimeAsync(ms);

const event = (kind: string, extra: Record<string, string> = {}) =>
  `event: ${kind}\ndata: ${JSON.stringify({ at: '2026-10-05T12:00:00.000Z', id: 'e-1', kind, ...extra })}\n\n`;

// Each fetch takes the next answer; with none left, it opens.
function setUp() {
  bodies = [];
  answers = [];
  random = 0.5;
  jest.spyOn(Math, 'random').mockImplementation(() => random);
  renew = jest.fn(async () => true);
  fetchMock = jest.fn(async () => {
    const answer = answers.shift() ?? 'open';
    if (answer === 'fail') throw new TypeError('Failed to fetch');
    const body = new Body();
    bodies.push(body);
    if (typeof answer === 'number')
      return { body: null, ok: false, status: answer };
    return { body: { getReader: () => body.reader }, ok: true, status: 200 };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: Session, useValue: { renew, token: () => 'token' } },
    ],
  });
  const live = TestBed.inject(Live);
  let resyncs = 0;
  live.resync.subscribe(() => resyncs++);
  return { live, resyncs: () => resyncs };
}

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibility,
});
function show(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  jest.useFakeTimers();
  visibility = 'visible';
});
afterEach(() => {
  TestBed.inject(Live).close();
  TestBed.resetTestingModule();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the connection state', () => {
  it('is closed until opened, reconnecting until the stream answers, then open', async () => {
    const { live } = setUp();
    expect(live.state()).toBe('closed');

    answers = ['fail'];
    live.open();
    expect(live.state()).toBe('reconnecting');
    await settle();
    expect(live.state()).toBe('reconnecting');

    await elapse(1_000);
    expect(live.state()).toBe('open');
  });

  it('is closed again after close(), with no try left behind', async () => {
    const { live } = setUp();
    answers = ['fail'];
    live.open();
    await settle();

    live.close();
    await elapse(120_000);

    expect(live.state()).toBe('closed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is closed after bye evicted, and nothing reconnects', async () => {
    const { live } = setUp();
    live.open();
    await settle();

    bodies[0]?.send(event('bye', { reason: 'evicted' }));
    bodies[0]?.end();
    await elapse(120_000);

    expect(live.state()).toBe('closed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('reconnecting with backoff', () => {
  it('waits 1, 2, 5, 10 and then 30 seconds between failed tries', async () => {
    const { live } = setUp();
    answers = Array(8).fill('fail');
    live.open();
    await settle();

    for (const [wait, calls] of [
      [1_000, 2],
      [2_000, 3],
      [5_000, 4],
      [10_000, 5],
      [30_000, 6],
      [30_000, 7],
    ] as const) {
      await elapse(wait - 1);
      expect(fetchMock).toHaveBeenCalledTimes(calls - 1);
      await elapse(1);
      expect(fetchMock).toHaveBeenCalledTimes(calls);
    }
  });

  it.each([
    [0, 900],
    [0.999_999, 1_100],
  ])('moves each wait by up to 10%% (random %s waits %s ms)', async (value, wait) => {
    const { live } = setUp();
    random = value;
    answers = ['fail', 'fail'];
    live.open();
    await settle();

    await elapse(wait - 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await elapse(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('tries again with backoff after the request fails, an error answer, a stream with no body, or a drop', async () => {
    const { live } = setUp();
    answers = ['fail', 503];
    live.open();
    await settle();
    await elapse(1_000);
    await elapse(2_000);
    expect(live.state()).toBe('open');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    bodies.at(-1)?.end();
    await settle();
    expect(live.state()).toBe('reconnecting');
    await elapse(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(live.state()).toBe('open');
  });

  it('starts the sequence again once a stream opens', async () => {
    const { live } = setUp();
    answers = ['fail', 'fail', 'fail', 'open', 'fail'];
    live.open();
    await settle();
    await elapse(1_000 + 2_000 + 5_000);
    expect(live.state()).toBe('open');

    bodies.at(-1)?.end();
    await settle();
    await elapse(999);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await elapse(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('renews the token on a 401 and tries again at once, without counting a failure', async () => {
    const { live } = setUp();
    answers = [401];
    live.open();
    await settle();

    expect(renew).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(live.state()).toBe('open');
  });

  it('counts a second 401 straight after a renewal as a failure', async () => {
    const { live } = setUp();
    answers = [401, 401];
    live.open();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await elapse(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(live.state()).toBe('open');
  });

  it('is closed and stops when the renewal after a 401 is refused', async () => {
    const { live } = setUp();
    renew.mockResolvedValueOnce(false);
    answers = [401];
    live.open();
    await settle();
    await elapse(120_000);

    expect(live.state()).toBe('closed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a stream silent for 60 seconds as dropped', async () => {
    const { live } = setUp();
    live.open();
    await settle();

    await elapse(60_000);
    expect(live.state()).toBe('reconnecting');
    await elapse(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up on a request that gets no answer for 60 seconds and tries again', async () => {
    const { live } = setUp();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    live.open();
    await settle();

    await elapse(60_000);
    await elapse(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(live.state()).toBe('open');
  });

  it('keeps a stream that sends its heartbeat', async () => {
    const { live } = setUp();
    live.open();
    await settle();

    for (let i = 0; i < 5; i++) {
      await elapse(25_000);
      bodies[0]?.send(': ping\n\n');
    }
    await settle();

    expect(live.state()).toBe('open');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tries at once when the browser says the network is back', async () => {
    const { live } = setUp();
    answers = ['fail', 'fail', 'fail', 'fail'];
    live.open();
    await settle();
    await elapse(1_000 + 2_000 + 5_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    window.dispatchEvent(new Event('online'));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(live.state()).toBe('open');
  });
});

describe('polling while the stream cannot open', () => {
  it('polls after 3 failed tries: a re-read at once, then every 60 seconds', async () => {
    const { live, resyncs } = setUp();
    answers = Array(20).fill('fail');
    live.open();
    await settle();
    await elapse(1_000);
    expect(live.state()).toBe('reconnecting');
    expect(resyncs()).toBe(0);

    await elapse(2_000);
    expect(live.state()).toBe('polling');
    expect(resyncs()).toBe(1);

    await elapse(60_000);
    expect(resyncs()).toBe(2);
    await elapse(60_000);
    expect(resyncs()).toBe(3);
  });

  it('stops polling once a stream opens', async () => {
    const { live, resyncs } = setUp();
    answers = ['fail', 'fail', 'fail'];
    live.open();
    await settle();
    await elapse(1_000 + 2_000 + 5_000);
    expect(live.state()).toBe('open');
    const atOpen = resyncs();

    for (let i = 0; i < 7; i++) {
      await elapse(25_000);
      bodies.at(-1)?.send(': ping\n\n');
    }
    await settle();
    expect(live.state()).toBe('open');
    expect(resyncs()).toBe(atOpen);
  });
});

describe('catching up', () => {
  it('re-reads after a reconnect, never after the first open', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();
    expect(resyncs()).toBe(0);

    bodies[0]?.end();
    await settle();
    await elapse(1_000);

    expect(live.state()).toBe('open');
    expect(resyncs()).toBe(1);
  });

  it('re-reads after the renewal that follows bye expired', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();

    bodies[0]?.send(event('bye', { reason: 'expired' }));
    bodies[0]?.end();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resyncs()).toBe(1);
  });

  it('re-reads when asked to catch up', () => {
    const { live, resyncs } = setUp();

    live.catchUp();

    expect(resyncs()).toBe(1);
  });

  it('opens a fresh stream and re-reads when a tab hidden for 60 seconds or more is shown', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();

    show('hidden');
    for (let i = 0; i < 4; i++) {
      await elapse(20_000);
      bodies[0]?.send(': ping\n\n');
    }
    show('visible');
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(first.signal?.aborted).toBe(true);
    expect(live.state()).toBe('open');
    expect(resyncs()).toBe(1);
  });

  it('keeps its stream when the tab was hidden for less than 60 seconds', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();

    show('hidden');
    await elapse(30_000);
    bodies[0]?.send(': ping\n\n');
    show('visible');
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resyncs()).toBe(0);
  });

  it('tries at once, from the start of the sequence, when shown after a long sleep while failing', async () => {
    const { live } = setUp();
    answers = Array(6).fill('fail');
    live.open();
    await settle();
    show('hidden');
    await elapse(1_000 + 2_000 + 5_000 + 10_000 + 30_000 + 15_000);
    const before = fetchMock.mock.calls.length;

    show('visible');
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(before + 1);
  });
});

describe('the offline flag', () => {
  it('turns on after 10 seconds without a stream and off when one opens', async () => {
    const { live } = setUp();
    answers = Array(4).fill('fail');
    live.open();
    await settle();

    await elapse(9_999);
    expect(live.offline()).toBe(false);
    await elapse(1);
    expect(live.offline()).toBe(true);

    await elapse(8_000);
    expect(live.state()).toBe('open');
    expect(live.offline()).toBe(false);
  });

  it('stays off for a drop shorter than 10 seconds', async () => {
    const { live } = setUp();
    live.open();
    await settle();
    bodies[0]?.end();
    await settle();

    await elapse(1_000);
    await elapse(10_000);

    expect(live.state()).toBe('open');
    expect(live.offline()).toBe(false);
  });

  it('is off once closed', async () => {
    const { live } = setUp();
    answers = Array(10).fill('fail');
    live.open();
    await settle();
    await elapse(15_000);
    expect(live.offline()).toBe(true);

    live.close();

    expect(live.offline()).toBe(false);
  });
});

describe('liveResource catching up', () => {
  it('re-reads its view on every resync', async () => {
    const { live } = setUp();
    let reads = 0;
    const ref = TestBed.runInInjectionContext(() =>
      liveResource(
        async () => ({ id: 'r-1', reads: ++reads }),
        ['quote.sent'],
        () => 'r-1',
      ),
    );
    await settle();
    expect(reads).toBe(1);

    live.catchUp();
    await settle();

    expect(reads).toBe(2);
    expect(ref.value()).toEqual({ id: 'r-1', reads: 2 });
  });
});

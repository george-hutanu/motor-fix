import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import {
  createEnvironmentInjector,
  EnvironmentInjector,
  PLATFORM_ID,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Live, liveResource } from './live';
import { Session } from './session';

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

const okResponse = () => {
  const body = new Body();
  bodies.push(body);
  return { body: { getReader: () => body.reader }, ok: true, status: 200 };
};

function setUp() {
  bodies = [];
  answers = [];
  random = 0.5;
  jest.spyOn(Math, 'random').mockImplementation(() => random);
  renew = jest.fn(async () => true);
  fetchMock = jest.fn(async () => {
    const answer = answers.shift() ?? 'open';
    if (answer === 'fail') throw new TypeError('Failed to fetch');
    if (typeof answer === 'number')
      return { body: null, ok: false, status: answer };
    return okResponse();
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

describe('backoff edges', () => {
  it.each([
    [0, 27_000],
    [0.999_999, 33_000],
  ])(
    'keeps the 30 second wait inside 10%% either way (random %s waits %s ms)',
    async (value, wait) => {
      const { live } = setUp();
      answers = Array(10).fill('fail');
      live.open();
      await settle();
      random = 0.5;
      await elapse(1_000 + 2_000 + 5_000 + 10_000);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      random = value;
      answers = Array(10).fill('fail');
      await elapse(30_000);
      const before = fetchMock.mock.calls.length;

      await elapse(wait - 2);
      expect(fetchMock).toHaveBeenCalledTimes(before);
      await elapse(2);
      expect(fetchMock).toHaveBeenCalledTimes(before + 1);
    },
  );

  it('never goes beyond 33 seconds between tries however many have failed', async () => {
    const { live } = setUp();
    random = 1;
    answers = Array(40).fill('fail');
    live.open();
    await settle();
    await elapse(1_100 + 2_200 + 5_500 + 11_000 + 33_000);
    const before = fetchMock.mock.calls.length;

    for (let i = 0; i < 5; i++) await elapse(33_000);

    expect(fetchMock.mock.calls.length - before).toBe(5);
  });

  it('does not count a 401 as a failure when counting up to polling', async () => {
    const { live } = setUp();
    answers = ['fail', 401, 'fail'];
    live.open();
    await settle();
    await elapse(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(live.state()).toBe('reconnecting');

    answers = ['fail', 'fail'];
    await elapse(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await elapse(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(live.state()).toBe('polling');
  });

  it('is not polling after two failed tries', async () => {
    const { live, resyncs } = setUp();
    answers = ['fail', 'fail', 'fail'];
    live.open();
    await settle();
    await elapse(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(live.state()).toBe('reconnecting');
    expect(resyncs()).toBe(0);
  });

  it('renews and reconnects at once on every bye expired or shutdown, never polling', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();

    for (const reason of [
      'expired',
      'shutdown',
      'expired',
      'shutdown',
      'expired',
    ]) {
      bodies.at(-1)?.send(event('bye', { reason }));
      bodies.at(-1)?.end();
      await settle();
    }

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(live.state()).toBe('open');
    expect(resyncs()).toBe(5);
  });

  it('counts only the failed try after a bye expired, so the next wait is 1 second', async () => {
    const { live } = setUp();
    live.open();
    await settle();
    answers = ['fail'];

    bodies[0]?.send(event('bye', { reason: 'expired' }));
    bodies[0]?.end();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await elapse(999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await elapse(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('opens one stream when open is called twice', async () => {
    const { live } = setUp();

    live.open();
    live.open();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(live.state()).toBe('open');
  });
});

describe('nothing reconnects once it is not wanted', () => {
  it('ignores the browser coming online while closed', async () => {
    const { live } = setUp();

    window.dispatchEvent(new Event('online'));
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(live.state()).toBe('closed');
  });

  it('ignores a tab shown after a long sleep while closed', async () => {
    const { live } = setUp();

    show('hidden');
    await elapse(3_600_000);
    show('visible');
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(live.state()).toBe('closed');
  });

  it('ignores online and a long-hidden tab after bye evicted', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();
    bodies[0]?.send(event('bye', { reason: 'evicted' }));
    bodies[0]?.end();
    await settle();

    show('hidden');
    await elapse(120_000);
    show('visible');
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(live.state()).toBe('closed');
    expect(live.offline()).toBe(false);
    expect(resyncs()).toBe(0);
  });

  it('does not try on online after close() while a try waits on its backoff', async () => {
    const { live } = setUp();
    answers = ['fail', 'fail'];
    live.open();
    await settle();
    live.close();

    window.dispatchEvent(new Event('online'));
    await elapse(120_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(live.state()).toBe('closed');
  });

  it('stops polling after close()', async () => {
    const { live, resyncs } = setUp();
    answers = Array(20).fill('fail');
    live.open();
    await settle();
    await elapse(3_000);
    expect(live.state()).toBe('polling');
    const before = resyncs();

    live.close();
    await elapse(300_000);

    expect(resyncs()).toBe(before);
    expect(live.state()).toBe('closed');
  });

  it('shows no bar after a refused renewal however long it waits', async () => {
    const { live } = setUp();
    renew.mockResolvedValue(false);
    answers = [401];
    live.open();
    await settle();
    await elapse(120_000);

    expect(live.state()).toBe('closed');
    expect(live.offline()).toBe(false);
  });

  it('stays closed when a stream answers after close() was called', async () => {
    const { live, resyncs } = setUp();
    let release: (() => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(okResponse());
        }),
    );
    live.open();
    await settle();

    live.close();
    release?.();
    await settle();
    await elapse(120_000);

    expect(live.state()).toBe('closed');
    expect(resyncs()).toBe(0);
    expect(live.offline()).toBe(false);
  });

  it('aborts a request that never answers when closed', async () => {
    const { live } = setUp();
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined));
    live.open();
    await settle();

    live.close();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(true);
  });
});

describe('polling and the first open', () => {
  it('re-reads when the stream finally opens after polling, besides the poll', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();
    bodies[0]?.end();
    await settle();
    answers = ['fail', 'fail', 'fail', 'fail'];
    await elapse(3_000);
    expect(live.state()).toBe('polling');
    expect(resyncs()).toBe(1);

    answers = [];
    window.dispatchEvent(new Event('online'));
    await elapse(5_000);

    expect(live.state()).toBe('open');
    expect(resyncs()).toBe(2);
  });

  it('keeps polling every 60 seconds while tries keep failing for ten minutes', async () => {
    const { live, resyncs } = setUp();
    answers = Array(100).fill('fail');
    live.open();
    await settle();
    await elapse(3_000);
    const atEntry = resyncs();

    await elapse(600_000);

    expect(live.state()).toBe('polling');
    expect(resyncs() - atEntry).toBe(10);
  });

  it('does not re-read when the very first stream opens late', async () => {
    const { live, resyncs } = setUp();
    answers = ['fail', 'fail'];
    live.open();
    await settle();
    await elapse(1_000);
    await elapse(2_000);

    expect(live.state()).toBe('open');
    expect(resyncs()).toBe(0);
  });

  it('does not re-read on a failed try after a drop, only once a stream opens', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();
    answers = ['fail'];
    bodies[0]?.end();
    await settle();
    await elapse(1_000);
    expect(live.state()).toBe('reconnecting');
    expect(resyncs()).toBe(0);

    await elapse(2_000);
    expect(live.state()).toBe('open');
    expect(resyncs()).toBe(1);
  });

  it('re-reads again for each separate reconnect', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();

    for (let i = 1; i <= 3; i++) {
      bodies.at(-1)?.end();
      await settle();
      await elapse(1_000);
      expect(resyncs()).toBe(i);
    }
  });

  it('emits a re-read for every catch-up request, also while closed', () => {
    const { live, resyncs } = setUp();

    live.catchUp();
    live.catchUp();

    expect(resyncs()).toBe(2);
    expect(live.state()).toBe('closed');
  });
});

describe('a tab that sleeps', () => {
  async function hiddenFor(ms: number) {
    show('hidden');
    let left = ms;
    while (left > 0) {
      const step = Math.min(20_000, left);
      await elapse(step);
      left -= step;
      bodies.at(-1)?.send(': ping\n\n');
      await settle();
    }
    show('visible');
    await settle();
  }

  it('opens a fresh stream when hidden for exactly 60 seconds', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();

    await hiddenFor(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resyncs()).toBe(1);
  });

  it('keeps the stream when hidden for 59 seconds', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();

    await hiddenFor(59_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resyncs()).toBe(0);
  });

  it('does nothing when shown without having been hidden', async () => {
    const { live, resyncs } = setUp();
    live.open();
    await settle();

    show('visible');
    show('visible');
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resyncs()).toBe(0);
  });

  it('opens one fresh stream, not two, when shown twice after a long sleep', async () => {
    const { live } = setUp();
    live.open();
    await settle();

    await hiddenFor(120_000);
    show('visible');
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('measures the next sleep from its own hiding, not from the first', async () => {
    const { live } = setUp();
    live.open();
    await settle();
    await hiddenFor(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await hiddenFor(20_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops a stream that goes silent for 60 seconds but not at 59.9 seconds', async () => {
    const { live } = setUp();
    live.open();
    await settle();

    await elapse(59_900);
    expect(live.state()).toBe('open');
    await elapse(100);
    expect(live.state()).toBe('reconnecting');
  });

  it('treats an event as a byte that resets the silence timer', async () => {
    const { live } = setUp();
    live.open();
    await settle();

    await elapse(59_000);
    bodies[0]?.send(event('quote.sent', { id: 'e-2' }));
    await settle();
    await elapse(59_000);

    expect(live.state()).toBe('open');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the offline flag edges', () => {
  it('turns on 10 seconds after a drop, not before', async () => {
    const { live } = setUp();
    live.open();
    await settle();
    answers = Array(10).fill('fail');
    bodies[0]?.end();
    await settle();

    await elapse(9_999);
    expect(live.offline()).toBe(false);
    await elapse(1);
    expect(live.offline()).toBe(true);
  });

  it('counts the 10 seconds when the first request never answers', async () => {
    const { live } = setUp();
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined));
    live.open();
    await settle();

    await elapse(9_999);
    expect(live.offline()).toBe(false);
    await elapse(1);
    expect(live.offline()).toBe(true);
  });

  it('stays on while polling', async () => {
    const { live } = setUp();
    answers = Array(10).fill('fail');
    live.open();
    await settle();
    await elapse(3_000);
    expect(live.state()).toBe('polling');

    await elapse(60_000);

    expect(live.offline()).toBe(true);
  });

  it('goes off when the stream opens and stays off for the next short drop', async () => {
    const { live } = setUp();
    answers = ['fail', 'fail', 'fail', 'fail'];
    live.open();
    await settle();
    await elapse(12_000);
    expect(live.offline()).toBe(true);
    await elapse(30_000);
    expect(live.state()).toBe('open');
    expect(live.offline()).toBe(false);

    bodies.at(-1)?.end();
    await settle();
    await elapse(1_000);

    expect(live.offline()).toBe(false);
  });

  it('is off before anything is opened', () => {
    const { live } = setUp();

    expect(live.offline()).toBe(false);
  });
});

describe('liveResource catching up, hostile', () => {
  const make = (load: () => Promise<{ id: string; reads: number }>) =>
    TestBed.runInInjectionContext(() =>
      liveResource(load, ['quote.sent'], () => 'r-1'),
    );

  it('keeps the data and shows no error when a re-read on resync fails', async () => {
    const { live } = setUp();
    let reads = 0;
    const ref = make(async () => {
      reads++;
      if (reads > 1) throw new Error('down');
      return { id: 'r-1', reads };
    });
    await settle();
    expect(ref.value()).toEqual({ id: 'r-1', reads: 1 });

    live.catchUp();
    await settle();

    expect(reads).toBe(2);
    expect(ref.value()).toEqual({ id: 'r-1', reads: 1 });
    expect(ref.error()).toBeUndefined();
  });

  it('re-reads every open view, not only the first', async () => {
    const { live } = setUp();
    const reads = [0, 0, 0];
    for (const i of [0, 1, 2])
      make(async () => ({ id: 'r-1', reads: ++reads[i]! }));
    await settle();

    live.catchUp();
    await settle();

    expect(reads).toEqual([2, 2, 2]);
  });

  it('does not re-read a view that was destroyed', async () => {
    const { live } = setUp();
    let reads = 0;
    const child = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector),
    );
    child.runInContext(() =>
      liveResource(
        async () => ({ id: 'r-1', reads: ++reads }),
        ['quote.sent'],
        () => 'r-1',
      ),
    );
    await settle();
    expect(reads).toBe(1);

    child.destroy();
    live.catchUp();
    await settle();
    await elapse(120_000);

    expect(reads).toBe(1);
  });

  it('ends on the newest data when a resync arrives during a read', async () => {
    const { live } = setUp();
    let reads = 0;
    const releases: (() => void)[] = [];
    const ref = make(
      () =>
        new Promise((resolve) => {
          const n = ++reads;
          releases.push(() => resolve({ id: 'r-1', reads: n }));
        }),
    );
    await settle();

    live.catchUp();
    await settle();
    for (let i = 0; i < 5 && releases.length; i++) {
      releases.shift()?.();
      await settle();
    }

    expect(ref.value()?.reads).toBe(reads);
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it('re-reads once for a burst of ten catch-up requests in the same tick', async () => {
    const { live } = setUp();
    let reads = 0;
    make(async () => ({ id: 'r-1', reads: ++reads }));
    await settle();

    for (let i = 0; i < 10; i++) live.catchUp();
    await settle();
    await elapse(1_000);

    expect(reads).toBeLessThanOrEqual(3);
    expect(reads).toBeGreaterThanOrEqual(2);
  });
});

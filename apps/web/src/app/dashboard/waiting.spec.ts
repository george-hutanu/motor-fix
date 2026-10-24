import { deserialize, serialize } from 'node:v8';

// jsdom has no structuredClone, which IndexedDB needs to store a value.
globalThis.structuredClone ??= ((value: unknown) =>
  deserialize(serialize(value))) as typeof structuredClone;

import 'fake-indexeddb/auto';

import { HttpClient, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { PLATFORM_ID, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';
import { IDBFactory } from 'fake-indexeddb';
import { Subject, throwError } from 'rxjs';

import { Live, type LiveState } from './live';
import { Session } from './session';
import { Waiting } from './waiting';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

let account: WritableSignal<{ id: string } | null>;
let signedOut: Subject<string>;
let live: {
  catchUp: jest.Mock;
  offline: WritableSignal<boolean>;
  state: WritableSignal<LiveState>;
};
let online = true;
Object.defineProperty(window.navigator, 'onLine', {
  configurable: true,
  get: () => online,
});

async function start() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: Session, useValue: { current: account, signedOut } },
      { provide: Live, useValue: live },
    ],
  });
  await TestBed.inject(I18n).use('en');
  const waiting = TestBed.inject(Waiting);
  const http = TestBed.inject(HttpTestingController);
  TestBed.tick();
  return { http, waiting };
}

// A closed tab and a new one: the same IndexedDB, a new app.
async function reload() {
  TestBed.resetTestingModule();
  return start();
}

const pause = () => new Promise((r) => setTimeout(r, 1));

async function until(check: () => boolean) {
  for (let i = 0; i < 300 && !check(); i++) {
    TestBed.tick();
    await pause();
  }
  return check();
}

// match() takes the requests it returns, so it stops at the first find.
async function nextRequest(http: HttpTestingController): Promise<TestRequest> {
  let found: TestRequest[] = [];
  await until(() => {
    if (found.length === 0) found = http.match(() => true);
    return found.length > 0;
  });
  expect(found).toHaveLength(1);
  return found[0] as TestRequest;
}

const step = (n: number) => ({
  body: { done: true },
  method: 'POST' as const,
  url: `/api/v1/jobs/job-1/steps/step-${n}/done`,
});

const noAnswer = (req: TestRequest) =>
  req.error(new ProgressEvent('error'), { status: 0, statusText: '' });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  account = signal({ id: 'account-1' });
  signedOut = new Subject<string>();
  live = {
    catchUp: jest.fn(),
    offline: signal(false),
    state: signal<LiveState>('open'),
  };
  online = true;
  (toast as unknown as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('Waiting: sending', () => {
  it('sends an action at once to its own endpoint, with an Idempotency-Key, and lets it go once accepted', async () => {
    const { http, waiting } = await start();

    const key = await waiting.add('job.step', step(1));
    const req = await nextRequest(http);

    expect(req.request.method).toBe('POST');
    expect(req.request.url).toBe('/api/v1/jobs/job-1/steps/step-1/done');
    expect(req.request.body).toEqual({ done: true });
    expect(req.request.headers.get('Idempotency-Key')).toBe(key);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(waiting.actions().map((a) => a.state)).toEqual(['sent']);

    req.flush({});
    expect(await until(() => waiting.actions().length === 0)).toBe(true);
  });

  it('keeps an action that got no answer as waiting, and sends it again with the same key when the network is back', async () => {
    const { http, waiting } = await start();
    const key = await waiting.add('job.stage', {
      body: { stage: 'testing' },
      method: 'PATCH',
      url: '/api/v1/jobs/job-1/stage',
    });
    noAnswer(await nextRequest(http));
    expect(await until(() => waiting.actions()[0]?.state === 'waiting')).toBe(
      true,
    );

    window.dispatchEvent(new Event('online'));
    const again = await nextRequest(http);

    expect(again.request.headers.get('Idempotency-Key')).toBe(key);
    expect(again.request.method).toBe('PATCH');
  });

  it.each([401, 408, 429, 503])(
    'keeps the action waiting after a %s answer',
    async (status) => {
      const { http, waiting } = await start();
      await waiting.add('job.eta', {
        body: { at: '2026-10-05T16:00:00.000Z' },
        method: 'PUT',
        url: '/api/v1/jobs/job-1/eta',
      });

      (await nextRequest(http)).flush(null, { status, statusText: 'no' });

      expect(await until(() => waiting.actions()[0]?.state === 'waiting')).toBe(
        true,
      );
      expect(toast).not.toHaveBeenCalled();
    },
  );

  it('sends one action at a time, in the order they were made', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await waiting.add('job.step', step(2));

    const first = await nextRequest(http);
    expect(first.request.url).toContain('step-1');
    first.flush({});
    const second = await nextRequest(http);
    expect(second.request.url).toContain('step-2');
  });

  it('stops at an action that got no answer, so none overtakes it', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await waiting.add('job.step', step(2));

    noAnswer(await nextRequest(http));
    await until(() => waiting.actions()[0]?.state === 'waiting');
    await pause();
    expect(http.match(() => true)).toEqual([]);

    window.dispatchEvent(new Event('online'));
    const retried = await nextRequest(http);
    expect(retried.request.url).toContain('step-1');
  });

  it('sends the waiting actions when a live stream opens', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    noAnswer(await nextRequest(http));
    await until(() => waiting.actions()[0]?.state === 'waiting');

    live.state.set('reconnecting');
    TestBed.tick();
    live.state.set('open');
    const retried = await nextRequest(http);

    expect(retried.request.url).toContain('step-1');
  });

  it('tries a kept action again 60 seconds later on its own', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    const req = await nextRequest(http);
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      noAnswer(req);
      await jest.advanceTimersByTimeAsync(10);
      expect(waiting.actions()[0]?.state).toBe('waiting');

      await jest.advanceTimersByTimeAsync(59_000);
      expect(http.match(() => true)).toEqual([]);
      await jest.advanceTimersByTimeAsync(1_100);

      expect(http.match(() => true)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Waiting: kept across a reload', () => {
  it('keeps the waiting actions when the page is reloaded and sends them, in order, after it', async () => {
    const first = await start();
    const key = await first.waiting.add('job.step', step(1));
    await first.waiting.add('job.step', step(2));
    noAnswer(await nextRequest(first.http));
    await until(() => first.waiting.actions()[0]?.state === 'waiting');

    const { http, waiting } = await reload();
    expect(await until(() => waiting.actions().length === 2)).toBe(true);
    const sent = await nextRequest(http);

    expect(sent.request.url).toContain('step-1');
    expect(sent.request.headers.get('Idempotency-Key')).toBe(key);
    sent.flush({});
    expect((await nextRequest(http)).request.url).toContain('step-2');
  });

  it('never sends one account’s actions with another account signed in, and drops them', async () => {
    const first = await start();
    await first.waiting.add('job.step', step(1));
    noAnswer(await nextRequest(first.http));
    await until(() => first.waiting.actions()[0]?.state === 'waiting');

    account.set({ id: 'account-2' });
    const other = await reload();
    await pause();
    await until(() => false);
    expect(other.http.match(() => true)).toEqual([]);
    expect(other.waiting.actions()).toEqual([]);

    account.set({ id: 'account-1' });
    const back = await reload();
    await until(() => false);
    expect(back.http.match(() => true)).toEqual([]);
    expect(back.waiting.actions()).toEqual([]);
  });

  it('drops the account’s waiting actions at sign-out', async () => {
    const first = await start();
    await first.waiting.add('job.step', step(1));
    noAnswer(await nextRequest(first.http));
    await until(() => first.waiting.actions()[0]?.state === 'waiting');

    account.set(null);
    signedOut.next('account-1');
    await until(() => false);
    expect(first.waiting.actions()).toEqual([]);

    account.set({ id: 'account-1' });
    const { http } = await reload();
    await until(() => false);
    expect(http.match(() => true)).toEqual([]);
  });

  it('drops an action made more than 24 hours ago without sending it, and says so', async () => {
    const first = await start();
    const made = Date.now();
    await first.waiting.add('job.step', step(1));
    noAnswer(await nextRequest(first.http));
    await until(() => first.waiting.actions()[0]?.state === 'waiting');

    jest.spyOn(Date, 'now').mockReturnValue(made + 24 * 3_600_000 + 1_000);
    const { http, waiting } = await reload();

    expect(
      await until(() => (toast as unknown as jest.Mock).mock.calls.length > 0),
    ).toBe(true);
    expect(toast).toHaveBeenCalledWith(
      'An action made without signal expired and was not sent.',
    );
    expect(waiting.actions()).toEqual([]);
    expect(http.match(() => true)).toEqual([]);
  });

  it('says once, not per action, that actions expired', async () => {
    const first = await start();
    const made = Date.now();
    await first.waiting.add('job.step', step(1));
    await first.waiting.add('job.step', step(2));
    noAnswer(await nextRequest(first.http));
    await until(() => first.waiting.actions()[0]?.state === 'waiting');

    jest.spyOn(Date, 'now').mockReturnValue(made + 24 * 3_600_000 + 1_000);
    const { waiting } = await reload();
    await until(() => false);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(waiting.actions()).toEqual([]);
  });

  it('ignores a stored record it cannot send, so it never blocks the line', async () => {
    const first = await start();
    await first.waiting.add('job.step', step(1));
    noAnswer(await nextRequest(first.http));
    await until(() => first.waiting.actions()[0]?.state === 'waiting');
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('motor-fix', 1);
      request.onsuccess = () => {
        const tx = request.result.transaction('waiting', 'readwrite');
        tx.objectStore('waiting').put({
          account: 'account-1',
          key: 'broken',
          kind: 'job.step',
          madeAt: Date.now() - 60_000,
          seq: 0,
        });
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
    });

    const { http, waiting } = await reload();

    expect((await nextRequest(http)).request.url).toContain('step-1');
    expect(waiting.actions().map((a) => a.key)).not.toContain('broken');
  });

  it('still keeps actions for the life of the tab when IndexedDB is missing', async () => {
    const saved = globalThis.indexedDB;
    // A browser that blocks IndexedDB.
    Reflect.deleteProperty(globalThis, 'indexedDB');
    try {
      const { http, waiting } = await start();
      await waiting.add('job.step', step(1));
      noAnswer(await nextRequest(http));
      await until(() => waiting.actions()[0]?.state === 'waiting');

      window.dispatchEvent(new Event('online'));
      expect((await nextRequest(http)).request.url).toContain('step-1');
    } finally {
      globalThis.indexedDB = saved;
    }
  });
});

describe('Waiting: refused', () => {
  it.each([
    [
      423,
      { code: 'job_locked', detail: 'Elena, mecanic, lucra la această mașină' },
      'Elena, mecanic, lucra la această mașină',
    ],
    [409, null, 'This changed in the meantime. See how it stands now.'],
    [404, null, 'No longer available.'],
    [422, null, 'The action was not accepted.'],
  ])(
    'drops the action on a %s, says why, and re-reads every view',
    async (status, body, notice) => {
      const { http, waiting } = await start();
      await waiting.add('job.step', step(1));
      await waiting.add('job.step', step(2));

      (await nextRequest(http)).flush(body, { status, statusText: 'no' });

      expect(
        await until(
          () => (toast as unknown as jest.Mock).mock.calls.length > 0,
        ),
      ).toBe(true);
      expect(toast).toHaveBeenCalledWith(notice);
      expect(live.catchUp).toHaveBeenCalledTimes(1);
      expect((await nextRequest(http)).request.url).toContain('step-2');
      expect(waiting.actions().map((a) => a.url)).toEqual([step(2).url]);
    },
  );
});

describe('Waiting: a send that fails in the app', () => {
  it('drops the action and says so when the request cannot be made at all', async () => {
    const { http, waiting } = await start();
    const request = TestBed.inject(HttpClient).request.bind(
      TestBed.inject(HttpClient),
    );
    jest
      .spyOn(TestBed.inject(HttpClient), 'request')
      .mockImplementationOnce(() => throwError(() => new TypeError('broken')))
      .mockImplementation(request);
    await waiting.add('job.step', step(1));
    await waiting.add('job.step', step(2));

    expect((await nextRequest(http)).request.url).toContain('step-2');
    expect(toast).toHaveBeenCalledWith('The action was not accepted.');
    expect(waiting.actions().map((a) => a.url)).toEqual([step(2).url]);
  });
});

describe('Waiting: actions that need a connection', () => {
  it('says a connection is needed while the browser is offline', async () => {
    const { waiting } = await start();
    online = false;

    expect(waiting.connected()).toBe(false);
    expect(toast).toHaveBeenCalledWith('You need a connection for this');
  });

  it('says a connection is needed while the offline bar shows', async () => {
    const { waiting } = await start();
    live.offline.set(true);

    expect(waiting.connected()).toBe(false);
    expect(toast).toHaveBeenCalledWith('You need a connection for this');
  });

  it('lets the action go on, with no message, while connected', async () => {
    const { waiting } = await start();

    expect(waiting.connected()).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });
});

// @traces 532-FR-003
// @traces 532-FR-004
describe('Waiting: a refused renewal is not a sign-out', () => {
  async function waitingThenLapse() {
    const first = await start();
    const key = await first.waiting.add('job.step', step(1));
    noAnswer(await nextRequest(first.http));
    await until(() => first.waiting.actions()[0]?.state === 'waiting');
    account.set(null);
    await until(() => false);
    return { ...first, key };
  }

  it('keeps the actions through the lapse and sends them when the same account signs back in', async () => {
    const { http, key } = await waitingThenLapse();
    expect(http.match(() => true)).toEqual([]);

    account.set({ id: 'account-1' });
    const sent = await nextRequest(http);

    expect(sent.request.url).toContain('step-1');
    expect(sent.request.headers.get('Idempotency-Key')).toBe(key);
  });

  it('keeps them on the device too: a reload signed in as the same account sends them', async () => {
    await waitingThenLapse();

    account.set({ id: 'account-1' });
    const { http } = await reload();

    expect((await nextRequest(http)).request.url).toContain('step-1');
  });

  it('does not send them when another account signs in after the lapse, and drops them', async () => {
    const { http, waiting } = await waitingThenLapse();

    account.set({ id: 'account-2' });
    await until(() => false);
    expect(http.match(() => true)).toEqual([]);
    expect(waiting.actions()).toEqual([]);

    account.set({ id: 'account-1' });
    const back = await reload();
    await until(() => false);
    expect(back.http.match(() => true)).toEqual([]);
  });

  it('drops them when another account signs in after the lapse and a reload', async () => {
    await waitingThenLapse();

    account.set({ id: 'account-2' });
    const other = await reload();
    await until(() => false);
    expect(other.http.match(() => true)).toEqual([]);

    account.set({ id: 'account-1' });
    const back = await reload();
    await until(() => false);
    expect(back.http.match(() => true)).toEqual([]);
    expect(back.waiting.actions()).toEqual([]);
  });

  it('drops them when the lapse is followed by a sign-out', async () => {
    const { waiting } = await waitingThenLapse();

    signedOut.next('account-1');
    await until(() => false);
    account.set({ id: 'account-1' });
    const { http } = await reload();
    await until(() => false);

    expect(waiting.actions()).toEqual([]);
    expect(http.match(() => true)).toEqual([]);
  });
});

// @traces 532-FR-005
describe('Waiting: a send that never answers', () => {
  // Fake timers from the start, so the send's time limit is a fake one too.
  async function hanging() {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const parts = await start();
    await parts.waiting.add('job.step', step(1));
    await parts.waiting.add('job.step', step(2));
    await jest.advanceTimersByTimeAsync(10);
    const [first] = parts.http.match(() => true);
    if (!first) throw new Error('nothing was sent');
    return { ...parts, first };
  }

  const sentAfter = async (http: HttpTestingController, ms: number) => {
    await jest.advanceTimersByTimeAsync(ms);
    TestBed.tick();
    await jest.advanceTimersByTimeAsync(10);
    return http.match(() => true);
  };

  afterEach(() => jest.useRealTimers());

  it('gives up at 30 seconds, keeps the action first in line as waiting and sends nothing after it', async () => {
    const { first, http, waiting } = await hanging();

    expect(await sentAfter(http, 29_000)).toEqual([]);
    expect(first.cancelled).toBe(false);
    expect(await sentAfter(http, 1_100)).toEqual([]);

    expect(first.cancelled).toBe(true);
    expect(waiting.actions().map((a) => [a.url, a.state])).toEqual([
      [step(1).url, 'waiting'],
      [step(2).url, 'waiting'],
    ]);
  });

  it('sends it again with the same key 60 seconds after the attempt ended', async () => {
    const { first, http } = await hanging();
    await sentAfter(http, 30_100);

    expect(await sentAfter(http, 59_000)).toEqual([]);
    const again = await sentAfter(http, 1_100);

    expect(again).toHaveLength(1);
    expect(again[0]?.request.url).toContain('step-1');
    expect(again[0]?.request.headers.get('Idempotency-Key')).toBe(
      first.request.headers.get('Idempotency-Key'),
    );
  });

  it('sends it again when the network is back', async () => {
    const { http } = await hanging();
    await sentAfter(http, 30_100);

    window.dispatchEvent(new Event('online'));
    const again = await sentAfter(http, 10);

    expect(again).toHaveLength(1);
    expect(again[0]?.request.url).toContain('step-1');
  });

  it('sends it again when a live stream opens', async () => {
    const { http } = await hanging();
    await sentAfter(http, 30_100);

    live.state.set('reconnecting');
    TestBed.tick();
    live.state.set('open');
    const again = await sentAfter(http, 10);

    expect(again).toHaveLength(1);
    expect(again[0]?.request.url).toContain('step-1');
  });
});

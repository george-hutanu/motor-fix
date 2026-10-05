import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { PLATFORM_ID, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { Live, type LiveState } from './live';
import { Session } from './session';
import { Waiting } from './waiting';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const toasts = toast as unknown as jest.Mock;

let account: WritableSignal<{ id: string } | null>;
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

const settle = async () => {
  TestBed.tick();
  await jest.advanceTimersByTimeAsync(5);
  TestBed.tick();
};
const elapse = async (ms: number) => {
  await jest.advanceTimersByTimeAsync(ms);
  TestBed.tick();
};

async function start() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: Session, useValue: { current: account } },
      { provide: Live, useValue: live },
    ],
  });
  await TestBed.inject(I18n).use('en');
  const waiting = TestBed.inject(Waiting);
  const http = TestBed.inject(HttpTestingController);
  await settle();
  return { http, waiting };
}

const take = (http: HttpTestingController): TestRequest[] =>
  http.match(() => true);

const step = (n: number) => ({
  body: { done: true },
  method: 'POST' as const,
  url: `/api/v1/jobs/job-1/steps/step-${n}/done`,
});

const noAnswer = (req: TestRequest) =>
  req.error(new ProgressEvent('error'), { status: 0, statusText: '' });

const eta = {
  body: { at: '2026-10-05T16:00:00.000Z' },
  method: 'PUT' as const,
  url: '/api/v1/jobs/job-1/eta',
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  jest.setSystemTime(new Date('2026-10-05T10:00:00.000Z'));
  account = signal({ id: 'account-1' });
  live = {
    catchUp: jest.fn(),
    offline: signal(false),
    state: signal<LiveState>('open'),
  };
  online = true;
  toasts.mockClear();
});

afterEach(() => {
  TestBed.resetTestingModule();
  jest.useRealTimers();
});

describe('Waiting: order and one at a time', () => {
  it('sends nothing while an answer is awaited, however many moments come', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await settle();
    const first = take(http);
    expect(first).toHaveLength(1);

    await waiting.add('job.step', step(2));
    window.dispatchEvent(new Event('online'));
    live.state.set('reconnecting');
    await settle();
    live.state.set('open');
    await settle();
    await elapse(120_000);

    expect(take(http)).toEqual([]);
    expect(waiting.actions().map((a) => a.state)).toEqual(['sent', 'waiting']);
  });

  it('sends fifty actions in the order they were made, each after the answer to the one before', async () => {
    const { http, waiting } = await start();
    for (let n = 1; n <= 50; n++) await waiting.add('job.step', step(n));

    for (let n = 1; n <= 50; n++) {
      await settle();
      const found = take(http);
      expect(found).toHaveLength(1);
      expect(found[0]?.request.url).toBe(step(n).url);
      found[0]?.flush({});
    }
    await settle();

    expect(waiting.actions()).toEqual([]);
    expect(take(http)).toEqual([]);
  });

  it('keeps call order when several actions are added without waiting between them', async () => {
    const { http, waiting } = await start();

    const keys = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => waiting.add('job.step', step(n))),
    );
    expect(new Set(keys).size).toBe(5);

    for (let n = 1; n <= 5; n++) {
      await settle();
      const found = take(http);
      expect(found.map((r) => r.request.url)).toEqual([step(n).url]);
      found[0]?.flush({});
    }
  });

  it('gives each action its own key, and the same key on every resend', async () => {
    const { http, waiting } = await start();
    const a = await waiting.add('job.step', step(1));
    const b = await waiting.add('job.step', step(2));
    expect(a).not.toBe(b);

    const seen: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      await settle();
      const [req] = take(http);
      seen.push(req?.request.headers.get('Idempotency-Key') ?? null);
      if (req) noAnswer(req);
      await settle();
      window.dispatchEvent(new Event('online'));
    }

    expect(seen).toEqual([a, a, a]);
  });

  it('resends the same method, url and body it was given', async () => {
    const { http, waiting } = await start();
    const body = { nested: { list: [1, 2, null] }, note: 'ștergere ✓ 😀' };
    await waiting.add('job.stage', {
      body,
      method: 'PATCH',
      url: '/api/v1/jobs/job-ă/stage?x=1&y=2',
    });
    await settle();
    noAnswer(take(http)[0] as TestRequest);
    await settle();

    window.dispatchEvent(new Event('online'));
    await settle();
    const [again] = take(http);

    expect(again?.request.method).toBe('PATCH');
    expect(again?.request.urlWithParams).toBe(
      '/api/v1/jobs/job-ă/stage?x=1&y=2',
    );
    expect(again?.request.body).toEqual(body);
  });

  it('accepts an empty 204 answer and lets the action go', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.eta', eta);
    await settle();

    take(http)[0]?.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(waiting.actions()).toEqual([]);
    expect(toasts).not.toHaveBeenCalled();
    expect(live.catchUp).not.toHaveBeenCalled();
  });

  it('does not send when the browser says online with nothing waiting', async () => {
    const { http } = await start();

    window.dispatchEvent(new Event('online'));
    live.state.set('reconnecting');
    await settle();
    live.state.set('open');
    await elapse(180_000);

    expect(take(http)).toEqual([]);
  });
});

describe('Waiting: answers that keep an action', () => {
  it.each([
    0, 401, 408, 429, 500, 502, 503, 504, 599,
  ])('keeps the action waiting after %s with no notice and no re-read', async (status) => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await settle();

    const req = take(http)[0] as TestRequest;
    if (status === 0) noAnswer(req);
    else req.flush(null, { status, statusText: 'x' });
    await settle();

    expect(waiting.actions().map((a) => a.state)).toEqual(['waiting']);
    expect(toasts).not.toHaveBeenCalled();
    expect(live.catchUp).not.toHaveBeenCalled();
  });

  it('tries a kept action again every 60 seconds, not sooner', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await settle();
    noAnswer(take(http)[0] as TestRequest);

    for (let i = 0; i < 3; i++) {
      await elapse(59_000);
      expect(take(http)).toEqual([]);
      await elapse(1_100);
      const found = take(http);
      expect(found).toHaveLength(1);
      noAnswer(found[0] as TestRequest);
    }
  });

  it('does not send a stray retry after the action was accepted', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await settle();
    noAnswer(take(http)[0] as TestRequest);
    await settle();

    window.dispatchEvent(new Event('online'));
    await settle();
    take(http)[0]?.flush({});
    await settle();
    await elapse(300_000);

    expect(take(http)).toEqual([]);
    expect(waiting.actions()).toEqual([]);
  });

  it('keeps the first action first when it is kept, so a later one is not sent', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await waiting.add('job.step', step(2));
    await settle();

    take(http)[0]?.flush(null, { status: 503, statusText: 'x' });
    await settle();
    await elapse(10_000);

    expect(take(http)).toEqual([]);
    expect(waiting.actions().map((a) => a.url)).toEqual([
      step(1).url,
      step(2).url,
    ]);
  });
});

describe('Waiting: answers that refuse an action', () => {
  it.each([
    [400, 'The action was not accepted.'],
    [403, 'The action was not accepted.'],
    [405, 'The action was not accepted.'],
    [410, 'The action was not accepted.'],
    [418, 'The action was not accepted.'],
    [422, 'The action was not accepted.'],
    [499, 'The action was not accepted.'],
    [409, 'This changed in the meantime. See how it stands now.'],
    [404, 'No longer available.'],
  ])('drops the action on %s with the generic notice and goes on to the next', async (status, notice) => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await waiting.add('job.step', step(2));
    await settle();

    take(http)[0]?.flush(null, { status, statusText: 'x' });
    await settle();

    expect(toasts).toHaveBeenCalledTimes(1);
    expect(toasts).toHaveBeenCalledWith(notice);
    expect(live.catchUp).toHaveBeenCalledTimes(1);
    expect(take(http).map((r) => r.request.url)).toEqual([step(2).url]);
  });

  it('shows the API detail for a 404 and a 409 too', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await waiting.add('job.step', step(2));
    await settle();

    take(http)[0]?.flush(
      { code: 'job_gone', detail: 'Lucrarea a fost ștearsă' },
      { status: 404, statusText: 'x' },
    );
    await settle();
    take(http)[0]?.flush(
      { code: 'job_changed', detail: 'Altcineva a schimbat etapa' },
      { status: 409, statusText: 'x' },
    );
    await settle();

    expect(toasts.mock.calls.map((c) => c[0])).toEqual([
      'Lucrarea a fost ștearsă',
      'Altcineva a schimbat etapa',
    ]);
  });

  it.each([
    ['an empty detail', { detail: '' }],
    ['a detail that is a number', { detail: 42 }],
    ['a detail that is null', { detail: null }],
    ['no detail at all', { code: 'x' }],
    ['a body that is a plain string', 'Bad Request'],
    ['an HTML body', '<html><body>nope</body></html>'],
  ])('falls back to the generic notice with %s', async (_name, body) => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await settle();

    take(http)[0]?.flush(body, { status: 422, statusText: 'x' });
    await settle();

    expect(toasts).toHaveBeenCalledWith('The action was not accepted.');
    expect(waiting.actions()).toEqual([]);
  });

  it('re-reads every view once per refused action, not for an accepted one', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await waiting.add('job.step', step(2));
    await waiting.add('job.step', step(3));
    await settle();

    take(http)[0]?.flush({});
    await settle();
    take(http)[0]?.flush(null, { status: 409, statusText: 'x' });
    await settle();
    take(http)[0]?.flush({});
    await settle();

    expect(live.catchUp).toHaveBeenCalledTimes(1);
    expect(waiting.actions()).toEqual([]);
  });
});

describe('Waiting: the 24 hour limit', () => {
  async function keepFor(ms: number) {
    const { http, waiting } = await start();
    const made = Date.now();
    await waiting.add('job.step', step(1));
    await settle();
    noAnswer(take(http)[0] as TestRequest);
    await settle();
    jest.setSystemTime(made + ms);
    window.dispatchEvent(new Event('online'));
    await settle();
    return { http, waiting };
  }

  it('still sends an action that is exactly 24 hours old', async () => {
    const { http, waiting } = await keepFor(24 * 3_600_000);

    expect(take(http)).toHaveLength(1);
    expect(toasts).not.toHaveBeenCalled();
    expect(waiting.actions()).toHaveLength(1);
  });

  it('drops an action one millisecond past 24 hours without sending it', async () => {
    const { http, waiting } = await keepFor(24 * 3_600_000 + 1);

    expect(take(http)).toEqual([]);
    expect(toasts).toHaveBeenCalledTimes(1);
    expect(toasts).toHaveBeenCalledWith(
      'An action made without signal expired and was not sent.',
    );
    expect(waiting.actions()).toEqual([]);
  });

  it('drops an expired first action and still sends a newer one behind it', async () => {
    const { http, waiting } = await start();
    const made = Date.now();
    await waiting.add('job.step', step(1));
    await settle();
    noAnswer(take(http)[0] as TestRequest);
    await settle();
    jest.setSystemTime(made + 23 * 3_600_000);
    await waiting.add('job.step', step(2));
    await settle();
    noAnswer(take(http)[0] as TestRequest);
    await settle();
    jest.setSystemTime(made + 25 * 3_600_000);

    window.dispatchEvent(new Event('online'));
    await settle();

    expect(toasts).toHaveBeenCalledTimes(1);
    expect(take(http).map((r) => r.request.url)).toEqual([step(2).url]);
    expect(waiting.actions().map((a) => a.url)).toEqual([step(2).url]);
  });

  it('says it once for several expired actions in a row, or once each, never none', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await waiting.add('job.step', step(2));
    await waiting.add('job.step', step(3));
    await settle();
    noAnswer(take(http)[0] as TestRequest);
    await settle();
    jest.setSystemTime(Date.now() + 25 * 3_600_000);

    window.dispatchEvent(new Event('online'));
    await settle();

    expect(take(http)).toEqual([]);
    expect(waiting.actions()).toEqual([]);
    expect(toasts.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of toasts.mock.calls)
      expect(call[0]).toBe(
        'An action made without signal expired and was not sent.',
      );
  });
});

describe('Waiting: accounts and sign-out', () => {
  it('drops the waiting actions at sign-out and never sends them for the next sign-in', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await settle();
    noAnswer(take(http)[0] as TestRequest);
    await settle();

    account.set(null);
    await settle();
    account.set({ id: 'account-1' });
    await settle();
    window.dispatchEvent(new Event('online'));
    await elapse(120_000);

    expect(waiting.actions()).toEqual([]);
    expect(take(http)).toEqual([]);
  });

  it('does not send one account’s action once another account is signed in', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await settle();
    noAnswer(take(http)[0] as TestRequest);
    await settle();

    account.set({ id: 'account-2' });
    await settle();
    window.dispatchEvent(new Event('online'));
    live.state.set('reconnecting');
    await settle();
    live.state.set('open');
    await elapse(120_000);

    expect(take(http)).toEqual([]);
    expect(waiting.actions()).toEqual([]);
  });

  it('does not bring an action back when its answer arrives after sign-out', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await settle();
    const req = take(http)[0] as TestRequest;

    account.set(null);
    await settle();
    req.flush(null, { status: 503, statusText: 'x' });
    await settle();
    await elapse(180_000);

    expect(waiting.actions()).toEqual([]);
    expect(take(http)).toEqual([]);
  });

  it('shows no refusal notice for a signed-out account’s answer', async () => {
    const { http, waiting } = await start();
    await waiting.add('job.step', step(1));
    await settle();
    const req = take(http)[0] as TestRequest;

    account.set(null);
    await settle();
    req.flush(null, { status: 409, statusText: 'x' });
    await settle();

    expect(toasts).not.toHaveBeenCalled();
    expect(live.catchUp).not.toHaveBeenCalled();
  });
});

describe('Waiting: kinds and the connection gate', () => {
  it('says a connection is needed on every ask while offline, and sends nothing', async () => {
    const { http, waiting } = await start();
    online = false;

    expect(waiting.connected()).toBe(false);
    expect(waiting.connected()).toBe(false);

    expect(toasts).toHaveBeenCalledTimes(2);
    expect(toasts).toHaveBeenNthCalledWith(1, 'You need a connection for this');
    expect(toasts).toHaveBeenNthCalledWith(2, 'You need a connection for this');
    expect(waiting.actions()).toEqual([]);
    expect(take(http)).toEqual([]);
  });

  it('refuses when only the offline bar shows, and again when only the browser says offline', async () => {
    const { waiting } = await start();

    live.offline.set(true);
    expect(waiting.connected()).toBe(false);
    live.offline.set(false);
    online = false;
    expect(waiting.connected()).toBe(false);

    expect(toasts).toHaveBeenCalledTimes(2);
  });

  it('is connected while reconnecting or polling but with no bar and a browser online', async () => {
    const { waiting } = await start();

    live.state.set('reconnecting');
    expect(waiting.connected()).toBe(true);
    live.state.set('polling');
    expect(waiting.connected()).toBe(true);

    expect(toasts).not.toHaveBeenCalled();
  });

  it('says a connection is needed no more once the bar has gone', async () => {
    const { waiting } = await start();
    live.offline.set(true);
    expect(waiting.connected()).toBe(false);
    toasts.mockClear();

    live.offline.set(false);

    expect(waiting.connected()).toBe(true);
    expect(toasts).not.toHaveBeenCalled();
  });
});

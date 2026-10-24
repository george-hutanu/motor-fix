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
import { Subject } from 'rxjs';

import { Live, type LiveState } from './live';
import { Session } from './session';
import { Waiting } from './waiting';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const toasts = toast as unknown as jest.Mock;

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
      { provide: Session, useValue: { current: account, signedOut } },
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

const _eta = {
  body: { at: '2026-10-05T16:00:00.000Z' },
  method: 'PUT' as const,
  url: '/api/v1/jobs/job-1/eta',
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  jest.setSystemTime(new Date('2026-10-05T10:00:00.000Z'));
  account = signal({ id: 'account-1' });
  signedOut = new Subject<string>();
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

const urls = (reqs: TestRequest[]) => reqs.map((r) => r.request.url);

// @traces 532-FR-005
describe('Waiting: the 30 second bound', () => {
  async function sendingOne() {
    const parts = await start();
    const key = await parts.waiting.add('job.step', step(1));
    await settle();
    const [first] = take(parts.http);
    return { ...parts, first: first as TestRequest, key };
  }

  it('keeps awaiting at 29.9 seconds and gives up at 30', async () => {
    const { waiting } = await sendingOne();

    await elapse(29_900);
    expect(waiting.actions().map((a) => a.state)).toEqual(['sent']);
    await elapse(200);

    expect(waiting.actions().map((a) => a.state)).toEqual(['waiting']);
  });

  it('aborts the request at the bound and shows no notice', async () => {
    const { first } = await sendingOne();

    await elapse(30_100);

    expect(first.cancelled).toBe(true);
    expect(toasts).not.toHaveBeenCalled();
    expect(live.catchUp).not.toHaveBeenCalled();
  });

  it('sends it again 60 seconds after the attempt ended, not 60 after it began', async () => {
    const { http, key } = await sendingOne();

    await elapse(30_100);
    await elapse(59_000);
    expect(take(http)).toEqual([]);
    await elapse(1_500);
    const again = take(http);

    expect(again).toHaveLength(1);
    expect(again[0]?.request.headers.get('Idempotency-Key')).toBe(key);
  });

  it('sends it again on an online event, with the same key, and not the one behind it', async () => {
    const { http, key, waiting } = await sendingOne();
    await waiting.add('job.step', step(2));
    await elapse(30_100);
    expect(take(http)).toEqual([]);

    window.dispatchEvent(new Event('online'));
    await settle();
    const again = take(http);

    expect(urls(again)).toEqual([step(1).url]);
    expect(again[0]?.request.headers.get('Idempotency-Key')).toBe(key);
  });

  it('sends it again when a live stream opens', async () => {
    const { http } = await sendingOne();
    await elapse(30_100);
    live.state.set('reconnecting');
    await settle();

    live.state.set('open');
    await settle();

    expect(urls(take(http))).toEqual([step(1).url]);
  });

  it('gives each action its own 30 seconds from the start of its request', async () => {
    const { http, waiting } = await sendingOne();
    await waiting.add('job.step', step(2));
    await elapse(10_000);
    take(http);

    window.dispatchEvent(new Event('online'));
    await elapse(30_100);
    window.dispatchEvent(new Event('online'));
    await settle();
    take(http);
    await elapse(29_000);

    expect(waiting.actions().map((a) => a.state)).toEqual(['sent', 'waiting']);
  });

  it('lets an answer at 29.9 seconds count, and the next action goes', async () => {
    const { first, http, waiting } = await sendingOne();
    await waiting.add('job.step', step(2));

    await elapse(29_900);
    first.flush({});
    await settle();

    expect(urls(take(http))).toEqual([step(2).url]);
    expect(waiting.actions().map((a) => a.url)).toEqual([step(2).url]);
  });

  it('keeps timing out and resending, never losing the action, through five bounds', async () => {
    const { http, waiting } = await sendingOne();

    for (let i = 0; i < 5; i++) {
      await elapse(30_100);
      window.dispatchEvent(new Event('online'));
      await settle();
      expect(take(http)).toHaveLength(1);
    }

    expect(waiting.actions()).toHaveLength(1);
  });

  it('drops the action of an account that signed out while it was hanging, and never resends it', async () => {
    const { http, waiting } = await sendingOne();

    account.set(null);
    signedOut.next('account-1');
    await settle();
    await elapse(30_100);
    account.set({ id: 'account-1' });
    await settle();
    window.dispatchEvent(new Event('online'));
    await elapse(120_000);

    expect(take(http)).toEqual([]);
    expect(waiting.actions()).toEqual([]);
    expect(toasts).not.toHaveBeenCalled();
  });

  it('keeps the hanging action through a lapse and sends it when the account signs back in', async () => {
    const { http, key, waiting } = await sendingOne();

    account.set(null);
    await settle();
    await elapse(30_100);
    await elapse(120_000);
    expect(take(http)).toEqual([]);

    account.set({ id: 'account-1' });
    await settle();
    const again = take(http);

    expect(waiting.actions().map((a) => a.key)).toEqual([key]);
    expect(again[0]?.request.headers.get('Idempotency-Key')).toBe(key);
  });
});

// @traces 532-FR-003
// @traces 532-FR-004
describe('Waiting: lapses and who signs back in', () => {
  async function keptOne() {
    const parts = await start();
    const key = await parts.waiting.add('job.step', step(1));
    await settle();
    noAnswer(take(parts.http)[0] as TestRequest);
    await settle();
    return { ...parts, key };
  }

  it('sends the kept action once after several lapses and sign-ins', async () => {
    const { http } = await keptOne();

    for (let i = 0; i < 3; i++) {
      account.set(null);
      await settle();
      account.set({ id: 'account-1' });
      await settle();
    }
    const sent = take(http);

    expect(urls(sent)).toEqual([step(1).url]);
  });

  it('sends nothing, and does not retry, while the session is lapsed', async () => {
    const { http } = await keptOne();

    account.set(null);
    await settle();
    window.dispatchEvent(new Event('online'));
    live.state.set('reconnecting');
    await settle();
    live.state.set('open');
    await elapse(300_000);

    expect(take(http)).toEqual([]);
  });

  it('keeps A’s actions through a sign-out of another account B', async () => {
    const { http } = await keptOne();
    account.set(null);
    await settle();

    signedOut.next('account-2');
    await settle();
    account.set({ id: 'account-1' });
    await settle();

    expect(urls(take(http))).toEqual([step(1).url]);
  });

  it('drops A’s actions when B signs in and lapses and A comes back', async () => {
    const { http, waiting } = await keptOne();
    account.set(null);
    await settle();
    account.set({ id: 'account-2' });
    await settle();
    account.set(null);
    await settle();

    account.set({ id: 'account-1' });
    await settle();

    expect(take(http)).toEqual([]);
    expect(waiting.actions()).toEqual([]);
  });

  it('lets an action made while the kept one is being resent join the line, resolved within the 30 second bound', async () => {
    const { http, waiting } = await keptOne();
    account.set(null);
    await settle();
    account.set({ id: 'account-1' });
    await settle();
    take(http);

    const added = waiting.add('job.step', step(2));
    await elapse(30_100);
    await added;

    expect(waiting.actions().map((a) => a.url)).toEqual([
      step(1).url,
      step(2).url,
    ]);
  });

  it('refuses a new action while lapsed', async () => {
    const { waiting } = await keptOne();
    account.set(null);
    await settle();

    await expect(waiting.add('job.step', step(3))).rejects.toThrow(
      'No account is signed in',
    );
  });

  it('shows no actions of the lapsed account while lapsed', async () => {
    const { waiting } = await keptOne();

    account.set(null);
    await settle();

    expect(waiting.actions()).toEqual([]);
  });

  it('drops a kept action older than 24 hours when the account signs back in, saying so, sending nothing', async () => {
    const { http } = await keptOne();
    account.set(null);
    await settle();

    await elapse(24 * 3_600_000 + 1_000);
    account.set({ id: 'account-1' });
    await settle();

    expect(take(http)).toEqual([]);
    expect(toasts).toHaveBeenCalledTimes(1);
  });

  it('drops them at a sign-out that arrives before the lapse is noticed', async () => {
    const { http, waiting } = await keptOne();

    signedOut.next('account-1');
    account.set(null);
    await settle();
    account.set({ id: 'account-1' });
    await settle();
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(take(http)).toEqual([]);
    expect(waiting.actions()).toEqual([]);
  });

  it('drops the lapsed account’s actions when a sign-out of it is announced after the lapse', async () => {
    const { http, waiting } = await keptOne();
    account.set(null);
    await settle();

    signedOut.next('account-1');
    await settle();
    account.set({ id: 'account-1' });
    await settle();

    expect(take(http)).toEqual([]);
    expect(waiting.actions()).toEqual([]);
  });
});

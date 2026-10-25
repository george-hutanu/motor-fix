import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { serverTimeoutInterceptor } from './server-timeout.interceptor';

type Outcome = {
  body?: unknown;
  error?: HttpErrorResponse;
  settled: boolean;
  unsubscribe: () => void;
};

function setup(platform: string, fetchImpl: typeof fetch) {
  globalThis.fetch = fetchImpl;
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      provideHttpClient(
        withFetch(),
        withInterceptors([serverTimeoutInterceptor]),
      ),
    ],
  });
  return TestBed.inject(HttpClient);
}

function get(http: HttpClient, url = 'http://api.internal:3000/api/v1/x') {
  const outcome: Outcome = { settled: false, unsubscribe: () => undefined };
  const sub = http.get(url).subscribe({
    error: (error: HttpErrorResponse) => {
      outcome.error = error;
      outcome.settled = true;
    },
    next: (body) => {
      outcome.body = body;
      outcome.settled = true;
    },
  });
  outcome.unsubscribe = () => sub.unsubscribe();
  return outcome;
}

const delayed = (ms: number, make: () => Response) =>
  jest.fn(
    (_u: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(make()), ms);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        });
      }),
  ) as unknown as typeof fetch;

const json =
  (body: unknown, status = 200) =>
  () => {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    let done = false;
    const headers = new Map([['content-type', 'application/json']]);
    return {
      body: {
        getReader: () => ({
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: bytes };
          },
        }),
      },
      headers: {
        forEach: (fn: (v: string, k: string) => void) => {
          for (const [k, v] of headers) fn(v, k);
        },
        get: (k: string) => headers.get(k.toLowerCase()) ?? null,
        keys: () => headers.keys(),
      },
      ok: status < 400,
      status,
      statusText: '',
      url: '',
    } as unknown as Response;
  };

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

// @traces 1188-FR-002
describe('the server-side cap on API calls, hostile cases', () => {
  it('delivers data that arrives at 2999 ms on the server', async () => {
    const http = setup('server', delayed(2999, json({ ok: 1 })));
    const outcome = get(http);

    await jest.advanceTimersByTimeAsync(3000);
    expect(outcome.error).toBeUndefined();
    expect(outcome.body).toEqual({ ok: 1 });
  });

  it('ends a call whose headers arrive but whose body never finishes, within 3 s', async () => {
    const stalled = jest.fn(async (_u: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":'));
          init.signal?.addEventListener('abort', () =>
            controller.error(init.signal?.reason),
          );
        },
      });
      return {
        body,
        headers: new Map([['content-type', 'application/json']]),
        ok: true,
        status: 200,
        statusText: '',
        url: '',
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const outcome = get(setup('server', stalled));

    await jest.advanceTimersByTimeAsync(3100);
    expect(outcome.settled).toBe(true);
    expect(outcome.error?.status).toBe(0);
  });

  it('passes a fast 500 through with its status, not as a timeout', async () => {
    const outcome = get(
      setup('server', delayed(10, json({ message: 'boom' }, 500))),
    );

    await jest.advanceTimersByTimeAsync(10);
    expect(outcome.error?.status).toBe(500);
  });

  it('passes a fast connection failure through as a failed call', async () => {
    const refused = jest.fn(() =>
      Promise.reject(new TypeError('fetch failed')),
    ) as unknown as typeof fetch;
    const outcome = get(setup('server', refused));

    await jest.advanceTimersByTimeAsync(0);
    expect(outcome.error).toBeInstanceOf(HttpErrorResponse);
    expect(outcome.error?.status).toBe(0);
  });

  it('leaves no more pending timers after a successful server call than a browser call does', async () => {
    const timersAfter = async (platform: string) => {
      jest.clearAllTimers();
      TestBed.resetTestingModule();
      const outcome = get(setup(platform, delayed(5, json({ ok: 1 }))));
      await jest.advanceTimersByTimeAsync(5);
      expect(outcome.body).toEqual({ ok: 1 });
      return jest.getTimerCount();
    };
    const browser = await timersAfter('browser');

    expect(await timersAfter('server')).toBe(browser);
  });

  it('aborts the underlying fetch when the caller unsubscribes', async () => {
    let signal: AbortSignal | undefined;
    const never = jest.fn((_u: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    const outcome = get(setup('server', never));

    await jest.advanceTimersByTimeAsync(100);
    outcome.unsubscribe();
    expect(signal?.aborted).toBe(true);
  });

  it('gives each of many concurrent calls its own 3 s', async () => {
    const never = jest.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_r, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          ),
        ),
    ) as unknown as typeof fetch;
    const http = setup('server', never);
    const calls = Array.from({ length: 200 }, () => get(http));

    await jest.advanceTimersByTimeAsync(3000);
    expect(calls.filter((c) => c.error?.status === 0)).toHaveLength(200);
  });

  it('starts a fresh 3 s on a second call made after the first timed out', async () => {
    const never = jest.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_r, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          ),
        ),
    ) as unknown as typeof fetch;
    const http = setup('server', never);
    get(http);
    await jest.advanceTimersByTimeAsync(3000);
    const second = get(http);

    await jest.advanceTimersByTimeAsync(2999);
    expect(second.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(second.error?.status).toBe(0);
  });

  it('applies no cap for an unrecognised platform id other than server', async () => {
    const outcome = get(setup('browser', delayed(10_000, json({ ok: 1 }))));

    await jest.advanceTimersByTimeAsync(10_000);
    expect(outcome.body).toEqual({ ok: 1 });
  });

  it('caps a call to a non-ASCII url on the server as well', async () => {
    const never = jest.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_r, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          ),
        ),
    ) as unknown as typeof fetch;
    const outcome = get(
      setup('server', never),
      'http://api.internal:3000/api/v1/garages/ăâîșț?q=%F0%9F%9A%97',
    );

    await jest.advanceTimersByTimeAsync(3000);
    expect(outcome.error?.status).toBe(0);
  });
});

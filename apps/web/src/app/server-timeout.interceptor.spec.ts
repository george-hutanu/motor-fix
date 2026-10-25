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

// An API that never answers: the call ends only when its signal aborts.
const silentApi = jest.fn(
  (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }),
);

function call(platform: 'server' | 'browser') {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      provideHttpClient(
        withFetch(),
        withInterceptors([serverTimeoutInterceptor]),
      ),
    ],
  });
  const outcome: { error?: unknown; settled: boolean } = { settled: false };
  TestBed.inject(HttpClient)
    .get('http://api.internal:3000/api/v1/home')
    .subscribe({
      error: (error: unknown) => {
        outcome.error = error;
        outcome.settled = true;
      },
      next: () => {
        outcome.settled = true;
      },
    });
  return outcome;
}

beforeEach(() => {
  jest.useFakeTimers();
  silentApi.mockClear();
  globalThis.fetch = silentApi as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

// @traces 1188-FR-002
describe('the server-side cap on API calls', () => {
  it('ends a server call the API does not answer after 3 s, as a failed call', async () => {
    const outcome = call('server');

    await jest.advanceTimersByTimeAsync(2999);
    expect(outcome.settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(outcome.error).toBeInstanceOf(HttpErrorResponse);
    expect((outcome.error as HttpErrorResponse).status).toBe(0);
    expect(silentApi).toHaveBeenCalledTimes(1);
  });

  it('leaves a call in the browser without a cap', async () => {
    const outcome = call('browser');

    await jest.advanceTimersByTimeAsync(60_000);
    expect(outcome.settled).toBe(false);
  });
});

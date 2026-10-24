import { FetchBackend, HttpBackend, HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { appConfig } from './app.config';

type Provider = {
  provide?: unknown;
  useExisting?: unknown;
  ɵproviders?: unknown[];
};

// Every provider the app config gives, opened through the environment
// providers each provide* function wraps its own in.
const flatten = (providers: unknown[]): Provider[] =>
  providers.flatMap((p) => {
    if (Array.isArray(p)) return flatten(p);
    const provider = p as Provider;
    return provider?.ɵproviders
      ? [provider, ...flatten(provider.ɵproviders)]
      : [provider];
  });

const given = () => flatten(appConfig.providers);
const named = (token: unknown) => String(token);

// @traces 1193-FR-008
describe('the app config', () => {
  it('sends its requests through the fetch backend, the default since Angular 21', () => {
    const http = given().filter((p) =>
      p.ɵproviders?.some((inner) => inner === HttpClient),
    );
    TestBed.configureTestingModule({ providers: http as never[] });

    expect(TestBed.inject(HttpBackend)).toBeInstanceOf(FetchBackend);
  });

  it('asks for the fetch backend through no switch of its own', () => {
    expect(
      given().filter(
        (p) => p.provide === HttpBackend && p.useExisting === FetchBackend,
      ),
    ).toEqual([]);
  });

  it('still replays a tap made on the server-rendered page before hydration', () => {
    expect(given().map((p) => named(p?.provide))).toContain(
      'InjectionToken IS_EVENT_REPLAY_ENABLED',
    );
  });
});

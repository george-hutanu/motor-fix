import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { faro, initializeFaro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

import { startFaro } from './faro';

jest.mock('@grafana/faro-web-sdk', () => {
  const api = { setSession: jest.fn(), setView: jest.fn() };
  return {
    ErrorsInstrumentation: jest.fn(),
    faro: { api },
    InternalLoggerLevel: { OFF: 0 },
    initializeFaro: jest.fn(),
    WebVitalsInstrumentation: jest.fn(),
  };
});
jest.mock('@grafana/faro-web-tracing', () => ({
  TracingInstrumentation: jest.fn(),
}));

@Component({ template: '' })
class Page {}

let router: Router;

beforeEach(async () => {
  jest.clearAllMocks();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: [{ component: Page, path: 'garages/:garage' }],
          path: ':lang',
        },
        { component: Page, path: '**' },
      ]),
    ],
  });
  router = TestBed.inject(Router);
  await router.navigateByUrl('/ro/garages/42');
});

const start = () =>
  startFaro({
    router,
    url: 'https://faro.example/collect/key',
    version: 'abc1234',
  });

const config = () => jest.mocked(initializeFaro).mock.calls[0]?.[0];

describe('startFaro', () => {
  it('sends to the collector as the web app at its release', () => {
    start();

    expect(config()).toMatchObject({
      app: { name: 'web', version: 'abc1234' },
      url: 'https://faro.example/collect/key',
    });
    expect((globalThis as Record<string, unknown>)['__faroBundleId_web']).toBe(
      'abc1234',
    );
  });

  it('tracks no session, no place and logs nothing of its own', () => {
    start();

    expect(config()).toMatchObject({
      internalLoggerLevel: 0,
      sessionTracking: { enabled: false },
      trackGeolocation: false,
    });
    expect(typeof config()?.beforeSend).toBe('function');
  });

  it('records errors, Web Vitals and same-origin traces only', () => {
    start();

    expect(config()?.instrumentations).toHaveLength(3);
    expect(TracingInstrumentation).toHaveBeenCalledWith({
      instrumentationOptions: { propagateTraceHeaderCorsUrls: [] },
    });
  });

  it('marks the page sampled with no session id', () => {
    start();

    expect(faro.api.setSession).toHaveBeenCalledWith({
      attributes: { isSampled: 'true' },
    });
  });

  it('names the view by the route template, now and after each navigation', async () => {
    start();
    await router.navigateByUrl('/en/garages/7');
    await router.navigateByUrl('/nowhere/at/all');

    expect(jest.mocked(faro.api.setView).mock.calls).toEqual([
      [{ name: '/:lang/garages/:garage' }],
      [{ name: '/:lang/garages/:garage' }],
      [{ name: 'unmatched' }],
    ]);
  });

  it('swallows a failure to start', () => {
    jest.mocked(initializeFaro).mockImplementation(() => {
      throw new Error('no storage');
    });

    expect(start).not.toThrow();
  });
});

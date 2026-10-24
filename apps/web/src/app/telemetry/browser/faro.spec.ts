import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, computed, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  ErrorsInstrumentation,
  EVENT_VIEW_CHANGED,
  faro,
  initializeFaro,
  STORAGE_KEY,
  WebVitalsInstrumentation,
} from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';
import { ANALYTICS_CONSENT_VERSION } from '@motor-fix/contracts/consent';

import { startFaro } from './faro';
import { measure, sendMeasurementsTo } from './measure/measure';
import { Consent, isValid } from '../../consent/consent';

jest.mock('@grafana/faro-web-sdk', () => {
  const api = {
    pushEvent: jest.fn(),
    pushMeasurement: jest.fn(),
    setSession: jest.fn(),
    setView: jest.fn(),
  };
  let ids = 0;
  return {
    ErrorsInstrumentation: jest.fn(),
    EVENT_SESSION_EXTEND: 'session_extend',
    EVENT_SESSION_RESUME: 'session_resume',
    EVENT_SESSION_START: 'session_start',
    EVENT_VIEW_CHANGED: 'view_changed',
    faro: { api },
    genShortID: jest.fn(() => `Gen${String(++ids).padStart(7, '0')}`),
    InternalLoggerLevel: { OFF: 0 },
    initializeFaro: jest.fn(),
    STORAGE_KEY: 'com.grafana.faro.session',
    TransportItemType: jest.requireActual('@grafana/faro-web-sdk')
      .TransportItemType,
    WebVitalsInstrumentation: jest.fn(),
  };
});
jest.mock('@grafana/faro-web-tracing', () => ({
  TracingInstrumentation: jest.fn(),
}));

@Component({ template: '' })
class Page {}

let router: Router;
// The stored analytics choice, judged as the consent service judges it.
const stored = signal<{ at: string; textVersion: string } | null>(null);
const grant = (textVersion = ANALYTICS_CONSENT_VERSION) =>
  stored.set({ at: new Date().toISOString(), textVersion });

beforeEach(async () => {
  jest.clearAllMocks();
  sessionStorage.clear();
  stored.set(null);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Consent,
        useValue: { granted: computed(() => isValid(stored())) },
      },
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
    environment: 'staging',
    injector: TestBed.inject(Injector),
    url: 'https://faro.example/collect/key',
    version: 'abc1234',
  });

const sessionIds = () =>
  jest
    .mocked(faro.api.setSession)
    .mock.calls.map(([session]) => session?.id)
    .filter(Boolean);
const journeys = () =>
  jest
    .mocked(faro.api.pushEvent)
    .mock.calls.filter(([name]) => name === EVENT_VIEW_CHANGED)
    .map(([, attributes]) => attributes);

const config = () => jest.mocked(initializeFaro).mock.calls[0]?.[0];

describe('startFaro', () => {
  // @traces 879-FR-002
  it('sends to the collector as the web app at its release and environment', () => {
    start();

    expect(config()).toMatchObject({
      app: { environment: 'staging', name: 'web', version: 'abc1234' },
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
    TestBed.tick();

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

  // @traces 1169-FR-011
  it('sends the measurements the app takes to the collector once started', () => {
    sendMeasurementsTo(undefined);
    measure('prefetch', { duration: 1 }, { outcome: 'hit', path: 'profile' });
    expect(faro.api.pushMeasurement).not.toHaveBeenCalled();

    start();
    measure(
      'prefetch',
      { duration: 40 },
      { outcome: 'fetched', path: 'profile' },
    );

    expect(faro.api.pushMeasurement).toHaveBeenCalledWith(
      { type: 'prefetch', values: { duration: 40 } },
      { context: { outcome: 'fetched', path: 'profile' } },
    );
  });

  // @traces 947-FR-001
  it('without consent sends no session id, no journey and keeps nothing on the tab', async () => {
    start();
    TestBed.tick();
    await router.navigateByUrl('/en/garages/7');
    await router.navigateByUrl('/nowhere/at/all');
    TestBed.tick();

    expect(sessionIds()).toEqual([]);
    expect(faro.api.pushEvent).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  // @traces 947-FR-002
  it('with consent at start sets the session before anything is sent, and reports the page shown', () => {
    grant();

    start();

    expect(sessionIds()).toHaveLength(1);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(sessionIds()[0]);
    TestBed.tick();
    expect(sessionIds()).toHaveLength(1);
    expect(journeys()).toEqual([
      { fromView: '', toView: '/:lang/garages/:garage' },
    ]);
  });

  // @traces 947-FR-002
  // @traces 947-FR-007
  it('reports each change of route template, never the path, and none within one template', async () => {
    grant();
    start();
    TestBed.tick();

    await router.navigateByUrl('/en/garages/7');
    await router.navigateByUrl('/nowhere/at/all');
    await router.navigateByUrl('/ro/garages/42');

    expect(journeys()).toEqual([
      { fromView: '', toView: '/:lang/garages/:garage' },
      { fromView: '/:lang/garages/:garage', toView: 'unmatched' },
      { fromView: 'unmatched', toView: '/:lang/garages/:garage' },
    ]);
    expect(JSON.stringify(journeys())).not.toMatch(/42|\/7|nowhere/);
    for (const call of jest.mocked(faro.api.pushEvent).mock.calls)
      expect(call[3]).toEqual({ skipDedupe: true });
  });

  // @traces 947-FR-002
  it('starts the session and reports the page shown once consent is given later', async () => {
    start();
    TestBed.tick();
    await router.navigateByUrl('/en/garages/7');

    grant();
    TestBed.tick();

    expect(sessionIds()).toHaveLength(1);
    expect(journeys()).toEqual([
      { fromView: '', toView: '/:lang/garages/:garage' },
    ]);
  });

  // @traces 947-FR-003
  // @traces 947-FR-009
  it('ends the session at once on withdrawal and sends no journey after it', async () => {
    grant();
    start();
    TestBed.tick();
    const first = sessionIds()[0];

    stored.set(null);
    TestBed.tick();
    await router.navigateByUrl('/nowhere/at/all');

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(faro.api.setSession).toHaveBeenLastCalledWith({
      attributes: { isSampled: 'true' },
    });
    expect(journeys()).toHaveLength(1);
    const beforeSend = jest.mocked(initializeFaro).mock.calls[0]?.[0]
      .beforeSend as (item: unknown) => unknown;
    expect(
      beforeSend({
        meta: { session: { id: first } },
        payload: { name: EVENT_VIEW_CHANGED },
        type: 'event',
      }),
    ).toBeNull();

    grant();
    TestBed.tick();
    expect(sessionIds()).toHaveLength(2);
    expect(sessionIds()[1]).not.toBe(first);
  });

  // @traces 947-FR-004
  it('treats a choice made under the previous text as no consent', async () => {
    grant('2026-10-10');

    start();
    TestBed.tick();
    await router.navigateByUrl('/en/garages/7');

    expect(sessionIds()).toEqual([]);
    expect(faro.api.pushEvent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // @traces 947-FR-006
  it('loads no session replay and the app depends on no replay package', () => {
    start();

    const known = [
      ErrorsInstrumentation,
      WebVitalsInstrumentation,
      TracingInstrumentation,
    ];
    const instrumentations = config()?.instrumentations ?? [];
    expect(instrumentations).toHaveLength(known.length);
    for (const instrumentation of instrumentations)
      expect(known.some((made) => instrumentation instanceof made)).toBe(true);
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../../../../../package.json'), 'utf8'),
    );
    const dependencies = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    });
    expect(dependencies).toContain('@grafana/faro-web-sdk');
    expect(dependencies.filter((name) => /replay/i.test(name))).toEqual([]);
  });

  it('swallows a failure to start', () => {
    jest.mocked(initializeFaro).mockImplementation(() => {
      throw new Error('no storage');
    });

    expect(start).not.toThrow();
  });
});

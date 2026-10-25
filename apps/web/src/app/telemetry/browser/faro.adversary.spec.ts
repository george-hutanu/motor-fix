import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Component, computed, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  EVENT_VIEW_CHANGED,
  faro,
  initializeFaro,
  STORAGE_KEY,
} from '@grafana/faro-web-sdk';
import {
  ANALYTICS_CONSENT_MAX_AGE_DAYS,
  ANALYTICS_CONSENT_VERSION,
} from '@motor-fix/contracts/consent';

import { startFaro } from './faro';
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
const stored = signal<{ at: string; textVersion: string } | null>(null);
const grantAt = (at: Date, textVersion = ANALYTICS_CONSENT_VERSION) =>
  stored.set({ at: at.toISOString(), textVersion });
const grant = () => grantAt(new Date());

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(initializeFaro).mockReset();
  sessionStorage.clear();
  localStorage.clear();
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

const DAY = 24 * 60 * 60 * 1000;

describe('isValid at the edges of the analytics choice', () => {
  // @traces 947-FR-009
  it('is valid one millisecond short of the maximum age and not at it', () => {
    const now = Date.parse('2026-10-24T12:00:00.000Z');
    const max = ANALYTICS_CONSENT_MAX_AGE_DAYS * DAY;

    expect(
      isValid(
        {
          at: new Date(now - max + 1).toISOString(),
          textVersion: ANALYTICS_CONSENT_VERSION,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isValid(
        {
          at: new Date(now - max).toISOString(),
          textVersion: ANALYTICS_CONSENT_VERSION,
        },
        now,
      ),
    ).toBe(false);
  });

  // @traces 947-FR-004
  it.each([
    '2026-10-10',
    '',
    ' 2026-10-24',
    '2026-10-24 ',
    '2026-10-25',
    '2026-10-24\n',
  ])('refuses the text version %j', (textVersion) => {
    expect(isValid({ at: new Date().toISOString(), textVersion })).toBe(false);
  });

  // @traces 947-FR-001
  it.each(['', 'not a date', 'null', 'undefined', '0000'])(
    'refuses the unreadable time %j',
    (at) => {
      expect(isValid({ at, textVersion: ANALYTICS_CONSENT_VERSION })).toBe(
        false,
      );
    },
  );

  // @traces 947-FR-009
  it('refuses a choice dated a year in the future, which would never expire', () => {
    const future = new Date(Date.now() + 366 * DAY).toISOString();

    expect(
      isValid({ at: future, textVersion: ANALYTICS_CONSENT_VERSION }),
    ).toBe(false);
  });
});

describe('startFaro under consent changes', () => {
  // @traces 947-FR-001
  it('removes a stale session left on the tab when started without consent', () => {
    sessionStorage.setItem(STORAGE_KEY, 'OldOldOld1');

    start();
    TestBed.tick();

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(sessionIds()).toEqual([]);
  });

  // @traces 947-FR-001
  it('refuses a choice a year and a day old: no session id, no journey', () => {
    grantAt(new Date(Date.now() - 366 * DAY));

    start();
    TestBed.tick();

    expect(sessionIds()).toEqual([]);
    expect(faro.api.pushEvent).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  // @traces 947-FR-003
  it('ends with a live session when consent is given, withdrawn and given again before the next tick', () => {
    start();
    TestBed.tick();

    grant();
    stored.set(null);
    grant();
    TestBed.tick();

    expect(sessionIds()).toHaveLength(1);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(sessionIds()[0]);
  });

  // @traces 947-FR-003
  it('leaves nothing on the tab when consent is given then withdrawn before the next tick', () => {
    start();
    TestBed.tick();

    grant();
    stored.set(null);
    TestBed.tick();

    expect(sessionIds()).toEqual([]);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(journeys()).toEqual([]);
  });

  // @traces 947-FR-003
  it('reports the page now shown, not the first one, when consent is given again', async () => {
    grant();
    start();
    TestBed.tick();
    stored.set(null);
    TestBed.tick();
    await router.navigateByUrl('/nowhere/at/all');

    grant();
    TestBed.tick();

    expect(journeys().at(-1)).toEqual({ fromView: '', toView: 'unmatched' });
    expect(sessionIds()).toHaveLength(2);
    expect(sessionIds()[0]).not.toBe(sessionIds()[1]);
  });

  // @traces 947-FR-007
  it('names an unmatched url with a query by its template only', async () => {
    grant();
    start();
    TestBed.tick();

    await router.navigateByUrl('/zzz/ana@example.com?plate=B123ABC#frag');

    const text = JSON.stringify(journeys());
    expect(text).toContain('unmatched');
    expect(text).not.toMatch(/ana|B123|zzz|frag/);
  });

  // @traces 947-FR-002
  it('sends no journey for a query or fragment change on the same template', async () => {
    grant();
    start();
    TestBed.tick();

    await router.navigateByUrl('/ro/garages/42?tab=hours#top');
    await router.navigateByUrl('/ro/garages/43');

    expect(journeys()).toHaveLength(1);
  });

  // @traces 947-FR-001
  it('keeps local storage empty through consent and withdrawal', () => {
    grant();
    start();
    TestBed.tick();
    stored.set(null);
    TestBed.tick();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  // @traces 947-FR-012
  it('does not throw when the consent service fails at start', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Consent,
          useValue: {
            granted: () => {
              throw new Error('boom');
            },
          },
        },
        provideRouter([{ component: Page, path: '**' }]),
      ],
    });

    expect(start).not.toThrow();
    expect(sessionStorage.length).toBe(0);
  });
});

describe('no session replay', () => {
  const root = join(__dirname, '../../../../../..');

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? walk(path)
        : /\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name)
          ? [path]
          : [];
    });

  // @traces 947-FR-006
  it('has no replay package in the lockfile at the top level', () => {
    const lock = JSON.parse(
      readFileSync(join(root, 'package-lock.json'), 'utf8'),
    );
    const names = Object.keys(lock.packages ?? {}).filter((key) =>
      /node_modules\/(@grafana\/faro-[\w-]*replay|rrweb(?!-cssom)[\w-]*|@rrweb\/[\w-]+)$/.test(
        key,
      ),
    );

    expect(names).toEqual([]);
  });

  // @traces 947-FR-006
  it('imports no replay instrumentation anywhere in the web app', () => {
    const offenders = walk(join(root, 'apps/web/src')).filter((file) =>
      /ReplayInstrumentation|faro-.*replay|rrweb|sessionReplay|session-replay/i.test(
        readFileSync(file, 'utf8'),
      ),
    );

    expect(offenders).toEqual([]);
  });
});

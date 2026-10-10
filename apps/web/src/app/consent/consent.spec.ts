import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import {
  ANALYTICS_CONSENT_MAX_AGE_DAYS,
  ANALYTICS_CONSENT_VERSION,
} from '@motor-fix/contracts/consent';
import { ConsentsService, type MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

import {
  ANALYTICS,
  CONSENT_KEY,
  Consent,
  isValid,
  type StoredChoice,
} from './consent';
import { Session } from '../dashboard/session';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ACCOUNT = '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c';
const OTHER = '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const choice = (overrides: Partial<StoredChoice> = {}): StoredChoice => ({
  accountId: null,
  at: ago(1),
  browserConsentId: '2c1f7a52-0c1d-4c86-9a0e-3b3f1b2a9d11',
  decision: 'granted',
  language: 'ro',
  pending: false,
  textVersion: ANALYTICS_CONSENT_VERSION,
  ...overrides,
});

let api: {
  consentsControllerMine: jest.Mock;
  consentsControllerRecord: jest.Mock;
  consentsControllerRecordMine: jest.Mock;
};
let analytics: { load: jest.Mock; pageview: jest.Mock };
let events: Subject<unknown>;
let current: ReturnType<typeof signal<MeDto | null>>;

const stored = (): StoredChoice | null => {
  const raw = localStorage.getItem(CONSENT_KEY);
  return raw ? (JSON.parse(raw) as StoredChoice) : null;
};
const keep = (value: StoredChoice) =>
  localStorage.setItem(CONSENT_KEY, JSON.stringify(value));

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

function withMeta(domain: string | null) {
  for (const old of document.querySelectorAll('meta[name="mf-analytics"]'))
    old.remove();
  if (!domain) return;
  const meta = document.createElement('meta');
  meta.name = 'mf-analytics';
  meta.content = domain;
  document.head.append(meta);
}

async function start({
  platform = 'browser',
  domain = 'motorfix.ro' as string | null,
  language = 'ro' as 'ro' | 'en',
} = {}) {
  withMeta(domain);
  api = {
    consentsControllerMine: jest.fn(async () => ({
      accepted: [],
      analytics: null,
    })),
    consentsControllerRecord: jest.fn(async () => ({ id: 'r1' })),
    consentsControllerRecordMine: jest.fn(async () => ({ id: 'r2' })),
  };
  analytics = { load: jest.fn(), pageview: jest.fn() };
  events = new Subject();
  current = signal<MeDto | null>(null);
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: ConsentsService, useValue: api },
      { provide: ANALYTICS, useValue: analytics },
      { provide: Session, useValue: { current } },
      {
        provide: Router,
        useValue: {
          events,
          navigated: true,
          routerState: {
            snapshot: {
              root: {
                firstChild: {
                  firstChild: null,
                  routeConfig: { path: ':lang' },
                },
                routeConfig: null,
              },
            },
          },
        },
      },
    ],
  });
  await TestBed.inject(I18n).use(language);
  const consent = TestBed.inject(Consent);
  await settle();
  return consent;
}

const navigate = () => events.next(new NavigationEnd(1, '/ro', '/ro'));
const signIn = (id = ACCOUNT) => current.set({ id } as MeDto);
const failWith = (status: number) =>
  jest.fn(async () => {
    throw new HttpErrorResponse({ status });
  });

beforeEach(() => localStorage.clear());
afterEach(() => {
  jest.restoreAllMocks();
  withMeta(null);
});

// @traces 244-FR-005
describe('a valid choice', () => {
  it('holds the current text version and is less than 365 days old', () => {
    expect(ANALYTICS_CONSENT_MAX_AGE_DAYS).toBe(365);
    expect(isValid(choice({ at: ago(364) }))).toBe(true);
    expect(isValid(choice({ at: ago(365) }))).toBe(false);
    expect(isValid(choice({ textVersion: '2025-01-01' }))).toBe(false);
    expect(isValid(null)).toBe(false);
  });
});

// @traces 244-FR-001 244-FR-002 244-FR-003 244-FR-014
describe('the first visit', () => {
  it('shows the bar and loads nothing while there is no choice', async () => {
    const consent = await start();

    expect(consent.showBar()).toBe(true);
    navigate();
    expect(analytics.load).not.toHaveBeenCalled();
    expect(analytics.pageview).not.toHaveBeenCalled();
  });

  it('shows no bar and reads nothing on the server', async () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem');

    const consent = await start({ platform: 'server' });

    expect(consent.showBar()).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
  });

  it('treats an unreadable or broken choice as none', async () => {
    localStorage.setItem(CONSENT_KEY, '{not json');
    expect((await start()).showBar()).toBe(true);

    TestBed.resetTestingModule();
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect((await start()).showBar()).toBe(true);
  });

  it('on "Accept" keeps the choice, sends one record, hides the bar and counts this page', async () => {
    const consent = await start();

    await consent.accept();

    const kept = stored();
    expect(kept).toEqual({
      accountId: null,
      at: expect.any(String),
      browserConsentId: expect.stringMatching(UUID),
      decision: 'granted',
      language: 'ro',
      pending: false,
      textVersion: ANALYTICS_CONSENT_VERSION,
    });
    expect(api.consentsControllerRecord).toHaveBeenCalledTimes(1);
    expect(api.consentsControllerRecord).toHaveBeenCalledWith({
      body: {
        at: kept?.at,
        browserConsentId: kept?.browserConsentId,
        decision: 'granted',
        language: 'ro',
        textVersion: ANALYTICS_CONSENT_VERSION,
      },
    });
    expect(consent.showBar()).toBe(false);
    expect(analytics.load).toHaveBeenCalledWith('motorfix.ro');
    expect(analytics.pageview).toHaveBeenCalledWith('/:lang');
  });

  it('on "Refuz" keeps the choice and never loads the script', async () => {
    const consent = await start();

    await consent.refuse();
    navigate();

    expect(stored()?.decision).toBe('refused');
    expect(api.consentsControllerRecord).toHaveBeenCalledTimes(1);
    expect(consent.showBar()).toBe(false);
    expect(analytics.load).not.toHaveBeenCalled();
    expect(analytics.pageview).not.toHaveBeenCalled();
  });

  it('names the language of the page in the record', async () => {
    const consent = await start({ language: 'en' });

    await consent.accept();

    expect(stored()?.language).toBe('en');
    expect(api.consentsControllerRecord.mock.calls[0][0].body.language).toBe(
      'en',
    );
  });

  it('hides the bar even when the browser cannot keep the choice', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const consent = await start();

    await consent.refuse();

    expect(consent.showBar()).toBe(false);
  });

  it('files a choice made signed in on the account', async () => {
    const consent = await start();
    signIn();
    await settle();

    await consent.accept();

    expect(api.consentsControllerRecord).not.toHaveBeenCalled();
    expect(api.consentsControllerRecordMine).toHaveBeenCalledTimes(1);
    expect(stored()?.accountId).toBe(ACCOUNT);
  });
});

// @traces 244-FR-004
describe('page views', () => {
  it('counts each route change only while the choice is a valid "granted"', async () => {
    keep(choice());
    await start();

    navigate();
    navigate();

    expect(analytics.load).toHaveBeenCalledTimes(1);
    expect(analytics.pageview).toHaveBeenCalledTimes(3);
  });

  it('never loads anything when the page names no analytics domain', async () => {
    keep(choice());
    const consent = await start({ domain: null });

    navigate();
    await consent.accept();

    expect(analytics.load).not.toHaveBeenCalled();
    expect(analytics.pageview).not.toHaveBeenCalled();
  });
});

// @traces 244-FR-013
describe('a record the server did not take', () => {
  it.each([0, 503, 429])(
    'is kept pending after a %s and sent again once at the next load',
    async (status) => {
      const consent = await start();
      api.consentsControllerRecord = failWith(status);
      await consent.accept();
      expect(stored()?.pending).toBe(true);

      TestBed.resetTestingModule();
      await start();

      expect(api.consentsControllerRecord).toHaveBeenCalledTimes(1);
      expect(stored()?.pending).toBe(false);
    },
  );

  it('is dropped after any other refusal', async () => {
    const consent = await start();
    api.consentsControllerRecord = failWith(400);

    await consent.accept();

    expect(stored()?.pending).toBe(false);
    expect(stored()?.decision).toBe('granted');
  });

  it('is tried only once per load', async () => {
    keep(choice({ decision: 'refused', pending: true }));
    withMeta('motorfix.ro');
    const failing = failWith(503);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ConsentsService,
          useValue: {
            consentsControllerMine: jest.fn(),
            consentsControllerRecord: failing,
          },
        },
        {
          provide: ANALYTICS,
          useValue: { load: jest.fn(), pageview: jest.fn() },
        },
        { provide: Session, useValue: { current: signal(null) } },
        { provide: Router, useValue: { events: new Subject() } },
      ],
    });
    TestBed.inject(Consent);
    await settle();
    await settle();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(stored()?.pending).toBe(true);
  });
});

// @traces 244-FR-007
describe('another tab', () => {
  const fromOtherTab = (value: StoredChoice) => {
    keep(value);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: CONSENT_KEY,
        newValue: JSON.stringify(value),
      }),
    );
  };

  it('applies a choice saved elsewhere without a reload', async () => {
    const consent = await start();

    fromOtherTab(choice());
    navigate();

    expect(consent.showBar()).toBe(false);
    expect(analytics.load).toHaveBeenCalled();
    expect(analytics.pageview).toHaveBeenCalled();

    analytics.pageview.mockClear();
    fromOtherTab(choice({ decision: 'withdrawn' }));
    navigate();
    expect(analytics.pageview).not.toHaveBeenCalled();
    expect(api.consentsControllerRecord).not.toHaveBeenCalled();
  });
});

// @traces 244-FR-006
describe('the cookie settings', () => {
  it('stores "withdrawn" when turned off and stops counting at once', async () => {
    keep(choice());
    const consent = await start();
    analytics.pageview.mockClear();

    await consent.save(false);
    navigate();

    expect(stored()?.decision).toBe('withdrawn');
    expect(api.consentsControllerRecord).toHaveBeenCalledTimes(1);
    expect(analytics.pageview).not.toHaveBeenCalled();
    expect(consent.granted()).toBe(false);
  });

  it('stores "granted" when turned on after a refusal', async () => {
    keep(choice({ decision: 'refused' }));
    const consent = await start();

    await consent.save(true);

    expect(stored()?.decision).toBe('granted');
    expect(analytics.load).toHaveBeenCalled();
  });

  it('stores nothing when the switch did not change, even on a first visit', async () => {
    keep(choice());
    const consent = await start();
    await consent.save(true);

    localStorage.clear();
    TestBed.resetTestingModule();
    const first = await start();
    await first.save(false);

    expect(api.consentsControllerRecord).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
    expect(first.showBar()).toBe(true);
  });
});

// @traces 244-FR-012
describe('after a sign-in', () => {
  const account = (analyticsChoice: object | null) =>
    jest.fn(async () => ({ accepted: [], analytics: analyticsChoice }));

  async function signedIn(
    browser: StoredChoice | null,
    latest: object | null,
    id = ACCOUNT,
  ) {
    if (browser) keep(browser);
    const consent = await start();
    api.consentsControllerMine = account(latest);
    signIn(id);
    await settle();
    return consent;
  }

  it('shows the bar when neither has a choice and stores nothing', async () => {
    const consent = await signedIn(null, null);

    expect(api.consentsControllerMine).toHaveBeenCalledTimes(1);
    expect(consent.showBar()).toBe(true);
    expect(api.consentsControllerRecordMine).not.toHaveBeenCalled();
  });

  it("applies the account's choice in a browser that has none", async () => {
    const at = ago(2);
    const consent = await signedIn(null, {
      at,
      decision: 'granted',
      language: 'en',
      textVersion: ANALYTICS_CONSENT_VERSION,
    });

    expect(consent.showBar()).toBe(false);
    expect(stored()).toMatchObject({
      accountId: ACCOUNT,
      at,
      decision: 'granted',
      pending: false,
    });
    expect(stored()?.browserConsentId).toMatch(UUID);
    expect(analytics.load).toHaveBeenCalled();
    expect(api.consentsControllerRecordMine).not.toHaveBeenCalled();
  });

  it("stores a visitor's choice on an account that has none, keeping its decision and time", async () => {
    const browser = choice({ decision: 'refused' });

    await signedIn(browser, null);

    expect(api.consentsControllerRecordMine).toHaveBeenCalledWith({
      body: {
        at: browser.at,
        browserConsentId: browser.browserConsentId,
        decision: 'refused',
        language: 'ro',
        textVersion: ANALYTICS_CONSENT_VERSION,
      },
    });
    expect(stored()).toMatchObject({ accountId: ACCOUNT, decision: 'refused' });
  });

  it("applies the account's newer choice and stores nothing", async () => {
    const consent = await signedIn(choice({ at: ago(3) }), {
      at: ago(1),
      decision: 'withdrawn',
      language: 'ro',
      textVersion: ANALYTICS_CONSENT_VERSION,
    });

    expect(stored()?.decision).toBe('withdrawn');
    expect(consent.granted()).toBe(false);
    expect(api.consentsControllerRecordMine).not.toHaveBeenCalled();
  });

  it("stores the browser's newer choice on the account", async () => {
    await signedIn(choice({ accountId: ACCOUNT, at: ago(1) }), {
      at: ago(3),
      decision: 'refused',
      language: 'ro',
      textVersion: ANALYTICS_CONSENT_VERSION,
    });

    expect(api.consentsControllerRecordMine).toHaveBeenCalledTimes(1);
    expect(stored()?.decision).toBe('granted');
  });

  it('never stores a choice made under another account, and shows the bar when this one has none', async () => {
    const consent = await signedIn(choice({ accountId: OTHER }), null);

    expect(api.consentsControllerRecordMine).not.toHaveBeenCalled();
    expect(consent.showBar()).toBe(true);
    expect(consent.granted()).toBe(false);
  });

  it('judges validity after choosing the newer one', async () => {
    const consent = await signedIn(choice({ at: ago(3) }), {
      at: ago(1),
      decision: 'granted',
      language: 'ro',
      textVersion: '2025-01-01',
    });

    expect(consent.showBar()).toBe(true);
    expect(consent.granted()).toBe(false);

    await consent.accept();
    expect(api.consentsControllerRecordMine).toHaveBeenCalledTimes(1);
  });

  it('never asks the account on a public page', async () => {
    keep(choice());
    await start();
    await settle();

    expect(api.consentsControllerMine).not.toHaveBeenCalled();
  });
});

// @traces 244-FR-005
describe('an old choice', () => {
  it.each([
    ['an older text version', choice({ textVersion: '2025-01-01' })],
    ['a choice 365 days old', choice({ at: ago(365) })],
  ])('asks again after %s, with analytics off', async (_, old) => {
    keep(old);
    const consent = await start();
    navigate();

    expect(consent.showBar()).toBe(true);
    expect(consent.granted()).toBe(false);
    expect(analytics.load).not.toHaveBeenCalled();
  });

  it('keeps a choice 364 days old', async () => {
    keep(choice({ at: ago(364) }));

    expect((await start()).showBar()).toBe(false);
  });
});

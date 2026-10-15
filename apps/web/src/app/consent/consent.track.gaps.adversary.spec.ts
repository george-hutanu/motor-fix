import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ANALYTICS_CONSENT_VERSION } from '@motor-fix/contracts/consent';
import { ConsentsService, type MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

import { sanitise } from './analytics-events';
import { ANALYTICS, CONSENT_KEY, Consent, type StoredChoice } from './consent';
import { Session } from '../dashboard/session';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const GARAGE_ID = '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c';
const PAGE = '/:lang/garages/:garage';

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

let analytics: { event: jest.Mock; load: jest.Mock; pageview: jest.Mock };

function withMeta(domain: string | null) {
  for (const old of document.querySelectorAll('meta[name="mf-analytics"]'))
    old.remove();
  if (!domain) return;
  const meta = document.createElement('meta');
  meta.name = 'mf-analytics';
  meta.content = domain;
  document.head.append(meta);
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function start({
  stored = choice() as StoredChoice | null,
  domain = 'motorfix.ro' as string | null,
} = {}) {
  if (stored) localStorage.setItem(CONSENT_KEY, JSON.stringify(stored));
  withMeta(domain);
  analytics = { event: jest.fn(), load: jest.fn(), pageview: jest.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      {
        provide: ConsentsService,
        useValue: {
          consentsControllerMine: jest.fn(async () => ({
            accepted: [],
            analytics: null,
          })),
          consentsControllerRecord: jest.fn(async () => ({ id: 'r1' })),
          consentsControllerRecordMine: jest.fn(async () => ({ id: 'r2' })),
        },
      },
      { provide: ANALYTICS, useValue: analytics },
      { provide: Session, useValue: { current: signal<MeDto | null>(null) } },
      {
        provide: Router,
        useValue: {
          events: new Subject(),
          navigated: true,
          routerState: {
            snapshot: {
              root: {
                firstChild: {
                  firstChild: {
                    firstChild: null,
                    routeConfig: { path: 'garages/:garage' },
                  },
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
  await TestBed.inject(I18n).use('ro');
  const consent = TestBed.inject(Consent);
  await settle();
  return consent;
}

beforeEach(() => localStorage.clear());
afterEach(() => withMeta(null));

// @traces 250-FR-001
describe('an event where analytics is not allowed to run', () => {
  it('sends nothing when the visitor never chose', async () => {
    const consent = await start({ stored: null });
    consent.track('brand_picked', { brand: 'dacia', source: 'home_picker' });
    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('sends nothing after a refusal', async () => {
    const consent = await start({ stored: choice({ decision: 'refused' }) });
    consent.track('listing_started');
    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('sends nothing when the choice is 366 days old', async () => {
    const consent = await start({ stored: choice({ at: ago(366) }) });
    consent.track('listing_started');
    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('sends nothing when the page names no analytics domain', async () => {
    const consent = await start({ domain: null });
    consent.track('listing_started');
    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('sends nothing when the domain meta is blank', async () => {
    const consent = await start({ domain: '   ' });
    consent.track('listing_started');
    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('sends nothing once another tab withdrew the choice', async () => {
    const consent = await start();
    consent.track('listing_started');
    analytics.event.mockClear();
    const refused = JSON.stringify(choice({ decision: 'refused' }));
    localStorage.setItem(CONSENT_KEY, refused);
    window.dispatchEvent(
      new StorageEvent('storage', { key: CONSENT_KEY, newValue: refused }),
    );
    await settle();

    consent.track('listing_started');

    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('sends nothing when another tab removed the choice', async () => {
    const consent = await start();
    analytics.event.mockClear();
    localStorage.removeItem(CONSENT_KEY);
    window.dispatchEvent(
      new StorageEvent('storage', { key: CONSENT_KEY, newValue: null }),
    );
    await settle();

    consent.track('listing_started');

    expect(analytics.event).not.toHaveBeenCalled();
  });
});

// @traces 250-FR-001
describe('an event under a granted choice', () => {
  it('carries the route template and only the allowed properties', async () => {
    const consent = await start();
    consent.track('quote_request_sent', {
      brand: 'dacia',
      garage: GARAGE_ID,
      garages: '2–3',
      jobs: 1,
    } as never);
    expect(analytics.event).toHaveBeenCalledWith('quote_request_sent', PAGE, {
      brand: 'dacia',
      garages: '2–3',
      jobs: 1,
    });
  });

  it('sends the event with no properties when every one is out of its set', async () => {
    const consent = await start();
    consent.track('garage_opened', { source: GARAGE_ID });
    expect(analytics.event).toHaveBeenCalledWith('garage_opened', PAGE, {});
  });

  it('sends nothing for a name outside the contract', async () => {
    const consent = await start();
    consent.track('account_deleted' as never, {});
    expect(analytics.event).not.toHaveBeenCalled();
  });
});

// @traces 250-FR-002
describe('values of the wrong kind', () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['quote_request_sent', { jobs: '1' }, {}],
    ['quote_request_sent', { jobs: 1.5 }, {}],
    ['quote_request_sent', { jobs: Number.NaN }, {}],
    ['quote_request_sent', { jobs: Number.POSITIVE_INFINITY }, {}],
    ['quote_request_sent', { jobs: 0 }, {}],
    ['quote_request_sent', { jobs: 1 }, { jobs: 1 }],
    ['quote_request_sent', { garages: 2 }, {}],
    ['quote_request_sent', { garages: '2-3' }, {}],
    ['quote_request_sent', { garages: '6' }, {}],
    ['quote_request_sent', { garages: '4–5' }, { garages: '4–5' }],
    ['listing_step_completed', { step: 0 }, {}],
    ['listing_step_completed', { step: 7 }, {}],
    ['listing_step_completed', { step: '3' }, {}],
    ['listing_step_completed', { step: 6 }, { step: 6 }],
    ['review_posted', { rating: 6 }, {}],
    ['review_posted', { has_text: true }, {}],
    ['quote_accepted', { position: 0 }, {}],
    ['garage_opened', { source: null }, {}],
    ['garage_opened', { source: ['results'] }, {}],
    ['garage_opened', { source: 'Results' }, {}],
    ['brand_picked', { brand: 'a@b.ro' }, {}],
    ['brand_picked', { brand: 'dacía' }, {}],
    ['brand_picked', { brand: 5 }, {}],
    ['brand_picked', { brand: 'a'.repeat(5000) }, {}],
    [
      'request_answered',
      { action: 'quote', note: 'ring 0722123456' },
      { action: 'quote' },
    ],
    ['sign_up_completed', { method: 'facebook', phone: '0722123456' }, {}],
    ['listing_started', { name: 'Atelier', plate: 'B123ABC' }, {}],
    [
      'filter_applied',
      { filter: 'max_price', value: 300 },
      { filter: 'max_price' },
    ],
  ];

  it.each(cases)('%s with %j keeps %j', (name, props, kept) => {
    expect(sanitise(name, props)).toEqual(kept);
  });
});

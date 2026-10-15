import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  ANALYTICS_CONSENT_MAX_AGE_DAYS,
  ANALYTICS_CONSENT_VERSION,
} from '@motor-fix/contracts/consent';
import { ConsentsService, type MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

import { ANALYTICS, CONSENT_KEY, Consent, type StoredChoice } from './consent';
import { Session } from '../dashboard/session';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

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

async function start(platform = 'browser') {
  withMeta('motorfix.ro');
  analytics = { event: jest.fn(), load: jest.fn(), pageview: jest.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
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
afterEach(() => {
  jest.restoreAllMocks();
  withMeta(null);
});

// @traces 250-FR-001
describe('tracking under a consent that is not quite valid', () => {
  it('sends nothing for a choice made under an older text', async () => {
    keep(choice({ textVersion: `${ANALYTICS_CONSENT_VERSION}-old` }));
    const consent = await start();

    consent.track('listing_started');

    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('sends nothing for a choice whose time cannot be read', async () => {
    keep(choice({ at: 'yesterday' }));
    const consent = await start();

    consent.track('listing_started');

    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('sends nothing for a choice exactly as old as the limit', async () => {
    keep(choice({ at: ago(ANALYTICS_CONSENT_MAX_AGE_DAYS) }));
    const consent = await start();

    consent.track('listing_started');

    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('sends nothing when the stored choice is not JSON or is another shape', async () => {
    for (const raw of [
      '{',
      'null',
      '[]',
      '"granted"',
      '{"decision":"granted"}',
    ]) {
      TestBed.resetTestingModule();
      localStorage.setItem(CONSENT_KEY, raw);
      const consent = await start();

      consent.track('listing_started');

      expect(analytics.event).not.toHaveBeenCalled();
    }
  });

  it('sends nothing when the decision is granted in capitals', async () => {
    keep(choice({ decision: 'GRANTED' as 'granted' }));
    const consent = await start();

    consent.track('listing_started');

    expect(analytics.event).not.toHaveBeenCalled();
  });
});

// @traces 250-FR-001
describe('tracking across a change of mind in one visit', () => {
  it('starts with the next event after a first-visit accept and replays nothing', async () => {
    const consent = await start();
    consent.track('brand_picked', { brand: 'dacia', source: 'home_picker' });

    await consent.save(true);
    expect(analytics.event).not.toHaveBeenCalled();
    consent.track('listing_started');

    expect(analytics.event).toHaveBeenCalledTimes(1);
    expect(analytics.event).toHaveBeenCalledWith(
      'listing_started',
      '/:lang/garages/:garage',
      {},
    );
  });

  it('stops on withdrawal and resumes only after a new grant', async () => {
    keep(choice());
    const consent = await start();

    consent.track('listing_started');
    await consent.save(false);
    consent.track('listing_started');
    consent.track('survey_completed');
    await consent.save(true);
    consent.track('listing_submitted');

    expect(analytics.event.mock.calls.map(([name]) => name)).toEqual([
      'listing_started',
      'listing_submitted',
    ]);
  });

  it('keeps the order of events as they were tracked', async () => {
    keep(choice());
    const consent = await start();

    consent.track('brand_picked', { brand: 'dacia', source: 'home_picker' });
    consent.track('garage_opened', { source: 'results' });
    consent.track('quote_request_started', { source: 'profile' });
    consent.track('quote_request_sent', {
      brand: 'dacia',
      garages: '2–3',
      jobs: 1,
    });

    expect(analytics.event.mock.calls.map(([name]) => name)).toEqual([
      'brand_picked',
      'garage_opened',
      'quote_request_started',
      'quote_request_sent',
    ]);
  });
});

// @traces 250-FR-002
describe('tracking with hostile properties', () => {
  it('sends only the allowed properties and never an id, e-mail or plate', async () => {
    keep(choice());
    const consent = await start();

    consent.track('quote_request_sent', {
      accountId: '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c',
      brand: 'dacia',
      email: 'ion@example.ro',
      garageId: '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10',
      garages: '2–3',
      jobs: 1,
      plate: 'B123ABC',
      requestId: 'r-1',
    });

    expect(analytics.event).toHaveBeenCalledWith(
      'quote_request_sent',
      '/:lang/garages/:garage',
      { brand: 'dacia', garages: '2–3', jobs: 1 },
    );
  });

  it('names the page by its template, never by the address', async () => {
    keep(choice());
    const consent = await start();

    consent.track('garage_opened', { source: 'home' });

    const template = analytics.event.mock.calls[0][1];
    expect(template).toBe('/:lang/garages/:garage');
  });

  it('does not change the properties it was given', async () => {
    keep(choice());
    const consent = await start();
    const props = { garage: 'x', source: 'profile' };

    consent.track('quote_request_started', props);

    expect(props).toEqual({ garage: 'x', source: 'profile' });
  });

  it('copes with properties given as null without breaking the flow', async () => {
    keep(choice());
    const consent = await start();

    expect(() =>
      consent.track('listing_started', null as unknown as undefined),
    ).not.toThrow();
  });

  it('sends nothing for names that exist on every object', async () => {
    keep(choice());
    const consent = await start();

    consent.track('constructor' as 'listing_started');
    consent.track('__proto__' as 'listing_started');

    expect(analytics.event).not.toHaveBeenCalled();
  });
});

// @traces 250-FR-010
describe('tracking when Plausible breaks', () => {
  it('keeps tracking the next event after one made the sink throw', async () => {
    keep(choice());
    const consent = await start();
    analytics.event.mockImplementationOnce(() => {
      throw new Error('blocked');
    });

    consent.track('listing_started');
    consent.track('listing_submitted');

    expect(analytics.event).toHaveBeenCalledTimes(2);
  });

  it('does not throw when the sink throws something that is not an error', async () => {
    keep(choice());
    const consent = await start();
    analytics.event.mockImplementation(() => {
      throw 'blocked';
    });

    expect(() => consent.track('listing_started')).not.toThrow();
  });

  it('lets the consent bar still work after a sink failure', async () => {
    const consent = await start();
    analytics.event.mockImplementation(() => {
      throw new Error('blocked');
    });
    await consent.save(true);

    expect(() => consent.track('listing_started')).not.toThrow();
    expect(analytics.load).toHaveBeenCalledWith('motorfix.ro');
  });
});

// @traces 250-FR-001
describe('tracking on the server', () => {
  it('sends nothing even after a granted choice is on record and a save is made', async () => {
    keep(choice());
    const consent = await start('server');

    await consent.save(true).catch(() => undefined);
    consent.track('listing_started');

    expect(analytics.event).not.toHaveBeenCalled();
  });
});

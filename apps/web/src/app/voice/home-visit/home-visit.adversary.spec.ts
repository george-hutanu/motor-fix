import { ErrorHandler, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ANALYTICS_CONSENT_VERSION } from '@motor-fix/contracts/consent';
import { ConsentsService, type MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

import { provideHomeVisit } from './home-visit';
import {
  ANALYTICS,
  CONSENT_KEY,
  Consent,
  type StoredChoice,
} from '../../consent/consent';
import { Session } from '../../dashboard/session';

const granted: StoredChoice = {
  accountId: null,
  at: new Date(Date.now() - 86_400_000).toISOString(),
  browserConsentId: '2c1f7a52-0c1d-4c86-9a0e-3b3f1b2a9d11',
  decision: 'granted',
  language: 'ro',
  pending: false,
  textVersion: ANALYTICS_CONSENT_VERSION,
};

let analytics: { event: jest.Mock; load: jest.Mock; pageview: jest.Mock };
let errors: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

function mark(voice: string, marks: string[]) {
  const html = document.documentElement;
  html.setAttribute('data-voice', voice);
  for (const name of marks) html.setAttribute(name, '');
}

async function boot(
  options: { consent?: StoredChoice; fails?: boolean; platform?: string } = {},
) {
  if (options.consent)
    localStorage.setItem(CONSENT_KEY, JSON.stringify(options.consent));
  const meta = document.createElement('meta');
  meta.name = 'mf-analytics';
  meta.content = 'motorfix.ro';
  document.head.append(meta);
  analytics = { event: jest.fn(), load: jest.fn(), pageview: jest.fn() };
  if (options.fails)
    analytics.event.mockImplementation(() => {
      throw new Error('blocked');
    });
  errors = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHomeVisit(),
      { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
      { provide: ErrorHandler, useValue: { handleError: errors } },
      { provide: ANALYTICS, useValue: analytics },
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
      { provide: Session, useValue: { current: signal<MeDto | null>(null) } },
      {
        provide: Router,
        useValue: {
          events: new Subject(),
          navigated: true,
          routerState: {
            snapshot: { root: { firstChild: null, routeConfig: null } },
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

const visits = () =>
  analytics.event.mock.calls
    .filter(([name]) => name === 'home_visit')
    .map(([, , props]) => props);

beforeEach(() => localStorage.clear());
afterEach(() => {
  const html = document.documentElement;
  for (const name of ['data-voice', 'data-home', 'data-voice-new'])
    html.removeAttribute(name);
  for (const meta of document.querySelectorAll('meta[name="mf-analytics"]'))
    meta.remove();
  delete (window as { mfCopyVoice?: unknown }).mfCopyVoice;
  TestBed.resetTestingModule();
});

// @traces 009-FR-001 009-FR-003
describe('the Home visit under odd consent histories', () => {
  it('tells nothing under a consent of an outdated text version', async () => {
    mark('3', ['data-home', 'data-voice-new']);

    await boot({ consent: { ...granted, textVersion: 'old-version' } });
    await settle();

    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('tells nothing under a withdrawn consent', async () => {
    mark('3', ['data-home', 'data-voice-new']);

    await boot({ consent: { ...granted, decision: 'withdrawn' } });
    await settle();

    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('tells nothing under a refused consent', async () => {
    mark('3', ['data-home', 'data-voice-new']);

    await boot({ consent: { ...granted, decision: 'refused' } });
    await settle();

    expect(analytics.event).not.toHaveBeenCalled();
  });

  it('tells nothing when the visitor refuses on the page that took the voice', async () => {
    mark('3', ['data-home', 'data-voice-new']);
    const consent = await boot();

    await consent.refuse();
    await settle();

    expect(visits()).toEqual([]);
  });

  it('tells once after a refusal is changed to a grant later in the page session', async () => {
    mark('5', ['data-home', 'data-voice-new']);
    const consent = await boot();
    await consent.refuse();
    await settle();

    await consent.accept();
    await settle();

    expect(visits()).toEqual([{ voice: 5 }]);
  });

  it('tells once after grant, withdrawal and grant again', async () => {
    mark('1', ['data-home', 'data-voice-new']);
    const consent = await boot({ consent: granted });
    await consent.save(false);
    await settle();
    await consent.save(true);
    await settle();

    expect(visits()).toEqual([{ voice: 1 }]);
  });

  it('tells nothing when the take mark is absent, even for every voice', async () => {
    for (const voice of ['1', '2', '3', '4', '5']) {
      mark(voice, ['data-home']);
      await boot({ consent: granted });
      await settle();
      TestBed.resetTestingModule();
      document.documentElement.removeAttribute('data-home');
    }

    expect(visits()).toEqual([]);
  });

  it('sends a voice from 1 to 5 only, also for a damaged mark', async () => {
    mark('9', ['data-home', 'data-voice-new']);

    await boot({ consent: granted });
    await settle();

    expect(visits()).toEqual([{ voice: 1 }]);
  });
});

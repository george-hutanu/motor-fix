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
import { Voice } from '../voice';

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

// @traces 009-FR-001 009-FR-003 009-FR-010
describe('the Home visit', () => {
  it('tells a Home load that took its voice once, under a consent already given', async () => {
    mark('3', ['data-home', 'data-voice-new']);

    await boot({ consent: granted });
    await settle();

    expect(visits()).toEqual([{ voice: 3 }]);
  });

  it('tells it when consent comes later, with the voice in force then, and only once', async () => {
    mark('2', ['data-home', 'data-voice-new']);
    const consent = await boot();
    expect(visits()).toEqual([]);
    (window as { mfCopyVoice?: unknown }).mfCopyVoice = () => 4;
    TestBed.inject(Voice).apply({ enabled: [4], pinned: null });

    await consent.accept();
    await settle();
    await consent.save(false);
    await settle();
    await consent.save(true);
    await settle();

    expect(visits()).toEqual([{ voice: 4 }]);
  });

  it('tells nothing for a load that kept its voice or opened another page', async () => {
    mark('3', ['data-home']);
    await boot({ consent: granted });
    expect(visits()).toEqual([]);
    TestBed.resetTestingModule();
    localStorage.clear();
    document.documentElement.removeAttribute('data-home');

    await boot({ consent: granted });

    expect(visits()).toEqual([]);
  });

  it('lets nothing leave without consent', async () => {
    mark('3', ['data-home', 'data-voice-new']);
    const consent = await boot();

    await consent.refuse();
    await settle();

    expect(analytics.event).not.toHaveBeenCalled();
    expect(analytics.load).not.toHaveBeenCalled();
  });

  it('costs nothing and shows no error when the analytics service fails', async () => {
    mark('3', ['data-home', 'data-voice-new']);

    await boot({ consent: granted, fails: true });
    await settle();

    expect(visits()).toEqual([{ voice: 3 }]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('tells nothing on the server render', async () => {
    mark('3', ['data-home', 'data-voice-new']);

    await boot({ consent: granted, platform: 'server' });

    expect(analytics.event).not.toHaveBeenCalled();
  });
});

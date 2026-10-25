import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { ANALYTICS_CONSENT_VERSION } from '@motor-fix/contracts/consent';
import { ConsentsService, type MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

import { ANALYTICS, CONSENT_KEY, Consent, type StoredChoice } from './consent';
import { Session } from '../dashboard/session';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ACCOUNT = '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c';
const OTHER = '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10';

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
let analytics: { event: jest.Mock; load: jest.Mock; pageview: jest.Mock };
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
  calls = {} as Partial<typeof api>,
} = {}) {
  withMeta(domain);
  api = {
    consentsControllerMine: jest.fn(async () => ({
      accepted: [],
      analytics: null,
    })),
    consentsControllerRecord: jest.fn(async () => ({ id: 'r1' })),
    consentsControllerRecordMine: jest.fn(async () => ({ id: 'r2' })),
    ...calls,
  };
  analytics = { event: jest.fn(), load: jest.fn(), pageview: jest.fn() };
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

beforeEach(() => localStorage.clear());
afterEach(() => {
  jest.restoreAllMocks();
  withMeta(null);
});

const refused = (error: unknown, status = 403) =>
  jest.fn(async () => {
    throw new HttpErrorResponse({ error, status });
  });

describe('a record refused with consent_required', () => {
  // @traces 1204-FR-008
  it.each([
    ['a null body', null],
    ['a string body', 'consent_required'],
    ['a wrong code', { code: 'forbidden' }],
    ['a code in another case', { code: 'CONSENT_REQUIRED' }],
  ])('is dropped when the 403 carries %s', async (_title, error) => {
    const consent = await start({
      calls: { consentsControllerRecordMine: refused(error) },
    });
    signIn();
    await settle();

    await consent.accept();

    expect(stored()?.pending).toBe(false);
  });

  // @traces 1204-FR-008
  it('is sent again on the next page load, not dropped, and then settles', async () => {
    const first = await start({
      calls: {
        consentsControllerRecordMine: refused({ code: 'consent_required' }),
      },
    });
    signIn();
    await settle();
    await first.accept();
    const kept = stored();
    TestBed.resetTestingModule();

    await start();
    signIn();
    await settle();

    expect(kept).toMatchObject({ accountId: ACCOUNT, pending: true });
    expect(api.consentsControllerRecordMine).toHaveBeenCalledTimes(1);
    expect(stored()?.pending).toBe(false);
  });

  // @traces 1204-FR-008
  it('keeps a withdrawn decision pending the same way', async () => {
    keep(choice({ accountId: ACCOUNT, decision: 'granted' }));
    const consent = await start({
      calls: {
        consentsControllerRecordMine: refused({ code: 'consent_required' }),
      },
    });
    signIn();
    await settle();

    await consent.save(false);

    expect(stored()).toMatchObject({ decision: 'withdrawn', pending: true });
  });
});

describe('a choice bound to one account when another signs in', () => {
  // @traces 1204-FR-009
  it('is neither stored under the other account nor sent for it', async () => {
    keep(choice({ accountId: ACCOUNT, decision: 'granted', pending: true }));
    await start();

    signIn(OTHER);
    await settle();

    expect(api.consentsControllerRecordMine).not.toHaveBeenCalled();
    expect(api.consentsControllerRecord).not.toHaveBeenCalled();
    expect(stored()?.accountId).not.toBe(OTHER);
  });

  // @traces 1204-FR-009
  it('is sent once even when the same account signs in, out and in again', async () => {
    keep(choice({ accountId: ACCOUNT, pending: true }));
    await start();

    signIn();
    await settle();
    current.set(null);
    await settle();
    signIn();
    await settle();

    expect(api.consentsControllerRecordMine).toHaveBeenCalledTimes(1);
  });

  // @traces 1204-FR-009
  it('is never sent unbound while nobody is signed in', async () => {
    keep(choice({ accountId: ACCOUNT, pending: true }));
    await start();
    navigate();
    await settle();

    expect(api.consentsControllerRecord).not.toHaveBeenCalled();
    expect(api.consentsControllerRecordMine).not.toHaveBeenCalled();
  });
});

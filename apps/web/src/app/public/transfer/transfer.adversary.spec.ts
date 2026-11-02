import { HttpErrorResponse } from '@angular/common/http';
import { RESPONSE_INIT, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CarsService, type CarTransferLinkDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { TransferPage } from './transfer';
import { provideLanguageAddresses, SITE_ORIGIN } from '../../addresses';
import { Consent } from '../../consent/consent';
import { Session } from '../../dashboard/session';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

const pageStubs = () => [
  {
    provide: Session,
    useValue: {
      current: signal(null),
      load: async () => null,
      reload: async () => undefined,
      roleHint: signal(null),
      switchRole: async () => null,
    },
  },
  { provide: SignInDialog, useValue: { gate: async () => false } },
  { provide: Consent, useValue: { track: () => undefined } },
];

const refusal = (status: number, code?: string) =>
  new HttpErrorResponse({
    error: code ? { code, title: 'no' } : null,
    status,
  });

let read: jest.Mock;
let response: { status?: number };
let harness: RouterTestingHarness;

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    harness.detectChanges();
  }
}

async function open(
  answer: () => Promise<CarTransferLinkDto>,
  language: 'ro' | 'en' = 'ro',
  server = true,
) {
  read = jest.fn(answer);
  response = {};
  TestBed.configureTestingModule({
    providers: [
      ...pageStubs(),
      provideRouter([
        {
          component: TransferPage,
          data: { noindex: true },
          path: ':lang/transfer/:token',
        },
        { children: [], path: ':lang' },
      ]),
      provideLanguageAddresses(),
      { provide: SITE_ORIGIN, useValue: 'https://motorfix.ro' },
      {
        provide: CarsService,
        useValue: { carTransferLinkControllerRead: read },
      },
      ...(server ? [{ provide: RESPONSE_INIT, useValue: response }] : []),
    ],
  });
  await TestBed.inject(I18n).enter('public');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`/${language}/transfer/abc123`);
  await settle();
}

const page = () => harness.routeNativeElement as HTMLElement;
const said = () => (page().textContent ?? '').replace(/\s+/g, ' ').trim();
const heading = () => page().querySelector('h1')?.textContent?.trim();
const title = () => TestBed.inject(Title).getTitle();

afterEach(() => {
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => {
    m.remove();
  });
});

// @traces 1392-FR-005 1392-FR-006
describe('the public transfer page under odd answers', () => {
  it('serves 410 for a 410 whose code it does not know', async () => {
    await open(async () => {
      throw refusal(410, 'transfer_something_new');
    });

    expect(response.status).toBe(410);
  });

  it('serves 404 for a 404 that carries no body', async () => {
    await open(async () => {
      throw refusal(404);
    });

    expect(heading()).toBe('Linkul nu există');
    expect(response.status).toBe(404);
  });

  it.each([
    [403, 'forbidden'],
    [401, 'sign_in_required'],
    [429, 'rate_limited'],
    [503, 'error'],
  ])('does not call the link valid on a %s %s', async (status, code) => {
    await open(async () => {
      throw refusal(status, code);
    });

    expect(said()).not.toContain('Linkul e valabil');
    expect(response.status).toBeUndefined();
  });

  it('says it could not check the link when the read throws a plain error', async () => {
    await open(async () => {
      throw new Error('socket hang up');
    });

    expect(said()).toContain('Nu am putut verifica linkul. Încearcă din nou.');
    expect(response.status).toBeUndefined();
  });

  it('passes a token with encoded characters on as the address decoded it', async () => {
    read = jest.fn(async () => ({ status: 'sent' }) as CarTransferLinkDto);
    response = {};
    TestBed.configureTestingModule({
      providers: [
        ...pageStubs(),
        provideRouter([
          { component: TransferPage, path: ':lang/transfer/:token' },
          { children: [], path: ':lang' },
        ]),
        {
          provide: CarsService,
          useValue: { carTransferLinkControllerRead: read },
        },
        { provide: RESPONSE_INIT, useValue: response },
      ],
    });
    await TestBed.inject(I18n).enter('public');
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/ro/transfer/a%2Fb%20%3Cx%3E');
    await settle();

    expect(read.mock.calls[0][0]).toEqual({ token: 'a/b <x>' });
  });

  it('reads the new token when the address changes only in the token', async () => {
    await open(async () => ({ status: 'sent' }));

    await harness.navigateByUrl('/ro/transfer/other-token');
    await settle();

    expect(read.mock.calls.map((call) => call[0].token)).toContain(
      'other-token',
    );
  });

  it('leaves one robots tag, noindex, after the page is opened twice', async () => {
    await open(async () => ({ status: 'sent' }));
    await harness.navigateByUrl('/ro');
    await harness.navigateByUrl('/ro/transfer/second');
    await settle();

    const tags = [...document.head.querySelectorAll('meta[name="robots"]')];
    expect(tags.map((t) => t.getAttribute('content'))).toEqual(['noindex']);
  });

  it('replaces an index robots tag and drops the canonical link', async () => {
    const index = document.createElement('meta');
    index.setAttribute('name', 'robots');
    index.setAttribute('content', 'index,follow');
    document.head.appendChild(index);
    const canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    canonical.setAttribute('href', 'https://motorfix.ro/ro/transfer/abc123');
    document.head.appendChild(canonical);

    await open(async () => ({ status: 'sent' }));

    const tags = [...document.head.querySelectorAll('meta[name="robots"]')];
    expect(tags.map((t) => t.getAttribute('content'))).toEqual(['noindex']);
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('sets the English title to the line shown for a gone link', async () => {
    await open(async () => {
      throw refusal(410, 'transfer_expired');
    }, 'en');

    expect(title()).toBe('The link has expired');
    expect(heading()).toBe('The link has expired');
  });
});

import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type CandidateGarageDto,
  type CarDto,
  CarsService,
  type PublicGarageDto,
  QuoteRequestsService,
  type RequestDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  RequestQuote,
  type RequestQuoteData,
  type RequestQuoteResult,
} from './request-quote';
import { Consent } from '../../../consent/consent';
import { Session } from '../../../dashboard/session';
import { PlaceStore } from '../../../home/place/place-store';
import { SignInDialog } from '../../../sign-in/sign-in-dialog';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const OIL = { id: 'job-oil', nameEn: 'Oil change', nameRo: 'Schimb ulei' };
const PADS = { id: 'job-pads', nameEn: 'Brake pads', nameRo: 'Plăcuțe frână' };

const GARAGE: PublicGarageDto = {
  brand: { id: 'b-1', name: 'Dacia', slug: 'dacia', stance: 'works_on' },
  brandNote: null,
  doesNotTake: [],
  id: 'g-militari',
  jobTypes: [OIL, PADS],
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [{ fuels: ['petrol'], id: 'b-1', name: 'Dacia', slug: 'dacia' }],
};

const car = (id: string, model: string, year: number): CarDto => ({
  brandId: 'b-1',
  brandName: 'Dacia',
  createdAt: '2026-10-01T09:00:00.000Z',
  engine: null,
  fuel: 'petrol',
  id,
  itpUntil: null,
  model,
  nextServiceKm: null,
  odometerKm: 120000,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  updatedAt: '2026-10-01T09:00:00.000Z',
  year,
});
const LOGAN = car('car-logan', 'Logan', 2017);
const _DUSTER = car('car-duster', 'Duster', 2021);

const _candidate = (
  id: string,
  name: string,
  distanceKm: number | null = 3.2,
): CandidateGarageDto => ({
  comesToYou: distanceKm === null,
  distanceKm,
  id,
  name,
  slug: id,
});

// The garages named in `sameDay` usually answer the same day.
const sent = (names: string[], sameDay: string[] = []): RequestDto =>
  ({
    booking: null,
    car: {
      brand: 'Dacia',
      engine: null,
      fuel: 'petrol',
      model: 'Logan',
      year: 2017,
    },
    closedAt: null,
    closedReason: null,
    createdAt: '2026-10-09T09:00:00.000Z',
    description: null,
    expiresAt: '2026-10-16T09:00:00.000Z',
    id: 'req-1',
    jobs: [],
    quotes: [],
    quotesCount: 0,
    recipients: names.map((name, i) => ({
      answeredAt: null,
      answersSameDay: sameDay.includes(name),
      createdAt: '2026-10-09T09:00:00.000Z',
      declineReason: null,
      garage: { id: `g-${i}`, name, slug: `g-${i}` },
      id: `r-${i}`,
      status: 'waiting',
    })),
    status: 'sent',
  }) as RequestDto;

const BUCHAREST = {
  label: 'Piața Unirii',
  lat: 44.4268,
  lng: 26.1025,
  origin: 'address' as const,
};

let list: jest.Mock;
let send: jest.Mock;
let nearby: jest.Mock;
let onSent: jest.Mock;
let track: jest.Mock;
let gate: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

let _result: Promise<unknown>;

async function open(
  options: {
    cars?: CarDto[];
    candidates?: CandidateGarageDto[];
    place?: typeof BUCHAREST | null;
    source?: RequestQuoteData['source'];
    language?: 'ro' | 'en';
    garage?: PublicGarageDto;
    reply?: RequestDto;
    token?: string | null;
    hint?: 'driver' | null;
    signsIn?: boolean;
    jobTypeIds?: string[];
  } = {},
) {
  list = jest.fn(async () => ({ items: options.cars ?? [LOGAN] }));
  gate = jest.fn(async () => options.signsIn ?? false);
  send = jest.fn(async () => options.reply ?? sent([GARAGE.name]));
  nearby = jest.fn(async () => ({ items: options.candidates ?? [] }));
  onSent = jest.fn();
  track = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Consent, useValue: { track } },
      {
        provide: Session,
        useValue: {
          roleHint: signal(options.hint ?? null),
          token: () => (options.token === undefined ? 'access' : options.token),
        },
      },
      { provide: SignInDialog, useValue: { gate } },
      { provide: CarsService, useValue: { carsControllerList: list } },
      {
        provide: QuoteRequestsService,
        useValue: {
          quoteRequestsControllerCandidates: nearby,
          quoteRequestsControllerSend: send,
        },
      },
    ],
  });
  const place = options.place === undefined ? BUCHAREST : options.place;
  if (place) TestBed.inject(PlaceStore).use(place);
  await TestBed.inject(I18n).enter('public');
  if (options.language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  _result = host.componentInstance.overlays.open<
    RequestQuoteResult,
    RequestQuoteData
  >(RequestQuote, {
    data: {
      garage: options.garage ?? GARAGE,
      sent: onSent,
      source: options.source ?? 'profile_direct',
      ...(options.jobTypeIds && { jobTypeIds: options.jobTypeIds }),
    },
    shape: 'dialog',
    title: 'public.requestQuote.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

const _link = (name: string) =>
  [...panel().querySelectorAll<HTMLAnchorElement>('a')].find(
    (a) => a.textContent?.trim() === name,
  );

const _select = () => panel().querySelector('select') as HTMLSelectElement;
const textarea = () => panel().querySelector('textarea') as HTMLTextAreaElement;

const jobSwitch = (name: string) =>
  [
    ...panel().querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
  ].find((s) => s.getAttribute('aria-label') === name) as HTMLButtonElement;

const _tick = (name: string) => {
  const label = [...panel().querySelectorAll('label.garage')].find((l) =>
    l.textContent?.includes(name),
  );
  return label?.querySelector('input[type="checkbox"]') as HTMLInputElement;
};

function type(value: string) {
  textarea().value = value;
  textarea().dispatchEvent(new Event('input', { bubbles: true }));
}

const press = async (label = 'Trimite') => {
  button(label)?.click();
  await settle();
};

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.restoreAllMocks();
});

// @traces 356-FR-011
describe('the dialog prefill, hostile', () => {
  const checked = () =>
    [
      ...panel().querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
    ].map((s) => [
      s.getAttribute('aria-label'),
      s.getAttribute('aria-checked'),
    ]);

  it('ticks a job once and sends it once when the ids repeat it', async () => {
    await open({ jobTypeIds: [OIL.id, OIL.id, OIL.id] });
    await press();

    expect(send.mock.calls[0][0].body.jobTypeIds).toEqual([OIL.id]);
  });

  it('ticks nothing and asks for a description when every id is unknown', async () => {
    await open({ jobTypeIds: ['job-gone', 'job-also-gone'] });

    expect(checked()).toEqual([
      ['Schimb ulei', 'false'],
      ['Plăcuțe frână', 'false'],
    ]);
    type('Frâna');
    await press();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel puțin 10 caractere');
  });

  it('sends a handed-over job with no description, which a ticked job allows', async () => {
    await open({ jobTypeIds: [OIL.id] });
    await press();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('asks for a description again once the handed-over job is switched off', async () => {
    await open({ jobTypeIds: [OIL.id] });

    jobSwitch('Schimb ulei').click();
    await settle();
    await press();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel puțin 10 caractere');
  });

  it('ticks nothing for names that are not ids of a job', async () => {
    await open({
      jobTypeIds: ['__proto__', 'constructor', 'toString', 'Schimb ulei'],
    });

    expect(checked()).toEqual([
      ['Schimb ulei', 'false'],
      ['Plăcuțe frână', 'false'],
    ]);
  });

  it('ticks both jobs handed over and sends them in the garage’s order', async () => {
    await open({ jobTypeIds: [PADS.id, OIL.id] });
    await press();

    expect([...send.mock.calls[0][0].body.jobTypeIds].sort()).toEqual([
      OIL.id,
      PADS.id,
    ]);
  });

  it('ticks nothing and does not fail for a garage that lists no jobs', async () => {
    await open({
      garage: { ...GARAGE, jobTypes: [] },
      jobTypeIds: [OIL.id],
    });

    expect(panel().querySelectorAll('button[role="switch"]')).toHaveLength(0);
    expect(textarea().tagName).toBe('TEXTAREA');
  });

  it('does not mark the description for focus when a job is handed over', async () => {
    await open({ jobTypeIds: [OIL.id] });

    expect(textarea().hasAttribute('autofocus')).toBe(false);
  });

  it('does not mark the description for focus after the handed-over job is switched off', async () => {
    await open({ jobTypeIds: [OIL.id] });
    jobSwitch('Schimb ulei').click();
    await settle();

    expect(textarea().hasAttribute('autofocus')).toBe(false);
  });
});

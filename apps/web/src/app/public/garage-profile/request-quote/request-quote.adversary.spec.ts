import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type CarDto,
  CarsService,
  type PublicGarageDto,
  QuoteRequestsService,
  type RequestDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { RequestQuote, type RequestQuoteData } from './request-quote';
import { PlaceStore } from '../../../home/place/place-store';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const GARAGE = {
  brand: { id: 'b-1', name: 'Dacia', slug: 'dacia', stance: 'works_on' },
  brandNote: null,
  doesNotTake: [],
  id: 'g-0',
  jobTypes: [],
  name: 'Atelier Dinamo',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'atelier-dinamo',
  verifiedAt: null,
  worksOn: [{ fuels: ['petrol'], id: 'b-1', name: 'Dacia', slug: 'dacia' }],
} as unknown as PublicGarageDto;

const LOGAN = {
  brandId: 'b-1',
  brandName: 'Dacia',
  createdAt: '2026-10-01T09:00:00.000Z',
  engine: null,
  fuel: 'petrol',
  id: 'car-logan',
  itpUntil: null,
  model: 'Logan',
  odometerKm: 1,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  year: 2017,
} as CarDto;

type Flag = boolean | null | undefined | string;

const reply = (rows: Array<[string, Flag]>): RequestDto =>
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
    recipients: rows.map(([name, flag], i) => ({
      answeredAt: null,
      ...(flag === undefined ? {} : { answersSameDay: flag }),
      createdAt: '2026-10-09T09:00:00.000Z',
      declineReason: null,
      garage: { id: `g-${i}`, name, slug: `g-${i}` },
      id: `r-${i}`,
      status: 'waiting',
    })),
    status: 'sent',
  }) as unknown as RequestDto;

let send: jest.Mock;
let others: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const lines = () =>
  [...panel().querySelectorAll('.done[role="status"] p')].map((p) =>
    clean(p.textContent),
  );
const items = () =>
  [...panel().querySelectorAll('.done li')].map((li) => clean(li.textContent));

async function sendWith(answer: RequestDto, language: 'ro' | 'en' = 'ro') {
  send = jest.fn(async () => answer);
  others = jest.fn(async () => ({ items: [] }));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: CarsService,
        useValue: { carsControllerList: async () => ({ items: [LOGAN] }) },
      },
      {
        provide: QuoteRequestsService,
        useValue: {
          quoteRequestsControllerCandidates: others,
          quoteRequestsControllerSend: send,
        },
      },
    ],
  });
  TestBed.inject(PlaceStore).use({
    label: 'Piața Unirii',
    lat: 44.4268,
    lng: 26.1025,
    origin: 'address',
  });
  await TestBed.inject(I18n).enter('public');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  TestBed.createComponent(Host).componentInstance.overlays.open<
    unknown,
    RequestQuoteData
  >(RequestQuote, {
    data: { garage: GARAGE, sent: jest.fn(), source: 'profile_direct' },
    shape: 'dialog',
    title: 'public.requestQuote.title',
  });
  await settle();
  const area = panel().querySelector('textarea') as HTMLTextAreaElement;
  area.value = 'Scârțâie la frânare';
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  [...panel().querySelectorAll('button')]
    .find(
      (b) => b.textContent?.trim() === (language === 'en' ? 'Send' : 'Trimite'),
    )
    ?.click();
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.restoreAllMocks();
});

// @traces 1025-FR-003
describe('the confirmation when the flag is missing or malformed', () => {
  it('shows no answering line when answersSameDay is absent from the recipient', async () => {
    await sendWith(reply([['Atelier Dinamo', undefined]]));

    expect(lines()).toEqual(['Trimis către Atelier Dinamo.']);
    expect(panel().querySelectorAll('.done p')).toHaveLength(1);
  });

  it('shows no answering line when answersSameDay is null', async () => {
    await sendWith(reply([['Atelier Dinamo', null]]));

    expect(lines()).toEqual(['Trimis către Atelier Dinamo.']);
  });

  it('shows no answering line when answersSameDay is the string "false"', async () => {
    await sendWith(reply([['Atelier Dinamo', 'false']]));

    expect(lines()).toEqual(['Trimis către Atelier Dinamo.']);
  });

  it('leaves a list of names with nothing qualifying free of any sentence', async () => {
    await sendWith(
      reply([
        ['Atelier Dinamo', false],
        ['Mecanic Mobil', undefined],
      ]),
    );

    expect(items()).toEqual(['Atelier Dinamo', 'Mecanic Mobil']);
    expect(panel().querySelectorAll('.done li')).toHaveLength(2);
  });
});

// @traces 1025-FR-001
// @traces 1025-FR-006
describe('the confirmation with several qualifying garages', () => {
  it('turns every qualifying item into its own sentence and keeps the order', async () => {
    await sendWith(
      reply([
        ['Atelier Dinamo', true],
        ['Mecanic Mobil', false],
        ['Service Berceni', true],
      ]),
    );

    expect(lines()).toEqual(['Trimis către 3 service‑uri.']);
    expect(items()).toEqual([
      'Atelier Dinamo răspunde de obicei în aceeași zi.',
      'Mecanic Mobil',
      'Service Berceni răspunde de obicei în aceeași zi.',
    ]);
  });

  it('puts all five recipients as sentences when all qualify, in English', async () => {
    const names = ['A', 'B', 'C', 'D', 'E'].map((l) => `Atelier ${l}`);

    await sendWith(reply(names.map((n) => [n, true] as [string, Flag])), 'en');

    expect(lines()).toEqual(['Sent to 5 garages.']);
    expect(items()).toEqual(
      names.map((n) => `${n} usually answers the same day.`),
    );
  });

  it('adds no answering paragraph for several recipients', async () => {
    await sendWith(
      reply([
        ['Atelier Dinamo', true],
        ['Mecanic Mobil', true],
      ]),
    );

    expect(panel().querySelectorAll('.done p')).toHaveLength(1);
  });
});

// @traces 1025-FR-001
describe('the answering line with hostile garage names', () => {
  it('renders markup in a name as text, never as elements', async () => {
    const name = '<img src=x onerror=alert(1)> & <b>Bold</b>';

    await sendWith(reply([[name, true]]));

    expect(lines()).toEqual([
      'Trimis către <img src=x onerror=alert(1)> & <b>Bold</b>.',
      `${name} răspunde de obicei în aceeași zi.`,
    ]);
    expect(panel().querySelector('.done img, .done b')).toBeNull();
  });

  it('keeps a name that looks like a placeholder or message syntax intact', async () => {
    const name = "{garage} {n, plural, one {x} other {y}} 'quoted'";

    await sendWith(reply([[name, true]]));

    expect(lines()[1]).toBe(`${name} răspunde de obicei în aceeași zi.`);
  });

  it('keeps a very long name whole in one sentence', async () => {
    const name = `Atelier ${'Lung'.repeat(250)}`;

    await sendWith(reply([[name, true]]));

    expect(lines()[1]).toBe(`${name} răspunde de obicei în aceeași zi.`);
  });

  it('keeps unicode and emoji in a name', async () => {
    const name = 'Ateliérul Ștefan Țâră 🔧';

    await sendWith(reply([[name, true]]), 'en');

    expect(lines()).toEqual([
      `Sent to ${name}.`,
      `${name} usually answers the same day.`,
    ]);
  });
});

// @traces 1025-FR-005
describe('the answering line and the send', () => {
  it('sends once and asks no one else for the line', async () => {
    await sendWith(reply([['Atelier Dinamo', true]]));

    expect(send).toHaveBeenCalledTimes(1);
    expect(others).toHaveBeenCalledTimes(1);
    expect(lines()).toContain(
      'Atelier Dinamo răspunde de obicei în aceeași zi.',
    );
  });

  it('shows the answering line once, not twice, after the confirmation settles again', async () => {
    await sendWith(reply([['Atelier Dinamo', true]]));
    await settle();
    await settle();

    expect(lines().filter((l) => l.includes('aceeași zi'))).toHaveLength(1);
  });
});

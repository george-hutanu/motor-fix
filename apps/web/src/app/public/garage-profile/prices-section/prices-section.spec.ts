import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { PricesSection } from './prices-section';

const row = (
  jobTypeId: string,
  nameRo: string,
  nameEn: string,
  fromBani: number,
  toBani: number,
  durationMinutes?: number,
) => ({
  fromBani,
  jobTypeId,
  nameEn,
  nameRo,
  toBani,
  ...(durationMinutes === undefined ? {} : { durationMinutes }),
});

const DIAGNOSIS = row(
  'j-diag',
  'Diagnoză și citire coduri de eroare',
  'Diagnosis and fault-code read',
  15_000,
  22_000,
  30,
);
const BRAKES = row(
  'j-brakes',
  'Plăcuțe și discuri de frână față',
  'Front brake pads and discs',
  89_000,
  140_000,
  120,
);
const CHAIN = row(
  'j-chain',
  'Kit lanț de distribuție',
  'Timing chain kit',
  420_000,
  680_000,
  480,
);

const GARAGE: PublicGarageDto = {
  brandNote: null,
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  labour: { fromBani: 18_000, toBani: 24_000 },
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [DIAGNOSIS, BRAKES, CHAIN],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
};

@Component({
  imports: [PricesSection],
  template: `<section
    data-slot="prices"
    mf-prices-section
    [garage]="garage()"
  ></section>`,
})
class Host {
  readonly garage = signal(GARAGE);
}

let fixture: ComponentFixture<Host>;

beforeEach(async () => {
  TestBed.configureTestingModule({});
  await TestBed.inject(I18n).enter('public');
  await TestBed.inject(I18n).use('ro');
  fixture = TestBed.createComponent(Host);
  await settle();
});

afterEach(() => fixture.destroy());

async function settle() {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function show(garage: Partial<PublicGarageDto>) {
  fixture.componentInstance.garage.set({ ...GARAGE, ...garage });
  await settle();
}

async function english() {
  await TestBed.inject(I18n).use('en');
  await settle();
}

const section = () =>
  fixture.nativeElement.querySelector('section') as HTMLElement;
const text = (el: Node | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
// Every piece of text an element shows, in order, so nothing else can hide
// between them.
const parts = (el: Element | undefined) => {
  const found: string[] = [];
  const walker = document.createTreeWalker(
    el ?? document.createElement('div'),
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = text(node);
    if (value) found.push(value);
  }
  return found;
};
const rows = () => [...section().querySelectorAll<HTMLElement>('.row')];
const switches = () => [
  ...section().querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
];
const switchOf = (name: string) =>
  switches().find((button) => button.getAttribute('aria-label') === name);
const rowOf = (name: string) =>
  rows().find((r) => text(r).includes(name)) as HTMLElement | undefined;

// @traces 355-price-list-ranges-FR-006
// @traces 355-price-list-ranges-FR-016
describe('the price list section', () => {
  it('is a region named as the price list, holding its h2 heading', () => {
    expect(section().getAttribute('aria-label')).toBe('Lista de prețuri');
    expect(text(section().querySelector('h2'))).toBe('Lista de prețuri');
  });

  it('opens with the intro, the labour rate and what a range includes', () => {
    expect(text(section().querySelector('.intro'))).toBe(
      'Pornește ce ai nevoie. Prețurile sunt intervale, pentru că lucrarea depinde de mașină. Manopera este 180–240 lei / oră.',
    );
    expect(text(section().querySelector('.includes'))).toBe(
      'Prețurile includ piese și manoperă, cu TVA, și sunt orientative.',
    );
  });

  it('says it all in English', async () => {
    await english();

    expect(section().getAttribute('aria-label')).toBe('Price list');
    expect(text(section().querySelector('h2'))).toBe('Price list');
    expect(text(section().querySelector('.intro'))).toBe(
      'Switch on what you need. Prices are ranges, because the job depends on the car. Labour is 180–240 lei / hour.',
    );
    expect(text(section().querySelector('.includes'))).toBe(
      'Prices include parts and labour, VAT included, and are a guide.',
    );
  });

  it('leaves the labour sentence out when the garage gave no labour range', async () => {
    await show({ labour: undefined });

    expect(text(section().querySelector('.intro'))).toBe(
      'Pornește ce ai nevoie. Prețurile sunt intervale, pentru că lucrarea depinde de mașină.',
    );
  });
});

// @traces 355-price-list-ranges-FR-007
// @traces 355-price-list-ranges-FR-008
// @traces 355-price-list-ranges-FR-009
// @traces 355-price-list-ranges-FR-014
describe('the rows of the price list', () => {
  it('shows each job with its name, duration and range, in the order given', () => {
    expect(rows().map((r) => text(r.querySelector('.name')))).toEqual([
      'Diagnoză și citire coduri de eroare',
      'Plăcuțe și discuri de frână față',
      'Kit lanț de distribuție',
    ]);
    expect(rows().map((r) => text(r.querySelector('.duration')))).toEqual([
      '30 min',
      '2 h',
      '1 zi',
    ]);
    expect(rows().map((r) => text(r.querySelector('.range')))).toEqual([
      '150–220 lei',
      '890–1.400 lei',
      '4.200–6.800 lei',
    ]);
  });

  it('writes names, durations and numbers the English way', async () => {
    await english();

    expect(rows().map((r) => text(r.querySelector('.name')))).toEqual([
      'Diagnosis and fault-code read',
      'Front brake pads and discs',
      'Timing chain kit',
    ]);
    expect(text(rows()[2]?.querySelector('.duration'))).toBe('1 day');
    expect(text(rows()[1]?.querySelector('.range'))).toBe('890–1,400 lei');
  });

  it('shows one amount when both ends are equal', async () => {
    await show({ prices: [{ ...BRAKES, fromBani: 30_000, toBani: 30_000 }] });

    expect(text(rows()[0]?.querySelector('.range'))).toBe('300 lei');
  });

  it('rounds bani to the nearest whole leu, never truncating', async () => {
    await show({
      labour: { fromBani: 18_049, toBani: 24_050 },
      prices: [{ ...BRAKES, fromBani: 89_050, toBani: 139_949 }],
    });

    expect(text(rows()[0]?.querySelector('.range'))).toBe('891–1.399 lei');
    expect(text(section().querySelector('.intro'))).toContain(
      'Manopera este 180–241 lei / oră.',
    );
  });

  it('shows no duration for a job without one', async () => {
    const { durationMinutes: _, ...noDuration } = BRAKES;
    await show({ prices: [noDuration] });

    expect(rows()[0]?.querySelector('.duration')).toBeNull();
    expect(parts(rows()[0])).toEqual([
      'Plăcuțe și discuri de frână față',
      '890–1.400 lei',
    ]);
  });
});

// @traces 355-price-list-ranges-FR-010
describe('a garage with no public price', () => {
  it('shows the heading and the empty text, and nothing else', async () => {
    await show({ prices: [] });

    expect(text(section().querySelector('h2'))).toBe('Lista de prețuri');
    expect(parts(section())).toEqual([
      'Lista de prețuri',
      'Service‑ul nu și‑a publicat încă prețurile.',
    ]);
    expect(section().querySelector('.intro')).toBeNull();
    expect(section().querySelector('.includes')).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it('says so in English', async () => {
    await show({ labour: undefined, prices: [] });
    await english();

    expect(parts(section())).toEqual([
      'Price list',
      'The garage has not published its prices yet.',
    ]);
  });
});

// @traces 355-price-list-ranges-FR-011
// @traces 355-price-list-ranges-FR-016
describe('the switch on each row', () => {
  it('is off on load and named by its job', () => {
    expect(switches()).toHaveLength(3);
    expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
    ]);
    expect(switches().map((s) => s.getAttribute('aria-label'))).toEqual([
      'Diagnoză și citire coduri de eroare',
      'Plăcuțe și discuri de frână față',
      'Kit lanț de distribuție',
    ]);
  });

  it('is named by the English name in English', async () => {
    await english();

    expect(switches()[0]?.getAttribute('aria-label')).toBe(
      'Diagnosis and fault-code read',
    );
  });

  it('turns on alone, and leaves the ranges as they were', async () => {
    switchOf('Plăcuțe și discuri de frână față')?.click();
    await settle();

    expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(rows().map((r) => text(r.querySelector('.range')))).toEqual([
      '150–220 lei',
      '890–1.400 lei',
      '4.200–6.800 lei',
    ]);
  });

  it('turns on when the row itself is clicked', async () => {
    rowOf('Kit lanț de distribuție')
      ?.querySelector<HTMLElement>('.name')
      ?.click();
    await settle();

    expect(
      switchOf('Kit lanț de distribuție')?.getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('turns back off on a second press', async () => {
    switchOf('Kit lanț de distribuție')?.click();
    await settle();
    switchOf('Kit lanț de distribuție')?.click();
    await settle();

    expect(
      switchOf('Kit lanț de distribuție')?.getAttribute('aria-checked'),
    ).toBe('false');
  });
});

// @traces 355-price-list-ranges-FR-011
// @traces 355-price-list-ranges-FR-012
describe('the price list read again', () => {
  it('keeps the switch of a job still listed and shows its new range', async () => {
    switchOf('Plăcuțe și discuri de frână față')?.click();
    await settle();

    await show({
      prices: [
        DIAGNOSIS,
        { ...BRAKES, fromBani: 99_000, toBani: 150_000 },
        CHAIN,
      ],
    });

    expect(
      switchOf('Plăcuțe și discuri de frână față')?.getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    expect(
      text(rowOf('Plăcuțe și discuri de frână față')?.querySelector('.range')),
    ).toBe('990–1.500 lei');
  });

  it('drops the switch of a job no longer listed, so it is off if it comes back', async () => {
    switchOf('Kit lanț de distribuție')?.click();
    await settle();

    await show({ prices: [DIAGNOSIS, BRAKES] });
    expect(rowOf('Kit lanț de distribuție')).toBeUndefined();

    await show({ prices: [DIAGNOSIS, BRAKES, CHAIN] });
    expect(
      switchOf('Kit lanț de distribuție')?.getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('swaps the list without a live region', async () => {
    await show({ prices: [DIAGNOSIS] });

    expect(
      section().querySelector('[aria-live], [role="status"], [role="alert"]'),
    ).toBeNull();
    expect(section().hasAttribute('aria-live')).toBe(false);
  });
});

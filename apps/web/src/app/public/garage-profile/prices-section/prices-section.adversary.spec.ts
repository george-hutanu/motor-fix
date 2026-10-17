import { Component, effect, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { PricesSection } from './prices-section';
import { PriceSelection } from '../price-selection/price-selection';

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

const A = row('j-a', 'Lucrare A', 'Job A', 15_000, 22_000, 30);
const B = row('j-b', 'Lucrare B', 'Job B', 89_000, 140_000, 120);
const C = row('j-c', 'Lucrare C', 'Job C', 10_000, 20_000);

const GARAGE: PublicGarageDto = {
  brandNote: null,
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  labour: { fromBani: 18_000, toBani: 24_000 },
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [A, B, C],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
};

// The page binds the shared selection to every answer it reads.
@Component({
  imports: [PricesSection],
  providers: [PriceSelection],
  template: `<section
    data-slot="prices"
    mf-prices-section
    [garage]="garage()"
  ></section>`,
})
class Host {
  readonly garage = signal(GARAGE);
  readonly selection = inject(PriceSelection);

  constructor() {
    effect(() => this.selection.sync(this.garage()));
  }
}

let fixture: ComponentFixture<Host>;

beforeEach(async () => {
  sessionStorage.clear();
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

const section = () =>
  fixture.nativeElement.querySelector('section') as HTMLElement;
const text = (el: Node | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = () => [...section().querySelectorAll<HTMLElement>('.row')];
const switches = () => [
  ...section().querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
];
const switchOf = (name: string) =>
  switches().find((b) => b.getAttribute('aria-label') === name);
const checkedNames = () =>
  switches()
    .filter((b) => b.getAttribute('aria-checked') === 'true')
    .map((b) => b.getAttribute('aria-label'));
const ranges = () => rows().map((r) => text(r.querySelector('.range')));

async function turnOn(name: string) {
  switchOf(name)?.click();
  await settle();
}

// @traces 355-FR-010
describe('the price list section when it has nothing to list', () => {
  it('shows only the heading and the empty line, even with a labour range', async () => {
    await show({ prices: [] });

    expect(text(section().querySelector('h2'))).toBe('Lista de prețuri');
    expect(section().querySelector('.empty')?.textContent).toMatch(
      /^Service.ul nu și.a publicat încă prețurile\.$/,
    );
    expect(section().children).toHaveLength(2);
    expect(switches()).toHaveLength(0);
  });

  it('says the empty line in English', async () => {
    await TestBed.inject(I18n).use('en');
    await show({ prices: [] });

    expect(text(section().querySelector('.empty'))).toBe(
      'The garage has not published its prices yet.',
    );
    expect(section().children).toHaveLength(2);
  });

  it('goes back to the full list when rows return', async () => {
    await show({ prices: [] });
    await show({ prices: [A] });

    expect(rows()).toHaveLength(1);
    expect(section().querySelector('.empty')).toBeNull();
  });
});

// @traces 355-FR-008
// @traces 355-FR-009
describe('the price list rows with hostile data', () => {
  it('rounds bani to the nearest leu, never truncating', async () => {
    await show({
      prices: [
        row('j-1', 'x', 'x', 14_950, 22_049),
        row('j-2', 'y', 'y', 14_949, 99_999),
      ],
    });

    expect(ranges()).toEqual(['150–220 lei', '149–1.000 lei']);
  });

  it('writes one amount when rounding makes the ends meet', async () => {
    await show({ prices: [row('j-1', 'x', 'x', 29_950, 30_049)] });

    expect(ranges()).toEqual(['300 lei']);
  });

  it('writes a labour range with equal ends as one amount', async () => {
    await show({ labour: { fromBani: 20_000, toBani: 20_000 } });

    expect(text(section().querySelector('.intro'))).toContain(
      'Manopera este 200 lei / oră.',
    );
  });

  it('shows a reversed range as stored', async () => {
    await show({ prices: [row('j-1', 'x', 'x', 22_000, 15_000)] });

    expect(ranges()).toEqual(['220–150 lei']);
  });

  it('shows a zero lei range as 0 lei', async () => {
    await show({ prices: [row('j-1', 'x', 'x', 0, 0)] });

    expect(ranges()).toEqual(['0 lei']);
  });

  it.each([0, -30])('shows no duration for %i minutes', async (minutes) => {
    await show({ prices: [row('j-1', 'x', 'x', 100, 200, minutes)] });

    expect(section().querySelector('.duration')).toBeNull();
  });

  it('shows the job name as text, never as markup', async () => {
    await show({
      prices: [row('j-1', '<img src=x onerror=alert(1)>', '<b>x</b>', 1, 2)],
    });

    expect(section().querySelector('img')).toBeNull();
    expect(text(section().querySelector('.name'))).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('names the switch with the exact unicode job name', async () => {
    const name = 'Înlocuire curea „distribuție” 🚗 ăâîșț';
    await show({ prices: [row('j-1', name, 'en', 1, 2)] });

    expect(switchOf(name)).toBeDefined();
  });

  it('takes the English name in English even when it equals another job’s Romanian name', async () => {
    await TestBed.inject(I18n).use('en');
    await show({
      prices: [
        row('j-1', 'Same', 'Alpha', 1, 2),
        row('j-2', 'Beta', 'Same', 1, 2),
      ],
    });

    expect(rows().map((r) => text(r.querySelector('.name')))).toEqual([
      'Alpha',
      'Same',
    ]);
  });

  it('renders two thousand rows with a switch each', async () => {
    await show({
      prices: Array.from({ length: 2_000 }, (_, i) =>
        row(`j-${i}`, `Lucrare ${i}`, `Job ${i}`, 100, 200),
      ),
    });

    expect(rows()).toHaveLength(2_000);
    expect(switches()).toHaveLength(2_000);
  }, 30_000);
});

// @traces 355-FR-011
describe('the switches of the price list', () => {
  it('starts with every switch off', () => {
    expect(checkedNames()).toEqual([]);
    expect(switches().map((b) => b.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
    ]);
  });

  it('turns on only the switch tapped and leaves the ranges as they were', async () => {
    const before = ranges();

    await turnOn('Lucrare B');

    expect(checkedNames()).toEqual(['Lucrare B']);
    expect(ranges()).toEqual(before);
  });

  it('turns a switch off again on a second tap', async () => {
    await turnOn('Lucrare B');
    await turnOn('Lucrare B');

    expect(checkedNames()).toEqual([]);
  });

  it('turns the switch on when its row text is clicked', async () => {
    (rows()[1].querySelector('.name') as HTMLElement).click();
    await settle();

    expect(checkedNames()).toEqual(['Lucrare B']);
  });

  it('keeps a switch on when a re-read changes only that job’s range', async () => {
    await turnOn('Lucrare B');

    await show({ prices: [A, { ...B, fromBani: 100, toBani: 200 }, C] });

    expect(checkedNames()).toEqual(['Lucrare B']);
    expect(ranges()[1]).toBe('1–2 lei');
  });

  it('keeps a switch on when the list is reordered', async () => {
    await turnOn('Lucrare B');

    await show({ prices: [C, B, A] });

    expect(checkedNames()).toEqual(['Lucrare B']);
  });

  it('keeps the state when the language changes', async () => {
    await turnOn('Lucrare B');

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(checkedNames()).toEqual(['Job B']);
  });

  it('drops the state of a job that left, so it is off when it returns', async () => {
    await turnOn('Lucrare B');
    await turnOn('Lucrare C');

    await show({ prices: [A, C] });
    expect(checkedNames()).toEqual(['Lucrare C']);

    await show({ prices: [A, B, C] });
    expect(checkedNames()).toEqual(['Lucrare C']);
  });

  it('drops every state when the list empties and comes back', async () => {
    await turnOn('Lucrare A');

    await show({ prices: [] });
    await show({ prices: [A, B, C] });

    expect(checkedNames()).toEqual([]);
  });

  it('never carries a state to a different job that has a new id', async () => {
    await turnOn('Lucrare A');

    await show({ prices: [{ ...A, jobTypeId: 'j-a2' }, B, C] });

    expect(checkedNames()).toEqual([]);
  });
});

// @traces 355-FR-016
describe('the price list section for assistive technology', () => {
  it('names the region, holds one h2 and no live region', () => {
    expect(section().getAttribute('aria-label')).toBe('Lista de prețuri');
    expect(section().querySelectorAll('h2')).toHaveLength(1);
    expect(
      section().querySelector('[aria-live], [role="alert"], [role="status"]'),
    ).toBeNull();
  });

  it('keeps no live region after a re-read', async () => {
    await show({ prices: [A] });

    expect(
      section().querySelector('[aria-live], [role="alert"], [role="status"]'),
    ).toBeNull();
  });

  it('names each switch by its job and gives every switch its own id', () => {
    const ids = switches().map((b) => b.id);

    expect(switches().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Lucrare A',
      'Lucrare B',
      'Lucrare C',
    ]);
    expect(new Set(ids).size).toBe(3);
  });

  it('keeps each switch reachable by the keyboard', () => {
    expect(switches().map((b) => b.tabIndex)).toEqual([0, 0, 0]);
  });
});

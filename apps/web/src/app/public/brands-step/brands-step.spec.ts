import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BrandsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { BrandsStep } from './brands-step';

// @traces 040-FR-001 040-FR-002 040-FR-003 040-FR-004 040-FR-005 040-FR-006 040-FR-007

const NAMES = [
  'BMW',
  'Mini',
  'Mercedes-Benz',
  'Audi',
  'Volkswagen',
  'Škoda',
  'Dacia',
  'Renault',
  'Ford',
  'Toyota',
  'Hyundai',
  'Tesla',
  'Kia',
  'Opel',
  'Peugeot',
  'Citroën',
  'Fiat',
  'Seat',
  'Volvo',
  'Mazda',
];
const brand = (name: string, i: number) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name,
  popularity: i + 1,
  slug: name.toLowerCase(),
});
const CATALOGUE = NAMES.map(brand);
const LADA = { ...brand('Lada', 99), popularity: null };
type Brand = Omit<ReturnType<typeof brand>, 'popularity'> & {
  popularity: number | null;
};
const page = (items: Brand[]) => ({
  items,
  nextCursor: null,
  total: items.length,
});

let search: jest.Mock;

async function open(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: BrandsService, useValue: { brandsControllerSearch: search } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(BrandsStep);
  await settle(fixture);
  const step = fixture.nativeElement as HTMLElement;
  return { fixture, i18n, step };
}

type Fixture = Awaited<ReturnType<typeof open>>['fixture'];

async function settle(fixture: Fixture) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const chips = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLButtonElement>('.chips > li > button'),
];
const chip = (step: HTMLElement, name: string) => {
  const found = chips(step).find((c) => text(c).startsWith(name));
  if (!found) throw new Error(`no chip ${name}`);
  return found;
};
const counter = (step: HTMLElement) =>
  text(step.querySelector('[aria-live="polite"]'));
const field = (step: HTMLElement, name: string) =>
  step.querySelector<HTMLInputElement>(
    `input[name="${name}"]`,
  ) as HTMLInputElement;

async function tap(
  fixture: Fixture,
  step: HTMLElement,
  name: string,
  times = 1,
) {
  for (let i = 0; i < times; i++) {
    chip(step, name).click();
    await settle(fixture);
  }
}

async function type(fixture: Fixture, input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  // The search waits for the owner to stop typing.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await settle(fixture);
}

const results = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLButtonElement>('.results button'),
];

beforeEach(() => {
  search = jest.fn(async (params?: { q?: string }) => {
    if (!params?.q) return page(CATALOGUE);
    const q = params.q.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    return page(
      [...CATALOGUE, LADA].filter((b) =>
        b.name
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .toLowerCase()
          .includes(q),
      ),
    );
  });
});

describe('step 2, the brands', () => {
  it('shows the hint, the search field, the twelve most popular brands and the counter, in that order', async () => {
    const { step } = await open();

    expect(text(step.querySelector('.hint'))).toBe(
      'O apăsare: led verde, lucrezi pe ea. Încă una: led roșu, nu o primești. A treia o stinge.',
    );
    expect(chips(step).map((c) => text(c))).toEqual(NAMES.slice(0, 12));
    const order = [
      step.querySelector('.hint'),
      step.querySelector('input[type="search"]'),
      step.querySelector('.chips'),
      step.querySelector('[aria-live="polite"]'),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(counter(step)).toBe('0 primite · 0 refuzate');
  });

  it('cycles a chip off, taken, refused and off again, telling the state in words', async () => {
    const { fixture, step } = await open();
    const bmw = () => chip(step, 'BMW');

    expect(bmw().getAttribute('aria-pressed')).toBe('false');
    expect(bmw().type).toBe('button');

    await tap(fixture, step, 'BMW');
    expect(bmw().getAttribute('aria-pressed')).toBe('true');
    expect(text(bmw())).toBe('BMW lucrezi pe ea');
    expect(bmw().querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'green',
    );

    await tap(fixture, step, 'BMW');
    expect(bmw().getAttribute('aria-pressed')).toBe('true');
    expect(text(bmw())).toBe('BMW nu o primești');
    expect(bmw().querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'red',
    );

    await tap(fixture, step, 'BMW');
    expect(bmw().getAttribute('aria-pressed')).toBe('false');
    expect(text(bmw())).toBe('BMW');
  });

  it('counts the taken and the refused brands in Romanian plurals', async () => {
    const { fixture, step } = await open();

    for (const name of ['BMW', 'Mini', 'Audi', 'Dacia'])
      await tap(fixture, step, name);
    await tap(fixture, step, 'Tesla', 2);
    await tap(fixture, step, 'Renault', 2);
    expect(counter(step)).toBe('4 primite · 2 refuzate');

    await tap(fixture, step, 'Renault');
    expect(counter(step)).toBe('4 primite · 1 refuzată');

    for (const name of ['BMW', 'Mini', 'Audi'])
      await tap(fixture, step, name, 2); // taken → refused → off
    expect(counter(step)).toBe('1 primită · 1 refuzată');
  });

  it('says "de" from twenty on', async () => {
    const { i18n } = await open();

    expect(
      i18n.t('public.listing.brands.counter', {
        refused: i18n.t('public.listing.brands.refused', { count: 21 }),
        taken: i18n.t('public.listing.brands.taken', { count: 20 }),
      }),
    ).toBe('20 de primite · 21 de refuzate');
  });

  it('counts in English', async () => {
    const { fixture, step } = await open('en');

    await tap(fixture, step, 'BMW');
    await tap(fixture, step, 'Tesla', 2);
    expect(counter(step)).toBe('1 taken · 1 refused');
    expect(text(chip(step, 'BMW'))).toBe('BMW you work on it');
    expect(text(chip(step, 'Tesla'))).toBe('Tesla you do not take it');

    await tap(fixture, step, 'Mini');
    expect(counter(step)).toBe('2 taken · 1 refused');
  });

  it('adds a brand found by search as a taken chip', async () => {
    const { fixture, step } = await open();

    await type(
      fixture,
      step.querySelector('input[type="search"]') as HTMLInputElement,
      'lada',
    );
    expect(results(step).map((r) => text(r))).toEqual(['Lada']);

    results(step)[0].click();
    await settle(fixture);

    expect(chips(step)).toHaveLength(13);
    expect(chip(step, 'Lada').getAttribute('aria-pressed')).toBe('true');
    expect(text(chip(step, 'Lada'))).toBe('Lada lucrezi pe ea');
    expect(fixture.componentInstance.value().brands).toEqual([
      { brandId: LADA.id, name: 'Lada', stance: 'works_on' },
    ]);
  });

  it('marks a brand already shown in place, never twice, ignoring accents and case', async () => {
    const { fixture, step } = await open();

    await type(
      fixture,
      step.querySelector('input[type="search"]') as HTMLInputElement,
      'SKODA',
    );
    expect(results(step).map((r) => text(r))).toEqual(['Škoda']);
    results(step)[0].click();
    await settle(fixture);

    expect(chips(step)).toHaveLength(12);
    expect(text(chip(step, 'Škoda'))).toBe('Škoda lucrezi pe ea');
  });

  it('shows no results for an empty field and a line when nothing matches', async () => {
    const { fixture, step } = await open();
    const input = step.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement;

    await type(fixture, input, 'zzz');
    expect(results(step)).toHaveLength(0);
    expect(text(step.querySelector('.notice'))).toBe('Nicio marcă găsită.');

    await type(fixture, input, '');
    expect(results(step)).toHaveLength(0);
    expect(step.querySelector('.notice')).toBeNull();
  });

  it('keeps the chips working and says so when the search fails', async () => {
    const { fixture, step } = await open();
    search.mockRejectedValue(new Error('offline'));

    await type(
      fixture,
      step.querySelector('input[type="search"]') as HTMLInputElement,
      'lada',
    );

    expect(text(step.querySelector('.notice'))).toBe('Căutarea nu merge acum.');
    await tap(fixture, step, 'BMW');
    expect(counter(step)).toBe('1 primită · 0 refuzate');
  });

  it('takes a note of 140 and a phrase of 60 characters, counted as letters, and no more', async () => {
    const { fixture, step } = await open();

    await type(fixture, field(step, 'brandNote'), 'ș'.repeat(141));
    await type(fixture, field(step, 'refusalPhrase'), '🚗'.repeat(60));

    const value = fixture.componentInstance.value();
    expect([...(value.brandNote ?? '')]).toHaveLength(140);
    expect([...(value.refusalPhrase ?? '')]).toHaveLength(60);
  });

  it('trims the texts and reads a blank one as no text', async () => {
    const { fixture, step } = await open();

    await type(fixture, field(step, 'brandNote'), '   ');
    await type(fixture, field(step, 'refusalPhrase'), '  orice nu e BMW ');

    const value = fixture.componentInstance.value();
    expect(value.brandNote).toBeUndefined();
    expect(value.refusalPhrase).toBe('orice nu e BMW');
  });

  it('labels both texts with their limit', async () => {
    const { step } = await open();

    const labels = [...step.querySelectorAll('label')].map(text);
    expect(labels.some((l) => l.includes('140'))).toBe(true);
    expect(labels.some((l) => l.includes('60'))).toBe(true);
  });

  it('keeps every chip and both texts when the language changes', async () => {
    const { fixture, i18n, step } = await open();
    await tap(fixture, step, 'BMW');
    await tap(fixture, step, 'Tesla', 2);
    await type(fixture, field(step, 'brandNote'), 'Doar benzină');
    const before = fixture.componentInstance.value();

    await i18n.use('en');
    await settle(fixture);

    expect(text(step.querySelector('.hint'))).toBe(
      'Tap once: green lamp, you work on it. Again: red lamp, you do not take it. A third tap switches it off.',
    );
    expect(text(chip(step, 'BMW'))).toBe('BMW you work on it');
    expect(text(chip(step, 'Tesla'))).toBe('Tesla you do not take it');
    expect(field(step, 'brandNote').value).toBe('Doar benzină');
    expect(fixture.componentInstance.value()).toEqual(before);
  });

  it('holds only the marked brands, by id with their stance, and the texts', async () => {
    const { fixture, step } = await open();

    await tap(fixture, step, 'BMW');
    await tap(fixture, step, 'Tesla', 2);
    await tap(fixture, step, 'Mini', 3);
    await type(fixture, field(step, 'refusalPhrase'), 'orice nu e BMW');

    expect(fixture.componentInstance.value()).toEqual({
      brands: [
        { brandId: CATALOGUE[0].id, name: 'BMW', stance: 'works_on' },
        { brandId: CATALOGUE[11].id, name: 'Tesla', stance: 'does_not_take' },
      ],
      refusalPhrase: 'orice nu e BMW',
    });
  });

  it('shows a restored value: its brands as chips in their state and its texts', async () => {
    const { fixture, step } = await open();

    fixture.componentInstance.value.set({
      brandNote: 'Doar benzină',
      brands: [
        { brandId: LADA.id, name: 'Lada', stance: 'does_not_take' },
        { brandId: CATALOGUE[0].id, name: 'BMW', stance: 'works_on' },
      ],
    });
    await settle(fixture);

    expect(text(chip(step, 'Lada'))).toBe('Lada nu o primești');
    expect(text(chip(step, 'BMW'))).toBe('BMW lucrezi pe ea');
    expect(field(step, 'brandNote').value).toBe('Doar benzină');
    expect(counter(step)).toBe('1 primită · 1 refuzată');
  });
});

const fuelRow = (step: HTMLElement, name: string) =>
  chip(step, name).closest('li')?.querySelector<HTMLElement>('.fuels') ?? null;
const fuels = (step: HTMLElement, name: string) => [
  ...(fuelRow(step, name)?.querySelectorAll<HTMLButtonElement>('button') ?? []),
];
const fuel = (step: HTMLElement, name: string, label: string) => {
  const found = fuels(step, name).find(
    (f) => f.getAttribute('aria-label') === `${name}, ${label}`,
  );
  if (!found) throw new Error(`no fuel ${label} under ${name}`);
  return found;
};
const quiet = (step: HTMLElement, name: string) =>
  chip(step, name).closest('li')?.querySelector('[role="status"]') ?? null;

async function press(fixture: Fixture, button: HTMLButtonElement) {
  button.click();
  await settle(fixture);
}

describe('step 2, the fuels of a taken brand', () => {
  it('shows four fuels, all ticked, under a brand once it is taken', async () => {
    const { fixture, step } = await open();

    await tap(fixture, step, 'Dacia');

    expect(fuels(step, 'Dacia').map((f) => text(f).split(' ')[0])).toEqual([
      'Benzină',
      'Diesel',
      'Hibrid',
      'Electric',
    ]);
    for (const f of fuels(step, 'Dacia')) {
      expect(f.type).toBe('button');
      expect(f.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('names each fuel with its brand', async () => {
    const { fixture, step } = await open();
    await tap(fixture, step, 'Dacia');

    expect(
      fuels(step, 'Dacia').map((f) => f.getAttribute('aria-label')),
    ).toEqual([
      'Dacia, Benzină',
      'Dacia, Diesel',
      'Dacia, Hibrid',
      'Dacia, Electric',
    ]);
  });

  it('shows no fuels under a refused or an unmarked brand', async () => {
    const { fixture, step } = await open();

    await tap(fixture, step, 'Tesla', 2);

    expect(fuels(step, 'Tesla')).toHaveLength(0);
    expect(fuels(step, 'BMW')).toHaveLength(0);
  });

  it('unticks a fuel and ticks it again, holding the ticked ones in the value', async () => {
    const { fixture, step } = await open();
    await tap(fixture, step, 'Dacia');

    await press(fixture, fuel(step, 'Dacia', 'Electric'));

    expect(fuel(step, 'Dacia', 'Electric').getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(fixture.componentInstance.value().brands).toEqual([
      {
        brandId: CATALOGUE[6].id,
        fuels: ['petrol', 'diesel', 'hybrid'],
        name: 'Dacia',
        stance: 'works_on',
      },
    ]);

    await press(fixture, fuel(step, 'Dacia', 'Electric'));
    expect(fixture.componentInstance.value().brands[0].fuels).toEqual([
      'petrol',
      'diesel',
      'hybrid',
      'electric',
    ]);
  });

  it('says politely that no requests come for a brand with every fuel unticked', async () => {
    const { fixture, step } = await open();
    await tap(fixture, step, 'Dacia');
    expect(quiet(step, 'Dacia')).toBeNull();

    for (const label of ['Benzină', 'Diesel', 'Hibrid', 'Electric'])
      await press(fixture, fuel(step, 'Dacia', label));

    expect(text(quiet(step, 'Dacia'))).toBe('Nu vei primi cereri pentru Dacia');
    expect(fixture.componentInstance.value().brands[0].fuels).toEqual([]);
  });

  it('starts at all four again after the brand is refused and taken back', async () => {
    const { fixture, step } = await open();
    await tap(fixture, step, 'Dacia');
    await press(fixture, fuel(step, 'Dacia', 'Diesel'));

    await tap(fixture, step, 'Dacia', 3);

    for (const f of fuels(step, 'Dacia'))
      expect(f.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.componentInstance.value().brands[0]).not.toHaveProperty(
      'fuels',
    );
  });

  it('shows the fuels and the line in English, keeping the ticks', async () => {
    const { fixture, i18n, step } = await open();
    await tap(fixture, step, 'Dacia');
    for (const label of ['Benzină', 'Diesel', 'Hibrid', 'Electric'])
      await press(fixture, fuel(step, 'Dacia', label));

    await i18n.use('en');
    await settle(fixture);

    expect(
      fuels(step, 'Dacia').map((f) => f.getAttribute('aria-label')),
    ).toEqual([
      'Dacia, Petrol',
      'Dacia, Diesel',
      'Dacia, Hybrid',
      'Dacia, Electric',
    ]);
    expect(text(quiet(step, 'Dacia'))).toBe(
      'You will not receive requests for Dacia',
    );
    expect(fixture.componentInstance.value().brands[0].fuels).toEqual([]);
  });

  it('shows a restored brand with no fuels kept as all four ticked', async () => {
    const { fixture, step } = await open();

    fixture.componentInstance.value.set({
      brands: [{ brandId: CATALOGUE[0].id, name: 'BMW', stance: 'works_on' }],
    });
    await settle(fixture);

    expect(fuels(step, 'BMW')).toHaveLength(4);
    for (const f of fuels(step, 'BMW'))
      expect(f.getAttribute('aria-pressed')).toBe('true');
  });
});

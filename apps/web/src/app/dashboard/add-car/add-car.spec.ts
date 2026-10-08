import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type BrandDto,
  BrandsService,
  type CarDto,
  CarsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { AddCar } from './add-car';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const brand = (id: string, name: string): BrandDto => ({
  id,
  name,
  popularity: null,
  slug: id,
});
const CATALOGUE = [
  brand('bmw', 'BMW'),
  brand('dacia', 'Dacia'),
  brand('skoda', 'Škoda'),
];
const page = (items: BrandDto[]) => ({
  items,
  nextCursor: null,
  total: items.length,
});

const saved: CarDto = {
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  year: 2019,
};

let search: jest.Mock;
let create: jest.Mock;
let result: Promise<OverlayResult<CarDto>>;

const NEXT_YEAR = new Date().getFullYear() + 1;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

// Past the brand search's 250 ms pause after the last key.
async function afterPause() {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await settle();
}

async function open(
  language: 'ro' | 'en' = 'ro',
  plates: string[] = [],
): Promise<void> {
  search = jest.fn(async ({ q }: { q?: string } = {}) => {
    const typed = (q ?? '').toLowerCase();
    return page(
      CATALOGUE.filter((b) =>
        b.name
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .toLowerCase()
          .startsWith(typed),
      ),
    );
  });
  create = jest.fn(async () => saved);
  TestBed.configureTestingModule({
    providers: [
      { provide: BrandsService, useValue: { brandsControllerSearch: search } },
      { provide: CarsService, useValue: { carsControllerCreate: create } },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<CarDto, { plates: string[] }>(
    AddCar,
    { data: { plates }, shape: 'dialog', title: 'driver.cars.add.title' },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

// The label that reads exactly so, else the first that starts so ("Motor"
// is not "Motorină").
function field(label: string): HTMLInputElement {
  const labels = [...panel().querySelectorAll('label')];
  const found =
    labels.find((l) => l.textContent?.trim() === label) ??
    labels.find((l) => l.textContent?.trim().startsWith(label));
  const input = found?.htmlFor
    ? document.getElementById(found.htmlFor)
    : found?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(input: HTMLInputElement, name: string) {
  input.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: name }),
  );
}

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

const options = () =>
  [...panel().querySelectorAll<HTMLElement>('[role="option"]')].map((o) =>
    o.textContent?.trim(),
  );

const option = (name: string) =>
  [...panel().querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.textContent?.trim() === name,
  );

const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');

async function chooseBrand(label: string, typed: string, name: string) {
  type(field(label), typed);
  await afterPause();
  option(name)?.click();
  await settle();
}

async function fillCar(km = '148200') {
  await chooseBrand('Marcă', 'bm', 'BMW');
  type(field('Model'), '320d');
  type(field('An'), '2019');
  type(field('Kilometri'), km);
  field('Motorină').click();
  await settle();
}

const save = async () => {
  button('Adaugă mașina')?.click();
  await settle();
};

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

const bucharestToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
    new Date(),
  );

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.restoreAllMocks();
});

describe('the add-a-car dialog', () => {
  it('asks for the car with its lead line, the required fields and an optional section', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Adaugă o mașină',
    );
    expect(text()).toContain(
      'O folosim ca să‑ți arătăm service‑urile potrivite',
    );
    for (const label of ['Marcă', 'Model', 'An', 'Kilometri'])
      expect(field(label).type).toBe('text');
    for (const fuel of ['Benzină', 'Motorină', 'Hibrid', 'Electric'])
      expect(field(fuel).type).toBe('radio');
    expect(text()).toContain('Opțional');
    expect(field('Număr de înmatriculare').type).toBe('text');
    expect(field('Motor').type).toBe('text');
    for (const label of [
      'ITP valabil până la',
      'RCA valabilă până la',
      'Rovinietă valabilă până la',
    ])
      expect(field(label).type).toBe('date');
    expect(button('Adaugă mașina')?.type).toBe('submit');
  });

  it('reads English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe('Add a car');
    expect(text()).toContain('We use it to show you the right garages');
    for (const label of ['Brand', 'Model', 'Year', 'Kilometres'])
      expect(field(label)).toBeDefined();
    for (const fuel of ['Petrol', 'Diesel', 'Hybrid', 'Electric'])
      expect(field(fuel).type).toBe('radio');
    expect(text()).toContain('Optional');
    expect(field('Registration plate')).toBeDefined();
    expect(field('ITP valid until').type).toBe('date');
    expect(button('Add the car')).toBeDefined();
  });

  it('lets no date be picked more than five years ahead', async () => {
    await open();
    const today = bucharestToday();
    const limit = `${Number(today.slice(0, 4)) + 5}${today.slice(4)}`;

    expect(field('ITP valabil până la').max).toBe(limit);
    expect(field('RCA valabilă până la').max).toBe(limit);
    expect(field('Rovinietă valabilă până la').max).toBe(limit);
  });
});

describe('the brand field', () => {
  it('searches once the typing pauses and lists the brands found', async () => {
    await open();

    type(field('Marcă'), 's');
    type(field('Marcă'), 'sk');
    type(field('Marcă'), 'sko');
    await afterPause();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ q: 'sko' });
    expect(options()).toEqual(['Škoda']);
  });

  it('chooses with the arrows and Enter, and closes the list with Escape', async () => {
    await open();
    const input = field('Marcă');

    type(input, 'd');
    await afterPause();
    key(input, 'ArrowDown');
    await settle();
    expect(option('Dacia')?.getAttribute('aria-selected')).toBe('true');
    key(input, 'Enter');
    await settle();

    expect(input.value).toBe('Dacia');
    expect(options()).toEqual([]);

    type(input, 'b');
    await afterPause();
    expect(options()).toEqual(['BMW']);
    key(input, 'Escape');
    await settle();
    expect(options()).toEqual([]);
    expect(panel()).not.toBeNull();
  });

  it('offers to try again when the brands cannot be loaded, and loads them', async () => {
    await open();
    search.mockRejectedValueOnce(refusal(503, { code: 'unavailable' }));

    type(field('Marcă'), 'bm');
    await afterPause();
    expect(text()).toContain('Nu am putut încărca mărcile. Reîncearcă.');
    button('Reîncearcă')?.click();
    await afterPause();

    expect(search).toHaveBeenCalledTimes(2);
    expect(options()).toEqual(['BMW']);
    expect(text()).not.toContain('Nu am putut încărca mărcile.');
  });

  it('asks for a brand from the list when none was chosen, and sends nothing', async () => {
    await open();
    await fillCar();
    type(field('Marcă'), 'Bemveu');
    await settle();

    await save();

    expect(create).not.toHaveBeenCalled();
    expect(text()).toContain('Alege o marcă din listă.');
    expect(field('Marcă').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('the other fields', () => {
  it('says which years it takes', async () => {
    await open();
    await fillCar();
    type(field('An'), '1949');
    await settle();

    await save();

    expect(create).not.toHaveBeenCalled();
    expect(text()).toContain(`Anul trebuie să fie între 1950 și ${NEXT_YEAR}`);
  });

  it('reads kilometres written with separators as a whole number', async () => {
    await open();
    await fillCar('148.200');

    await save();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ odometerKm: 148200 }),
      }),
    );
  });

  it('warns about a plate that does not look Romanian, and still saves it', async () => {
    await open();
    await fillCar();
    type(field('Număr de înmatriculare'), 'M-AB 1234');
    await settle();

    expect(text()).toContain('Verifică numărul de înmatriculare.');
    await save();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ plate: 'MAB1234' }),
      }),
    );
  });

  it('warns about a plate already on one of my cars, and still saves it', async () => {
    await open('ro', ['B123ABC']);
    await fillCar();
    type(field('Număr de înmatriculare'), 'b 123-abc');
    await settle();

    expect(text()).toContain('Ai deja o mașină cu acest număr.');
    expect(text()).not.toContain('Verifică numărul de înmatriculare.');
    await save();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('saving', () => {
  it('sends the car with an idempotency key and leaves out the empty optional fields', async () => {
    await open();
    await fillCar();
    type(field('ITP valabil până la'), '2026-11-13');
    await settle();

    await save();

    expect(create).toHaveBeenCalledWith({
      body: {
        brandId: 'bmw',
        fuel: 'diesel',
        itpUntil: '2026-11-13',
        model: '320d',
        odometerKm: 148200,
        year: 2019,
      },
      'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('closes with the saved car', async () => {
    await open();
    await fillCar();

    await save();

    await expect(result).resolves.toEqual(saved);
  });

  it('sends once while the first save is on its way', async () => {
    await open();
    create.mockReturnValueOnce(new Promise(() => undefined));
    await fillCar();

    button('Adaugă mașina')?.click();
    button('Adaugă mașina')?.click();
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('says the limit is 20 cars and stays open', async () => {
    await open();
    create.mockRejectedValueOnce(
      refusal(409, { code: 'car_limit', message: 'limit' }),
    );
    await fillCar();

    await save();

    expect(text()).toContain('Poți avea cel mult 20 de mașini.');
    expect(button('Adaugă mașina')).toBeDefined();
  });

  it('asks for a brand from the list when the server no longer knows it', async () => {
    await open();
    create.mockRejectedValueOnce(
      refusal(400, {
        code: 'validation_failed',
        errors: [{ code: 'unknown_brand', field: 'brandId' }],
        message: 'invalid',
      }),
    );
    await fillCar();

    await save();

    expect(text()).toContain('Alege o marcă din listă.');
    expect(button('Adaugă mașina')).toBeDefined();
  });
});

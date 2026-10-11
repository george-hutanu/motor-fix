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
import { openAddCar } from './open-add-car';

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
  updatedAt: '2026-10-07T09:00:00.000Z',
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

describe('openAddCar', () => {
  it('opens the add-car dialog with the plates already held and answers what it closes with', async () => {
    const open = jest.fn(async () => 'cancelled' as const);
    const overlays = { open } as unknown as Overlays;

    await expect(openAddCar(overlays, ['CJ12ABC'])).resolves.toBe('cancelled');
    expect(open).toHaveBeenCalledWith(AddCar, {
      data: { plates: ['CJ12ABC'] },
      shape: 'dialog',
      title: 'driver.cars.add.title',
    });
  });
});

const stored: CarDto = {
  ...saved,
  engine: '2.0 TDI',
  itpUntil: '2026-11-13',
  plate: 'B123ABC',
  rcaUntil: null,
  rovinietaUntil: '2027-01-31',
  updatedAt: '2026-10-08T07:00:00.000Z',
};

let update: jest.Mock;
let listCars: jest.Mock;
let edited: Promise<OverlayResult<CarDto>>;
let gone: jest.Mock;

async function openEdit(
  language: 'ro' | 'en' = 'ro',
  car: CarDto = stored,
  focus?: 'itpUntil' | 'rcaUntil' | 'rovinietaUntil',
): Promise<void> {
  search = jest.fn(async () => page(CATALOGUE));
  create = jest.fn(async () => saved);
  update = jest.fn(async () => ({
    ...car,
    updatedAt: '2026-10-08T08:00:00.000Z',
  }));
  listCars = jest.fn(async () => ({ items: [car] }));
  gone = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: BrandsService, useValue: { brandsControllerSearch: search } },
      {
        provide: CarsService,
        useValue: {
          carsControllerCreate: create,
          carsControllerList: listCars,
          carsControllerUpdate: update,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  edited = openAddCar(host.componentInstance.overlays, ['B123ABC', 'CJ12XYZ'], {
    car,
    gone,
    ...(focus && { focus }),
  });
  await settle();
  await settle();
}

const radio = (label: string) => field(label).checked;

describe('the edit dialog', () => {
  // @traces 092-FR-010
  it('opens with the car filled in, under its own title and button', async () => {
    await openEdit();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Modifică mașina',
    );
    expect(field('Marcă').value).toBe('BMW');
    expect(field('Model').value).toBe('320d');
    expect(field('An').value).toBe('2019');
    expect(field('Kilometri').value).toBe('148.200');
    expect(radio('Motorină')).toBe(true);
    expect(field('Număr de înmatriculare').value).toBe('B123ABC');
    expect(field('Motor').value).toBe('2.0 TDI');
    expect(field('ITP valabil până la').value).toBe('2026-11-13');
    expect(field('RCA valabilă până la').value).toBe('');
    expect(field('Rovinietă valabilă până la').value).toBe('2027-01-31');
    expect(button('Salvează')?.type).toBe('submit');
    expect(button('Adaugă mașina')).toBeUndefined();
  });

  // @traces 092-FR-010
  it('reads English', async () => {
    await openEdit('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Edit the car',
    );
    expect(field('Kilometres').value).toBe('148,200');
    expect(button('Save')?.type).toBe('submit');
  });

  // @traces 092-FR-010
  it('does not warn that the car’s own plate is already held', async () => {
    await openEdit();

    expect(text()).not.toContain('Ai deja o mașină cu acest număr.');
    type(field('Număr de înmatriculare'), 'CJ 12 XYZ');
    await settle();
    expect(text()).toContain('Ai deja o mașină cu acest număr.');
  });

  // @traces 092-FR-010
  it('puts the focus on the date the card asked for', async () => {
    await openEdit('ro', stored, 'rcaUntil');

    expect(document.activeElement).toBe(field('RCA valabilă până la'));
  });

  // @traces 092-FR-002
  it('sends only the changed fields, a cleared one as null, with the version it loaded', async () => {
    await openEdit();
    type(field('ITP valabil până la'), '2027-11-13');
    type(field('Număr de înmatriculare'), '');
    type(field('Motor'), '   ');
    await settle();

    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: {
        engine: null,
        itpUntil: '2027-11-13',
        plate: null,
        version: '2026-10-08T07:00:00.000Z',
      },
      id: 'car-1',
    });
    expect(create).not.toHaveBeenCalled();
  });

  // @traces 092-FR-010
  it('sends the version alone when nothing changed', async () => {
    await openEdit();

    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: { version: '2026-10-08T07:00:00.000Z' },
      id: 'car-1',
    });
  });

  // @traces 092-FR-010
  it('closes with the answered car', async () => {
    await openEdit();
    type(field('Model'), '330d');
    await settle();

    button('Salvează')?.click();
    await settle();

    await expect(edited).resolves.toEqual({
      ...stored,
      updatedAt: '2026-10-08T08:00:00.000Z',
    });
  });

  // @traces 092-FR-010
  it('asks before saving fewer kilometres than saved, and saves after Salvează', async () => {
    await openEdit();
    type(field('Kilometri'), '140.000');
    await settle();

    button('Salvează')?.click();
    await settle();

    expect(update).not.toHaveBeenCalled();
    expect(text()).toContain(
      'Kilometrajul e mai mic decât cel salvat (148.200 km). Sigur?',
    );
    expect(button('Renunță')).toBeDefined();
    const confirm = [...panel().querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === 'Salvează',
    );
    confirm.at(-1)?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: { odometerKm: 140000, version: '2026-10-08T07:00:00.000Z' },
      id: 'car-1',
    });
  });

  // @traces 092-FR-010
  it('returns to the form on Renunță and sends nothing', async () => {
    await openEdit();
    type(field('Kilometri'), '140000');
    await settle();
    button('Salvează')?.click();
    await settle();

    button('Renunță')?.click();
    await settle();

    expect(update).not.toHaveBeenCalled();
    expect(text()).not.toContain('Kilometrajul e mai mic');
    expect(field('Kilometri').value).toBe('140000');
    expect(panel()).not.toBeNull();
  });

  // @traces 092-FR-010
  it('asks the kilometres question in English', async () => {
    await openEdit('en');
    type(field('Kilometres'), '140000');
    await settle();

    button('Save')?.click();
    await settle();

    expect(text()).toContain(
      'The reading is lower than the saved one (148,200 km). Are you sure?',
    );
    expect(button('Cancel')).toBeDefined();
  });

  // @traces 092-FR-010
  it('does not ask when the kilometres go up', async () => {
    await openEdit();
    type(field('Kilometri'), '150000');
    await settle();

    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: { odometerKm: 150000, version: '2026-10-08T07:00:00.000Z' },
      id: 'car-1',
    });
  });

  // @traces 092-FR-010
  it('shows the button busy while saving', async () => {
    await openEdit();
    update.mockReturnValueOnce(new Promise(() => undefined));

    button('Salvează')?.click();
    await settle();

    expect(
      panel().querySelector('button[type="submit"]')?.getAttribute('aria-busy'),
    ).toBe('true');
  });

  // @traces 092-FR-010
  it('keeps the values and shows the reason when the save fails', async () => {
    await openEdit();
    update.mockRejectedValueOnce(refusal(500, { code: 'internal' }));
    type(field('Model'), '330d');
    await settle();

    button('Salvează')?.click();
    await settle();

    expect(field('Model').value).toBe('330d');
    expect(text()).toContain('Ceva nu a mers. Încearcă din nou.');
    expect(button('Salvează')).toBeDefined();
  });

  // @traces 092-FR-002
  it('reloads the car after a conflict, says so and saves with the new version', async () => {
    await openEdit();
    const current = {
      ...stored,
      model: '330d',
      updatedAt: '2026-10-08T07:30:00.000Z',
    };
    listCars.mockResolvedValueOnce({ items: [current] });
    update.mockRejectedValueOnce(
      refusal(409, { code: 'stale_version', message: 'stale' }),
    );
    type(field('ITP valabil până la'), '2027-11-13');
    await settle();

    button('Salvează')?.click();
    await settle();

    expect(listCars).toHaveBeenCalledTimes(1);
    expect(field('Model').value).toBe('330d');
    expect(field('ITP valabil până la').value).toBe('2026-11-13');
    expect(text()).toContain(
      'Mașina a fost modificată între timp. Verifică datele și salvează din nou.',
    );

    type(field('Motor'), '3.0');
    await settle();
    button('Salvează')?.click();
    await settle();
    expect(update).toHaveBeenLastCalledWith({
      body: { engine: '3.0', version: '2026-10-08T07:30:00.000Z' },
      id: 'car-1',
    });
  });

  // @traces 092-FR-002
  it('says the car is gone when a conflict finds it no longer listed', async () => {
    await openEdit();
    listCars.mockResolvedValueOnce({ items: [] });
    update.mockRejectedValueOnce(
      refusal(409, { code: 'stale_version', message: 'stale' }),
    );

    button('Salvează')?.click();
    await settle();

    expect(text()).toContain('Nu mai găsim ce voiai să salvezi.');
    expect(gone).toHaveBeenCalledTimes(1);
  });

  // @traces 092-FR-010
  it('tells the list the car is gone when a save answers not found', async () => {
    await openEdit();
    update.mockRejectedValueOnce(
      refusal(404, { code: 'not_found', message: 'No such car' }),
    );
    type(field('Model'), '330d');
    await settle();

    button('Salvează')?.click();
    await settle();

    expect(text()).toContain('Nu mai găsim ce voiai să salvezi.');
    expect(gone).toHaveBeenCalledTimes(1);
    expect(field('Model').value).toBe('330d');
  });

  // @traces 092-FR-010
  it('does not call the car gone on any other refusal', async () => {
    await openEdit();
    update.mockRejectedValueOnce(refusal(500, { code: 'internal' }));

    button('Salvează')?.click();
    await settle();

    expect(gone).not.toHaveBeenCalled();
  });

  // @traces 092-FR-002
  it('says the car changed, in English', async () => {
    await openEdit('en');
    update.mockRejectedValueOnce(
      refusal(409, { code: 'stale_version', message: 'stale' }),
    );

    button('Save')?.click();
    await settle();

    expect(text()).toContain(
      'The car was changed in the meantime. Check the details and save again.',
    );
  });
});

describe('openAddCar for a car', () => {
  // @traces 092-FR-010
  it('opens the dialog for that car under the edit title', async () => {
    const open = jest.fn(async () => 'cancelled' as const);
    const overlays = { open } as unknown as Overlays;

    await openAddCar(overlays, ['B123ABC'], { car: stored, focus: 'itpUntil' });

    expect(open).toHaveBeenCalledWith(AddCar, {
      data: { car: stored, focus: 'itpUntil', plates: ['B123ABC'] },
      shape: 'dialog',
      title: 'driver.cars.edit.title',
    });
  });
});

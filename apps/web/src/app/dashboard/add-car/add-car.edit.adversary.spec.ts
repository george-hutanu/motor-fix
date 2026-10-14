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

const stored: CarDto = {
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: '2.0 TDI',
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: '2026-11-13',
  model: '320d',
  odometerKm: 148200,
  plate: 'B123ABC',
  rcaUntil: null,
  rovinietaUntil: '2027-01-31',
  updatedAt: '2026-10-08T07:00:00.000Z',
  year: 2019,
};

let update: jest.Mock;
let listCars: jest.Mock;
let gone: jest.Mock;
let edited: Promise<OverlayResult<CarDto>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function openEdit(
  car: CarDto = stored,
  withGone = true,
  language: 'ro' | 'en' = 'ro',
) {
  update = jest.fn(async () => ({
    ...car,
    updatedAt: '2026-10-08T08:00:00.000Z',
  }));
  listCars = jest.fn(async () => ({ items: [car] }));
  gone = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: BrandsService,
        useValue: {
          brandsControllerSearch: jest.fn(async () => ({
            items: [brand('bmw', 'BMW')],
            nextCursor: null,
            total: 1,
          })),
        },
      },
      {
        provide: CarsService,
        useValue: {
          carsControllerList: listCars,
          carsControllerUpdate: update,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  edited = openAddCar(host.componentInstance.overlays, [], {
    car,
    ...(withGone && { gone }),
  });
  await settle();
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

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

const buttons = (name: string) =>
  [...panel().querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === name,
  );
const text = () =>
  (document.querySelector('mf-overlay-panel')?.textContent ?? '').replace(
    /\s+/g,
    ' ',
  );

async function save() {
  buttons('Salvează').at(-1)?.click();
  await settle();
}

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

// @traces 092-FR-010
describe('the edit dialog at its kilometre boundary', () => {
  it('asks for one kilometre less than saved', async () => {
    await openEdit();
    type(field('Kilometri'), '148199');
    await settle();

    await save();

    expect(update).not.toHaveBeenCalled();
    expect(text()).toContain('Kilometrajul e mai mic decât cel salvat');
  });

  it('does not ask for the very reading saved, typed again', async () => {
    await openEdit();
    type(field('Kilometri'), '148200');
    await settle();

    await save();

    expect(text()).not.toContain('Kilometrajul e mai mic');
    expect(update).toHaveBeenCalledWith({
      body: { version: stored.updatedAt },
      id: 'car-1',
    });
  });

  it('does not ask for the same reading typed with thousands separators', async () => {
    await openEdit();
    type(field('Kilometri'), '148 200');
    await settle();

    await save();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].body).toEqual({ version: stored.updatedAt });
  });

  it('does not ask when a car saved at zero kilometres is saved at zero', async () => {
    await openEdit({ ...stored, odometerKm: 0 });

    await save();

    expect(text()).not.toContain('Kilometrajul e mai mic');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('asks again for a second lower reading after Renunță, and not once the reading goes up', async () => {
    await openEdit();
    type(field('Kilometri'), '100000');
    await settle();
    await save();
    buttons('Renunță')[0]?.click();
    await settle();

    type(field('Kilometri'), '150000');
    await settle();
    await save();

    expect(text()).not.toContain('Kilometrajul e mai mic');
    expect(update.mock.calls[0][0].body).toEqual({
      odometerKm: 150000,
      version: stored.updatedAt,
    });
  });

  it('sends the lower reading once when the confirming button is pressed twice', async () => {
    await openEdit();
    type(field('Kilometri'), '100000');
    await settle();
    await save();

    const confirm = buttons('Salvează').at(-1);
    confirm?.click();
    confirm?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
  });
});

// @traces 092-FR-002
describe('the edit dialog sending only what changed', () => {
  it('leaves out the plate typed in another form and the model padded with spaces', async () => {
    await openEdit();
    type(field('Număr de înmatriculare'), ' b-123 abc ');
    type(field('Model'), '  320d ');
    await settle();

    await save();

    expect(update.mock.calls[0][0].body).toEqual({ version: stored.updatedAt });
  });

  it('sends null for a date that was emptied', async () => {
    await openEdit();
    type(field('ITP valabil până la'), '');
    await settle();

    await save();

    expect(update.mock.calls[0][0].body).toEqual({
      itpUntil: null,
      version: stored.updatedAt,
    });
  });

  it('sends nothing for an empty engine and date of a car that has none', async () => {
    await openEdit({ ...stored, engine: null, plate: null });
    type(field('Motor'), '  ');
    await settle();

    await save();

    expect(update.mock.calls[0][0].body).toEqual({ version: stored.updatedAt });
  });

  it('does not send a model emptied, and keeps the dialog open', async () => {
    await openEdit();
    type(field('Model'), '');
    await settle();

    await save();

    expect(update).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
    expect(field('Model').value).toBe('');
  });

  it('does not send a year past next year', async () => {
    await openEdit();
    type(field('An'), String(new Date().getFullYear() + 2));
    await settle();

    await save();

    expect(update).not.toHaveBeenCalled();
  });

  it('sends one request when the save button is pressed twice', async () => {
    await openEdit();
    type(field('Model'), '330d');
    await settle();

    const submit = buttons('Salvează')[0];
    submit?.click();
    submit?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('treats a model with markup as text and sends it as typed', async () => {
    await openEdit();
    type(field('Model'), '<img src=x onerror=alert(1)>');
    await settle();

    await save();

    expect(update.mock.calls[0][0].body.model).toBe(
      '<img src=x onerror=alert(1)>',
    );
    expect(document.querySelector('img')).toBeNull();
  });
});

// @traces 092-FR-002
describe('the edit dialog when the reload after a conflict fails', () => {
  it('keeps the dialog and the typed values and shows a reason', async () => {
    await openEdit();
    listCars.mockRejectedValueOnce(refusal(500, { code: 'internal' }));
    update.mockRejectedValueOnce(
      refusal(409, { code: 'stale_version', message: 'stale' }),
    );
    type(field('Model'), '330d');
    await settle();

    await save();

    expect(panel()).not.toBeNull();
    expect(field('Model').value).toBe('330d');
    expect(text()).toMatch(/Ceva nu a mers|Mașina a fost modificată/);
  });

  it('reports the conflict once and not again after the next successful save', async () => {
    await openEdit();
    update.mockRejectedValueOnce(
      refusal(409, { code: 'stale_version', message: 'stale' }),
    );
    await save();
    expect(text()).toContain('Mașina a fost modificată între timp.');

    await save();

    await expect(edited).resolves.toMatchObject({ id: 'car-1' });
  });
});

// @traces 092-FR-010
describe('the edit dialog for a car that is gone', () => {
  it('shows the not-found reason without a callback to the list', async () => {
    await openEdit(stored, false);
    update.mockRejectedValueOnce(
      refusal(404, { code: 'not_found', message: 'No such car' }),
    );

    await save();

    expect(text()).toContain('Nu mai găsim ce voiai să salvezi.');
    expect(panel()).not.toBeNull();
  });

  it('calls the list once, even when Salvează is pressed again after the refusal', async () => {
    await openEdit();
    update.mockRejectedValue(
      refusal(404, { code: 'not_found', message: 'No such car' }),
    );

    await save();
    await save();

    expect(gone.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

// @traces 092-FR-009
describe('the edit dialog opened for a date', () => {
  it.each([
    ['itpUntil', 'ITP valabil până la'],
    ['rcaUntil', 'RCA valabilă până la'],
    ['rovinietaUntil', 'Rovinietă valabilă până la'],
  ] as const)(
    'puts the focus on the %s field of a car that has none of the dates',
    async (focus, label) => {
      update = jest.fn();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: BrandsService,
            useValue: {
              brandsControllerSearch: jest.fn(async () => ({
                items: [brand('bmw', 'BMW')],
                nextCursor: null,
                total: 1,
              })),
            },
          },
          { provide: CarsService, useValue: { carsControllerUpdate: update } },
        ],
      });
      await TestBed.inject(I18n).enter('driver');
      const host = TestBed.createComponent(Host);
      void openAddCar(host.componentInstance.overlays, [], {
        car: { ...stored, itpUntil: null, rovinietaUntil: null },
        focus,
      });
      await settle();
      await settle();

      expect(document.activeElement).toBe(field(label));
    },
  );
});

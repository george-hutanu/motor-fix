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

const brand: BrandDto = {
  id: 'bmw',
  name: 'BMW',
  popularity: null,
  slug: 'bmw',
};

const stored: CarDto = {
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  nextServiceKm: 152000,
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  serviceDueOn: null,
  transfer: null,
  updatedAt: '2026-10-08T07:00:00.000Z',
  year: 2019,
};

let update: jest.Mock;
let edited: Promise<OverlayResult<CarDto>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function openEdit(
  car: CarDto = stored,
  language: 'ro' | 'en' = 'ro',
  focus?: 'nextServiceKm',
  updateImpl?: () => Promise<CarDto>,
) {
  update = jest.fn(
    updateImpl ??
      (async () => ({ ...car, updatedAt: '2026-10-08T08:00:00.000Z' })),
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: BrandsService,
        useValue: {
          brandsControllerSearch: jest.fn(async () => ({
            items: [brand],
            nextCursor: null,
            total: 1,
          })),
        },
      },
      {
        provide: CarsService,
        useValue: {
          carsControllerList: jest.fn(async () => ({ items: [car] })),
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
    gone: jest.fn(),
    ...(focus && { focus }),
  } as never);
  await settle();
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

function field(label: string): HTMLInputElement {
  const found = [...panel().querySelectorAll('label')].find((l) =>
    l.textContent?.trim().startsWith(label),
  );
  const input = found?.htmlFor
    ? document.getElementById(found.htmlFor)
    : found?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

const next = (label = 'Următorul schimb de ulei la') => field(label);

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');

async function save(name = 'Salvează') {
  [...panel().querySelectorAll('button')]
    .filter((b) => b.textContent?.trim() === name)
    .at(-1)
    ?.click();
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

// @traces 1386-FR-001
describe('the next-service field in the edit dialog', () => {
  it('is pre-filled with the stored value in the person format', async () => {
    await openEdit();
    expect(next().value).toBe('152.000');
  });

  it('is empty for a car without a value', async () => {
    await openEdit({ ...stored, nextServiceKm: null });
    expect(next().value).toBe('');
  });

  it('is labelled in English', async () => {
    await openEdit(stored, 'en');
    expect(next('Next oil service at (km)').value).toBe('152,000');
  });

  it('receives the focus when the dialog is opened from the grey line', async () => {
    await openEdit({ ...stored, nextServiceKm: null }, 'ro', 'nextServiceKm');
    await settle();
    expect(document.activeElement).toBe(next());
  });

  it.each(['153.000', '153 000', '153,000', '153000'])(
    'sends %s as 153000',
    async (written) => {
      await openEdit();
      type(next(), written);
      await settle();
      await save();
      expect(update.mock.calls[0][0].body).toEqual({
        nextServiceKm: 153000,
        version: stored.updatedAt,
      });
    },
  );

  it('does not send the stored value typed in another writing', async () => {
    await openEdit();
    type(next(), '152 000');
    await settle();
    await save();
    expect(update.mock.calls[0][0].body).toEqual({ version: stored.updatedAt });
  });

  it('sends null when the field is blanked', async () => {
    await openEdit();
    type(next(), '');
    await settle();
    await save();
    expect(update.mock.calls[0][0].body).toEqual({
      nextServiceKm: null,
      version: stored.updatedAt,
    });
  });

  it('sends nothing for a blank field on a car that had none', async () => {
    await openEdit({ ...stored, nextServiceKm: null });
    await save();
    expect(update.mock.calls[0][0].body).toEqual({ version: stored.updatedAt });
  });

  it('treats a whitespace-only value as blank', async () => {
    await openEdit();
    type(next(), '   ');
    await settle();
    await save();
    expect(update.mock.calls[0][0].body).toEqual({
      nextServiceKm: null,
      version: stored.updatedAt,
    });
  });
});

// @traces 1386-FR-002
describe('the next-service refusals', () => {
  const low =
    'Valoarea trebuie să fie mai mare decât kilometrajul actual (148.200 km).';
  const far =
    'Valoarea poate fi cu cel mult 100.000 km peste kilometrajul actual.';

  it.each([
    ['148200', low],
    ['148199', low],
    ['0', low],
    ['248201', far],
  ])('refuses %s and sends nothing', async (value, sentence) => {
    await openEdit();
    type(next(), value);
    await settle();
    await save();
    expect(update).not.toHaveBeenCalled();
    expect(text()).toContain(sentence);
  });

  it('accepts exactly 100,000 km above and one km above', async () => {
    await openEdit();
    type(next(), '248200');
    await settle();
    await save();
    expect(update.mock.calls[0][0].body.nextServiceKm).toBe(248200);
  });

  it('accepts one kilometre above the odometer', async () => {
    await openEdit();
    type(next(), '148201');
    await settle();
    await save();
    expect(update.mock.calls[0][0].body.nextServiceKm).toBe(148201);
  });

  it('quotes the kilometres typed in the same form', async () => {
    await openEdit();
    type(field('Kilometri'), '150000');
    type(next(), '150000');
    await settle();
    await save();
    expect(update).not.toHaveBeenCalled();
    expect(text()).toContain(
      'Valoarea trebuie să fie mai mare decât kilometrajul actual (150.000 km).',
    );
  });

  it('says the English sentence', async () => {
    await openEdit(stored, 'en');
    type(next('Next oil service at (km)'), '100');
    await settle();
    await save('Save');
    expect(text()).toContain(
      'The value must be greater than the current odometer (148,200 km).',
    );
  });

  it('saves a raised odometer past the kept value without rechecking', async () => {
    await openEdit();
    type(field('Kilometri'), '153000');
    await settle();
    await save();
    expect(update.mock.calls[0][0].body).toEqual({
      odometerKm: 153000,
      version: stored.updatedAt,
    });
  });

  it('refuses the field before the lowered-kilometres question', async () => {
    await openEdit();
    type(field('Kilometri'), '100000');
    type(next(), '90000');
    await settle();
    await save();
    expect(text()).not.toContain('Kilometrajul e mai mic');
    expect(text()).toContain('Valoarea trebuie să fie mai mare');
  });

  it('ties the sentence to the input and marks it invalid', async () => {
    await openEdit();
    type(next(), '1');
    await settle();
    await save();
    const input = next();
    const described = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(described).toContain('Valoarea trebuie să fie mai mare');
  });

  it('moves the focus to the refused field on save', async () => {
    await openEdit();
    type(next(), '1');
    await settle();
    await save();
    await settle();
    expect(document.activeElement).toBe(next());
  });

  it.each([
    ['next_service_not_above_odometer', 'Valoarea trebuie să fie mai mare'],
    ['next_service_too_far', 'Valoarea poate fi cu cel mult 100.000 km'],
  ])(
    'shows the API code %s on the field and stays open',
    async (code, part) => {
      await openEdit(stored, 'ro', undefined, async () => {
        throw new HttpErrorResponse({
          error: {
            code: 'validation_failed',
            errors: [{ code, field: 'nextServiceKm' }],
            message: 'invalid',
          },
          status: 400,
        });
      });
      type(next(), '153000');
      await settle();
      await save();
      expect(text()).toContain(part);
      expect(next().value).toBe('153000');
      expect(document.querySelector('mf-overlay-panel')).not.toBeNull();
    },
  );

  it('resolves the saved car with its new value', async () => {
    await openEdit(stored, 'ro', undefined, async () => ({
      ...stored,
      nextServiceKm: 153000,
      serviceDueOn: '2027-01-01',
    }));
    type(next(), '153000');
    await settle();
    await save();
    const result = await edited;
    expect(result).toMatchObject({
      nextServiceKm: 153000,
      serviceDueOn: '2027-01-01',
    });
  });
});

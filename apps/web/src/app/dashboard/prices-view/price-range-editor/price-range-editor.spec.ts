import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GaragesService, type PriceListDto } from '@motor-fix/data-access';
import { formatDuration, I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  type EditableRow,
  PriceRangeEditor,
  type PriceRangeEditorData,
  type PriceRangeEditorResult,
} from './price-range-editor';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const GARAGE = 'garage-1';
const STAMP = '2026-10-18T08:00:00.000Z';
const NEWER = '2026-10-18T08:05:00.000Z';

const BRAKES: EditableRow = {
  brandRanges: [
    { brandId: 'bmw', fromBani: 110_000, name: 'BMW', toBani: 170_000 },
  ],
  durationMinutes: 120,
  fromBani: 89_000,
  jobTypeId: 'brakes',
  nameEn: 'Front brake pads and discs',
  nameRo: 'Plăcuțe și discuri de frână față',
  priceId: 'price-brakes',
  public: true,
  toBani: 140_000,
  updatedAt: STAMP,
};

const ROW: PriceRangeEditorData = {
  garageId: GARAGE,
  item: BRAKES,
  kind: 'row',
};
const BRAND: PriceRangeEditorData = {
  brand: BRAKES.brandRanges[0],
  garageId: GARAGE,
  jobTypeId: 'brakes',
  kind: 'brand',
};
const LABOUR: PriceRangeEditorData = {
  garageId: GARAGE,
  kind: 'labour',
  labour: { fromBani: 18_000, toBani: 24_000 },
};

let setRange: jest.Mock;
let setBrandRange: jest.Mock;
let setLabour: jest.Mock;
let add: jest.Mock;
let propose: jest.Mock;
let read: jest.Mock;
let result: Promise<PriceRangeEditorResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  data: PriceRangeEditorData = ROW,
  {
    language = 'ro',
    title = BRAKES.nameRo,
  }: { language?: 'ro' | 'en'; title?: string } = {},
) {
  setRange = jest.fn(async ({ body }) => ({
    jobTypeId: 'brakes',
    priceId: 'price-brakes',
    updatedAt: NEWER,
    warnings: [],
    ...body,
  }));
  setBrandRange = jest.fn(async ({ body }) => ({ ...body, warnings: [] }));
  setLabour = jest.fn(async ({ body }) => ({ ...body, warnings: [] }));
  add = jest.fn(async ({ body }) => ({
    priceId: 'price-ac',
    updatedAt: NEWER,
    warnings: [],
    ...body,
  }));
  propose = jest.fn(async ({ body }) => ({
    jobTypeId: 'job-new',
    priceId: 'price-new',
    updatedAt: NEWER,
    warnings: [],
    ...body,
  }));
  read = jest.fn(
    async (): Promise<PriceListDto> => ({
      items: [
        {
          ...BRAKES,
          durationMinutes: 150,
          fromBani: 95_000,
          toBani: 145_000,
          updatedAt: NEWER,
        },
      ],
    }),
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: {
          catalogueJobsControllerPropose: propose,
          garageLabourControllerSet: setLabour,
          priceListControllerAdd: add,
          priceListControllerRead: read,
          priceListControllerSetBrandRange: setBrandRange,
          priceListControllerSetRange: setRange,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  await TestBed.inject(I18n).enter('public');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    PriceRangeEditorResult,
    PriceRangeEditorData
  >(PriceRangeEditor, { data, shape: 'dialog', title });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;

// A field by its label's text.
const field = (label: string) => {
  const found = [...panel().querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  );
  return document.getElementById(found?.htmlFor ?? '') as HTMLInputElement;
};

// The message the field points at with aria-describedby.
const said = (label: string) =>
  (field(label).getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ')
    .trim();

async function fill(label: string, value: string) {
  const input = field(label);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('blur'));
  await settle();
}

const press = async (name = 'Salvează') => {
  button(name)?.click();
  await settle();
};

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 173-FR-002
// @traces 173-FR-015
describe("the range editor: what a row's editor starts with", () => {
  it("is titled with the job's name and holds its range in lei and its duration", async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Plăcuțe și discuri de frână față',
    );
    expect(field('De la').value).toBe('890');
    expect(field('Până la').value).toBe('1400');
    expect(field('Durată').value).toBe('120');
    expect(said('Durată')).toBe(formatDuration(120, 'ro'));
    expect(button('Salvează')).toBeDefined();
    expect(button('Anulează')).toBeDefined();
  });

  it('shows the lei unit beside each price field', async () => {
    await open();

    for (const label of ['De la', 'Până la']) {
      const unit = field(label).parentElement?.querySelector('.unit');
      expect(unit?.textContent?.trim()).toBe('lei');
    }
  });

  it('types whole lei in the price fields', async () => {
    await open();

    expect(field('De la').getAttribute('inputmode')).toBe('numeric');
    expect(field('Durată').getAttribute('step')).toBe('15');
  });

  it('reads in English', async () => {
    await open(ROW, { language: 'en', title: BRAKES.nameEn });

    expect(field('From').value).toBe('890');
    expect(field('Duration').value).toBe('120');
    expect(button('Save')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });
});

// @traces 173-FR-002
// @traces 173-FR-004
// @traces 173-FR-007
describe("the range editor: saving a row's range", () => {
  it('sends the three values in bani and minutes with the stamp it read, then closes', async () => {
    await open();
    await fill('De la', '950');
    await fill('Până la', '1450');

    await press();

    expect(setRange).toHaveBeenCalledWith({
      body: {
        durationMinutes: 120,
        expectedUpdatedAt: STAMP,
        fromBani: 95_000,
        toBani: 145_000,
      },
      garageId: GARAGE,
      priceId: 'price-brakes',
    });
    await expect(result).resolves.toBe('saved');
  });

  it('sends null for a cleared top and a cleared duration', async () => {
    await open();
    await fill('Până la', '');
    await fill('Durată', '');

    await press();

    expect(setRange.mock.calls[0][0].body).toEqual({
      durationMinutes: null,
      expectedUpdatedAt: STAMP,
      fromBani: 89_000,
      toBani: null,
    });
  });

  it('locks its fields and buttons while the save is on its way', async () => {
    await open();
    let answer: (value: unknown) => void = () => undefined;
    setRange.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    await press();

    expect(panel().querySelector('form')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(field('De la').disabled).toBe(true);
    expect(button('Anulează')?.disabled).toBe(true);
    answer({ ...BRAKES, warnings: [] });
    await settle();
  });

  it('closes with nothing sent on Cancel', async () => {
    await open();

    await press('Anulează');

    expect(setRange).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });
});

// @traces 173-FR-003
// @traces 173-FR-011
describe('the range editor: a wrong range cannot be saved', () => {
  it.each<[string, Record<string, string>, string, string]>([
    [
      'a top below the low end',
      { 'De la': '1500', 'Până la': '1450' },
      'Până la',
      'Prețul minim trebuie să fie mai mic decât maximul',
    ],
    ['a low end of 0', { 'De la': '0' }, 'De la', 'Cel puțin 1 leu'],
    [
      'a top above the cap',
      { 'Până la': '200000' },
      'Până la',
      'Cel mult 100.000 lei',
    ],
    [
      'a duration off the step',
      { Durată: '50' },
      'Durată',
      'În pași de 15 minute',
    ],
    [
      'a duration under 15 minutes',
      { Durată: '0' },
      'Durată',
      'Cel puțin 15 minute',
    ],
    [
      'a duration above the cap',
      { Durată: '4815' },
      'Durată',
      'Cel mult 4.800 minute (80 de ore)',
    ],
    ['an empty low end', { 'De la': '' }, 'De la', 'Completează prețul'],
  ])(
    'names %s under its field and keeps Save off',
    async (_, values, at, message) => {
      await open();
      for (const [label, value] of Object.entries(values))
        await fill(label, value);

      expect(said(at)).toBe(message);
      expect(field(at).getAttribute('aria-invalid')).toBe('true');
      expect(button('Salvează')?.disabled).toBe(true);
      await press();
      expect(setRange).not.toHaveBeenCalled();
    },
  );

  it('names the range problem in English', async () => {
    await open(ROW, { language: 'en', title: BRAKES.nameEn });
    await fill('From', '1500');
    await fill('To', '1450');

    expect(said('To')).toBe('The low price must be below the high one');
  });

  it('warns of a wide range under the top and still saves it', async () => {
    await open();
    await fill('De la', '200');
    await fill('Până la', '5000');

    expect(said('Până la')).toBe(
      'Maximul e de peste 3 ori minimul. Verifică intervalul.',
    );
    expect(field('Până la').getAttribute('aria-invalid')).toBeNull();
    expect(button('Salvează')?.disabled).toBe(false);
    await press();
    expect(setRange).toHaveBeenCalled();
  });

  it("shows the server's field errors under their fields", async () => {
    await open();
    setRange.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'max', field: 'fromBani' }],
      }),
    );

    await press();

    expect(said('De la')).toBe('Cel mult 100.000 lei');
  });
});

// @traces 173-FR-007
// @traces 173-FR-011
describe('the range editor: two sessions and a bad network', () => {
  it('says the list changed, re-reads it and refills the stored values', async () => {
    await open();
    setRange.mockRejectedValueOnce(refusal(409, { code: 'stale' }));
    await fill('De la', '700');

    await press();

    expect(text()).toContain('Lista s‑a schimbat între timp.');
    expect(text()).not.toContain('Am adus valorile salvate');
    expect(read).toHaveBeenCalledWith({ garageId: GARAGE });
    expect(field('De la').value).toBe('950');
    expect(field('Până la').value).toBe('1450');
    expect(field('Durată').value).toBe('150');

    await press();

    expect(setRange.mock.calls[1][0].body.expectedUpdatedAt).toBe(NEWER);
  });

  it('says the job is gone on 404', async () => {
    await open();
    setRange.mockRejectedValueOnce(refusal(404, { code: 'not_found' }));

    await press();

    expect(text()).toContain('Lucrarea nu mai e în listă.');
  });

  it('keeps the typed values when the network fails', async () => {
    await open();
    setRange.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await fill('De la', '950');

    await press();

    expect(
      panel().querySelector('[role="alert"], mf-task-error'),
    ).not.toBeNull();
    expect(field('De la').value).toBe('950');
  });

  it('says the list changed in English', async () => {
    await open(ROW, { language: 'en', title: BRAKES.nameEn });
    setRange.mockRejectedValueOnce(refusal(409, { code: 'stale' }));

    await press('Save');

    expect(text()).toContain('The list changed in the meantime.');
  });
});

// @traces 173-FR-005
// @traces 173-FR-012
describe('the range editor: a brand range and the labour range', () => {
  it('saves a brand range through the brand write, with no duration', async () => {
    await open(BRAND, { title: 'BMW' });

    expect(field('Durată')).toBeNull();
    await fill('De la', '1200');
    await press();

    expect(setBrandRange).toHaveBeenCalledWith({
      body: { fromBani: 120_000, toBani: 170_000 },
      brandId: 'bmw',
      garageId: GARAGE,
      jobTypeId: 'brakes',
    });
    expect(setRange).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('saved');
  });

  it.each([
    ['brand', BRAND],
    ['labour', LABOUR],
  ])('asks the %s editor for both ends', async (_, data) => {
    await open(data, { title: 'x' });
    await fill('Până la', '');

    expect(said('Până la')).toBe('Ambele capete sunt necesare');
    expect(button('Salvează')?.disabled).toBe(true);
  });

  it.each([
    ['brand', BRAND],
    ['labour', LABOUR],
  ])(
    'asks the %s editor for both ends when its bottom is cleared',
    async (_, data) => {
      await open(data, { title: 'x' });
      await fill('De la', '');

      expect(said('De la')).toBe('Ambele capete sunt necesare');
      expect(button('Salvează')?.disabled).toBe(true);
    },
  );

  it('saves the labour range through the labour write', async () => {
    await open(LABOUR, { title: 'public.listing.prices.labour' });

    expect(field('De la').value).toBe('180');
    expect(field('Până la').value).toBe('240');
    await fill('De la', '200');
    await fill('Până la', '260');
    await press();

    expect(setLabour).toHaveBeenCalledWith({
      body: { fromBani: 20_000, toBani: 26_000 },
      garageId: GARAGE,
    });
  });

  it('starts an unset labour range empty', async () => {
    await open({ garageId: GARAGE, kind: 'labour' }, { title: 'x' });

    expect(field('De la').value).toBe('');
    expect(field('Până la').value).toBe('');
  });
});

const NEW: PriceRangeEditorData = {
  garageId: GARAGE,
  job: {
    id: 'job-ac',
    key: 'ac-regas',
    nameEn: 'Air-con regas',
    nameRo: 'Încărcare freon climă',
  },
  kind: 'new',
};

// @traces 1352-FR-001
describe('the range editor: a job new to the list', () => {
  it('starts empty, with the duration, and adds the job with its range and duration, then closes', async () => {
    await open(NEW, { title: 'Încărcare freon climă' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Încărcare freon climă',
    );
    expect(field('De la').value).toBe('');
    expect(field('Până la').value).toBe('');
    expect(field('Durată').value).toBe('');
    expect(button('Salvează')?.disabled).toBe(true);

    await fill('Durată', '45');
    await fill('De la', '280');
    await fill('Până la', '360');
    await press();

    expect(add).toHaveBeenCalledWith({
      body: {
        durationMinutes: 45,
        fromBani: 28_000,
        jobTypeId: 'job-ac',
        toBani: 36_000,
      },
      garageId: GARAGE,
    });
    expect(setRange).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('saved');
  });

  it('adds a starting price alone, with no top and no duration', async () => {
    await open(NEW, { title: 'Încărcare freon climă' });

    await fill('De la', '280');
    await press();

    expect(add).toHaveBeenCalledWith({
      body: {
        durationMinutes: null,
        fromBani: 28_000,
        jobTypeId: 'job-ac',
        toBani: null,
      },
      garageId: GARAGE,
    });
  });

  it("shows the server's range errors under their fields and stays open", async () => {
    await open(NEW, { title: 'Încărcare freon climă' });
    add.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'max', field: 'fromBani' }],
      }),
    );
    await fill('De la', '280');

    await press();

    expect(said('De la')).toBe('Cel mult 100.000 lei');
    expect(panel()).not.toBeNull();
  });

  it('says the job is already on the list', async () => {
    await open(NEW, { title: 'Încărcare freon climă' });
    add.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'duplicate', field: 'jobTypeId' }],
      }),
    );
    await fill('De la', '280');

    await press();

    expect(text()).toContain('Lucrarea e deja în lista ta.');
    expect(text()).not.toContain('Verifică câmpurile marcate.');
  });

  it('asks the opener to reload the list on a duplicate, the editor still open', async () => {
    const listed = jest.fn();
    await open({ ...NEW, listed }, { title: 'Încărcare freon climă' });
    add.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'duplicate', field: 'jobTypeId' }],
      }),
    );
    await fill('De la', '280');

    await press();

    expect(listed).toHaveBeenCalledTimes(1);
    expect(panel()).not.toBeNull();
  });

  it('does not ask for a reload on another refusal', async () => {
    const listed = jest.fn();
    await open({ ...NEW, listed }, { title: 'Încărcare freon climă' });
    add.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'too_many', field: 'jobTypeId' }],
      }),
    );
    await fill('De la', '280');

    await press();

    expect(listed).not.toHaveBeenCalled();
  });

  it('says the list holds 50 jobs already', async () => {
    await open(NEW, { language: 'en', title: 'Air-con regas' });
    add.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'too_many', field: 'jobTypeId' }],
      }),
    );
    await fill('From', '280');

    await press('Save');

    expect(text()).toContain('At most 50 jobs');
  });
});

const PROPOSE: PriceRangeEditorData = { garageId: GARAGE, kind: 'propose' };
const NAME = 'Recondiționare injectoare';

// @traces 1352-FR-009
describe('the range editor: proposing a job the catalogue lacks', () => {
  it('asks for the name, the range and the duration, and sends with "Trimite"', async () => {
    await open(PROPOSE, { title: 'garage.prices.propose.title' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Propune o lucrare',
    );
    expect(field('Numele lucrării').value).toBe('');
    expect(field('De la').value).toBe('');
    expect(field('Durată').value).toBe('');
    expect(button('Trimite')?.disabled).toBe(true);
    expect(button('Salvează')).toBeUndefined();

    await fill('Numele lucrării', `  ${NAME}  `);
    await fill('Durată', '90');
    await fill('De la', '600');
    await fill('Până la', '900');
    await press('Trimite');

    expect(propose).toHaveBeenCalledWith({
      body: {
        durationMinutes: 90,
        fromBani: 60_000,
        name: NAME,
        toBani: 90_000,
      },
      garageId: GARAGE,
    });
    expect(add).not.toHaveBeenCalled();
    expect(setRange).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('saved');
  });

  it('refuses a name under 3 characters once trimmed, before sending', async () => {
    await open(PROPOSE, { title: 'garage.prices.propose.title' });

    await fill('Numele lucrării', '  ab   ');
    await fill('De la', '600');

    expect(said('Numele lucrării')).toBe('Cel puțin 3 caractere');
    expect(field('Numele lucrării').getAttribute('aria-invalid')).toBe('true');
    expect(button('Trimite')?.disabled).toBe(true);
    await press('Trimite');
    expect(propose).not.toHaveBeenCalled();
  });

  it('refuses a name over 80 characters once trimmed, and takes 80', async () => {
    await open(PROPOSE, { title: 'garage.prices.propose.title' });
    await fill('De la', '600');

    await fill('Numele lucrării', 'a'.repeat(81));
    expect(said('Numele lucrării')).toBe('Cel mult 80 de caractere');
    expect(button('Trimite')?.disabled).toBe(true);

    await fill('Numele lucrării', ` ${'a'.repeat(80)} `);
    expect(said('Numele lucrării')).toBe('');
    expect(button('Trimite')?.disabled).toBe(false);
  });

  it('says the name is needed once the field is left empty', async () => {
    await open(PROPOSE, { title: 'garage.prices.propose.title' });
    expect(said('Numele lucrării')).toBe('');

    await fill('Numele lucrării', '   ');

    expect(said('Numele lucrării')).toBe('Scrie numele lucrării.');
  });

  it('shows a pending duplicate on the name and stays open', async () => {
    await open(PROPOSE, { title: 'garage.prices.propose.title' });
    propose.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'duplicate', field: 'name' }],
      }),
    );
    await fill('Numele lucrării', NAME);
    await fill('De la', '600');

    await press('Trimite');

    expect(said('Numele lucrării')).toBe('Ai propus deja această lucrare.');
    expect(panel()).not.toBeNull();
  });

  it("shows an approved job's name on the name field, in English too", async () => {
    await open(PROPOSE, {
      language: 'en',
      title: 'garage.prices.propose.title',
    });
    propose.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'exists', field: 'name', jobTypeId: 'job-ac' }],
      }),
    );
    await fill('Job name', 'Air-con regas');
    await fill('From', '280');

    await press('Send');

    expect(said('Job name')).toBe(
      'The job is already in the catalogue: pick it from the list.',
    );
  });

  it('says the list holds 50 jobs already, on the form rather than the name', async () => {
    await open(PROPOSE, { title: 'garage.prices.propose.title' });
    propose.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'too_many', field: 'name' }],
      }),
    );
    await fill('Numele lucrării', NAME);
    await fill('De la', '600');

    await press('Trimite');

    expect(text()).toContain('Cel mult 50 de lucrări');
    expect(said('Numele lucrării')).toBe('');
  });
});

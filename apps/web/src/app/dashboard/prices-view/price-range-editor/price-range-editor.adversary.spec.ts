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
          garageLabourControllerSet: setLabour,
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

// @traces 173-FR-011
describe('the range editor under rapid and hostile use', () => {
  it('sends one save when Save is pressed twice before the answer', async () => {
    await open();
    let answer: (value: unknown) => void = () => undefined;
    setRange.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    button('Salvează')?.click();
    button('Salvează')?.click();
    panel().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();

    expect(setRange).toHaveBeenCalledTimes(1);
    answer({ ...BRAKES, warnings: [] });
    await settle();
  });

  it('sends nothing when the form is submitted with a wrong range', async () => {
    await open();
    await fill('De la', '1500');
    await fill('Până la', '1450');

    panel().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();

    expect(setRange).not.toHaveBeenCalled();
  });

  it('sends nothing for a row that came without an id', async () => {
    await open({
      garageId: GARAGE,
      item: { ...BRAKES, priceId: undefined, updatedAt: undefined },
      kind: 'row',
    } as unknown as PriceRangeEditorData);

    await press();

    const sent = setRange.mock.calls.map(([call]) => call.priceId);
    expect(sent).not.toContain('');
  });

  it('keeps the editor open and unlocked after a server error', async () => {
    await open();
    setRange.mockRejectedValueOnce(refusal(500, { code: 'internal' }));
    await fill('De la', '950');

    await press();

    expect(panel()).not.toBeNull();
    expect(field('De la').disabled).toBe(false);
    expect(button('Salvează')?.disabled).toBe(false);
    expect(field('De la').value).toBe('950');
  });

  it('saves again after a server error and sends the same stamp', async () => {
    await open();
    setRange.mockRejectedValueOnce(refusal(500, { code: 'internal' }));

    await press();
    await press();

    expect(setRange).toHaveBeenCalledTimes(2);
    expect(setRange.mock.calls[1][0].body.expectedUpdatedAt).toBe(STAMP);
    await expect(result).resolves.toBe('saved');
  });

  // The stale text says the saved values are back; when the re-read fails
  // they are not, so the read's own failure is what the owner reads.
  it('survives a stale answer when the re-read fails', async () => {
    await open();
    setRange.mockRejectedValueOnce(refusal(409, { code: 'stale' }));
    read.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await fill('De la', '700');

    await press();

    expect(text()).not.toContain('Lista s‑a schimbat între timp.');
    expect(text()).toContain('Nu am putut ajunge la MotorFix.');
    expect(field('De la').value).toBe('700');
  });

  it('survives a stale answer when the row has left the list', async () => {
    await open();
    setRange.mockRejectedValueOnce(refusal(409, { code: 'stale' }));
    read.mockResolvedValueOnce({ items: [] });

    await press();

    expect(text()).toContain('Lista s‑a schimbat între timp.');
    expect(button('Salvează')).toBeDefined();
  });

  it('ignores a field error naming a field the editor does not have', async () => {
    await open();
    setRange.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'required', field: 'expectedUpdatedAt' }],
      }),
    );

    await press();

    expect(panel()).not.toBeNull();
    expect(button('Salvează')).toBeDefined();
  });

  it('shows a server duration error under the duration', async () => {
    await open();
    setRange.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'step', field: 'durationMinutes' }],
      }),
    );

    await press();

    expect(said('Durată')).not.toBe(formatDuration(120, 'ro'));
    expect(said('Durată')).not.toBe('');
  });

  it('forgets a server error once the field is typed again', async () => {
    await open();
    setRange.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'max', field: 'fromBani' }],
      }),
    );
    await press();
    expect(said('De la')).toBe('Cel mult 100.000 lei');

    await fill('De la', '900');

    expect(said('De la')).toBe('');
    expect(button('Salvează')?.disabled).toBe(false);
  });
});

// @traces 173-FR-003
describe('the range editor: boundaries typed by hand', () => {
  it.each<[string, string, string, number]>([
    ['1 leu', 'De la', '1', 100],
    ['100000 lei as the top', 'Până la', '100000', 10_000_000],
  ])('accepts %s', async (_c, label, typed, bani) => {
    await open();
    if (label === 'De la') await fill('Până la', '2000');
    await fill(label, typed);

    expect(button('Salvează')?.disabled).toBe(false);
    await press();
    const body = setRange.mock.calls[0][0].body;
    expect(label === 'De la' ? body.fromBani : body.toBani).toBe(bani);
  });

  it.each<[string, string, string]>([
    ['100001 lei as the top', 'Până la', '100001'],
    ['a duration of 4815', 'Durată', '4815'],
    ['a duration of 0', 'Durată', '0'],
    ['a duration of 14', 'Durată', '14'],
    ['a duration of 50', 'Durată', '50'],
    ['a negative duration', 'Durată', '-15'],
    ['a fractional duration', 'Durată', '30.5'],
  ])('blocks Save for %s', async (_c, label, typed) => {
    await open();

    await fill(label, typed);
    await press();

    expect(button('Salvează')?.disabled).toBe(true);
    expect(setRange).not.toHaveBeenCalled();
  });

  it('accepts a duration of 15 and one of 4800', async () => {
    await open();

    await fill('Durată', '15');
    expect(button('Salvează')?.disabled).toBe(false);
    await fill('Durată', '4800');
    expect(button('Salvează')?.disabled).toBe(false);
  });

  it('blocks Save when the low end is cleared and says it is needed', async () => {
    await open();

    await fill('De la', '');

    expect(button('Salvează')?.disabled).toBe(true);
    expect(said('De la')).not.toBe('');
  });

  it.each([
    ['letters', 'abc'],
    ['an emoji', '💶'],
    ['a minus sign', '-5'],
    ['an exponent', '1e9'],
  ])('does not send %s typed in a price field', async (_c, typed) => {
    await open();

    await fill('De la', typed);
    await press();

    for (const [call] of setRange.mock.calls) {
      expect(Number.isInteger(call.body.fromBani)).toBe(true);
      expect(call.body.fromBani).toBeGreaterThanOrEqual(100);
    }
  });

  it('sends nothing for a labour range with only a low end', async () => {
    await open({ garageId: GARAGE, kind: 'labour' }, { title: 'x' });
    await fill('De la', '200');

    await press();

    expect(setLabour).not.toHaveBeenCalled();
    expect(button('Salvează')?.disabled).toBe(true);
  });

  it('sends nothing for a labour range with only a top', async () => {
    await open({ garageId: GARAGE, kind: 'labour' }, { title: 'x' });
    await fill('Până la', '260');

    await press();

    expect(setLabour).not.toHaveBeenCalled();
  });

  it('sends nothing for a brand range with a top below the low end', async () => {
    await open(BRAND, { title: 'BMW' });
    await fill('Până la', '100');

    await press();

    expect(setBrandRange).not.toHaveBeenCalled();
  });

  it('shows a row with no top and no duration empty and sends them as null untouched', async () => {
    await open({
      garageId: GARAGE,
      item: { ...BRAKES, durationMinutes: undefined, toBani: undefined },
      kind: 'row',
    });

    expect(field('Până la').value).toBe('');
    expect(field('Durată').value).toBe('');
    await press();
    expect(setRange.mock.calls[0][0].body).toMatchObject({
      durationMinutes: null,
      toBani: null,
    });
  });

  it('warns of a wide range without blocking in the labour editor', async () => {
    await open(LABOUR, { title: 'x' });
    await fill('De la', '100');
    await fill('Până la', '1000');

    expect(button('Salvează')?.disabled).toBe(false);
    expect(said('Până la')).not.toBe('');
  });
});

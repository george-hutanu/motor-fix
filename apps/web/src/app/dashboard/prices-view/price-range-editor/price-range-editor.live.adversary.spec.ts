import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GaragesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  type EditableRow,
  PriceRangeEditor,
  type PriceRangeEditorData,
  priceText,
} from './price-range-editor';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const BRAKES: EditableRow = {
  brandRanges: [],
  durationMinutes: 120,
  fromBani: 50_000,
  jobTypeId: 'brakes',
  nameEn: 'Brakes',
  nameRo: 'Frâne',
  priceId: 'price-brakes',
  public: true,
  toBani: 70_000,
  updatedAt: '2026-10-18T08:00:00.000Z',
};

let setRange: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  data: PriceRangeEditorData,
  language: 'ro' | 'en' = 'ro',
  stored?: Partial<EditableRow>,
) {
  setRange = jest.fn(async () => {
    throw new HttpErrorResponse({ error: { code: 'stale' }, status: 409 });
  });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: {
          priceListControllerRead: jest.fn(async () => ({
            items: [{ ...BRAKES, ...stored }],
          })),
          priceListControllerSetRange: setRange,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  await TestBed.inject(I18n).enter('public');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  void host.componentInstance.overlays.open(PriceRangeEditor, {
    data,
    shape: 'dialog',
    title: 'Frâne',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const lines = () => [...panel().querySelectorAll('.live-changed')];
const field = (label: string) => {
  const found = [...panel().querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  );
  return document.getElementById(found?.htmlFor ?? '') as HTMLInputElement;
};

async function live(
  language: 'ro' | 'en' = 'ro',
  stored?: Partial<EditableRow>,
) {
  const shown = signal<EditableRow | undefined>(BRAKES);
  await open(
    { garageId: 'g', item: BRAKES, kind: 'row', shown },
    language,
    stored,
  );
  return async (row: EditableRow | undefined) => {
    shown.set(row);
    await settle();
  };
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

describe('the range editor against hostile live changes', () => {
  // @traces 588-FR-002
  it('shows the latest range when the list changes twice, in one line', async () => {
    const show = await live();

    await show({ ...BRAKES, fromBani: 60_000 });
    await show({ ...BRAKES, fromBani: 90_000, toBani: 95_000 });

    expect(lines()).toHaveLength(1);
    expect(lines()[0].textContent?.trim()).toBe(
      'S‑a schimbat între timp: 900–950 lei\u00a0· 2\u00a0h',
    );
  });

  // @traces 588-FR-004
  it('drops the line when the range changes and changes straight back', async () => {
    const show = await live();

    await show({ ...BRAKES, toBani: 99_000 });
    await show({ ...BRAKES });

    expect(lines()).toHaveLength(0);
  });

  // @traces 588-FR-002
  it('treats a duration-only change as a change, with the same ends', async () => {
    const show = await live('en');

    await show({ ...BRAKES, durationMinutes: 45 });

    expect(lines()[0].textContent?.trim()).toBe(
      'This changed in the meantime: 500–700 lei\u00a0· 45\u00a0min',
    );
  });

  // @traces 588-FR-002
  it('writes equal ends once', async () => {
    const show = await live();

    await show({ ...BRAKES, fromBani: 80_000, toBani: 80_000 });

    expect(lines()[0].textContent?.trim()).toBe(
      'S‑a schimbat între timp: 800 lei\u00a0· 2\u00a0h',
    );
  });

  // @traces 588-FR-002
  it('treats a duration that went from set to null as a change and writes no separator', async () => {
    const show = await live();

    await show({ ...BRAKES, durationMinutes: null as unknown as undefined });

    expect(lines()[0]?.textContent?.trim()).toBe(
      'S‑a schimbat între timp: 500–700 lei',
    );
  });

  // @traces 588-FR-003
  it('leaves a typed value above the old top as typed', async () => {
    const show = await live();
    const input = field('De la');
    input.value = '7777';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    await show({ ...BRAKES, fromBani: 10_000 });

    expect(field('De la').value).toBe('7777');
    expect(lines()).toHaveLength(1);
  });

  // @traces 588-FR-004
  it('after a refused save builds on the re-read range, not the list’s', async () => {
    const show = await live('ro', { fromBani: 95_000, toBani: 145_000 });
    await show({ ...BRAKES, fromBani: 95_000, toBani: 145_000 });
    expect(lines()).toHaveLength(1);

    [...panel().querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Salvează')
      ?.click();
    await settle();
    expect(field('De la').value).toBe('950');
    expect(lines()).toHaveLength(0);

    await show({ ...BRAKES, fromBani: 99_000, toBani: 145_000 });
    expect(lines()[0].textContent?.trim()).toBe(
      'S‑a schimbat între timp: 990–1.450 lei\u00a0· 2\u00a0h',
    );
  });

  // @traces 588-FR-005
  it.each([
    ['labour', { garageId: 'g', kind: 'labour' }],
    ['propose', { garageId: 'g', kind: 'propose' }],
    [
      'brand',
      {
        brand: { brandId: 'bmw', fromBani: 1, name: 'BMW', toBani: 2 },
        garageId: 'g',
        jobTypeId: 'brakes',
        kind: 'brand',
      },
    ],
  ] as const)(
    'shows no line for a %s editor handed a shown row anyway',
    async (_name, base) => {
      const shown = signal<EditableRow | undefined>(BRAKES);
      await open({ ...base, shown } as unknown as PriceRangeEditorData);

      shown.set({ ...BRAKES, fromBani: 1 });
      await settle();

      expect(lines()).toHaveLength(0);
    },
  );
});

describe('priceText at its edges', () => {
  const i18n = () => TestBed.inject(I18n);

  // @traces 588-FR-002
  it('writes a zero low end with an open top as a starting price', async () => {
    await TestBed.inject(I18n).enter('garage');

    expect(priceText({ fromBani: 0 }, i18n())).toBe('de la 0 lei');
  });

  // @traces 588-FR-002
  it('writes a dash for a range with neither end', async () => {
    await TestBed.inject(I18n).enter('garage');

    expect(priceText({}, i18n())).toBe('—');
  });
});

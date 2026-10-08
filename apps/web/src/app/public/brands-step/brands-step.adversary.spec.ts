import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BrandsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { BrandsStep } from './brands-step';

// @traces 040-FR-002 040-FR-003 040-FR-004 040-FR-005 040-FR-006

const id = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const brand = (name: string, i: number, popularity: number | null = i + 1) => ({
  id: id(i),
  name,
  popularity,
  slug: name.toLowerCase(),
});
const POPULAR = ['BMW', 'Mini', 'Audi', 'Dacia', 'Tesla', 'Renault'].map(
  (name, i) => brand(name, i),
);
const LADA = brand('Lada', 99, null);
const page = (items: ReturnType<typeof brand>[]) => ({
  items,
  nextCursor: null,
  total: items.length,
});

type Fixture = Awaited<ReturnType<typeof open>>['fixture'];

async function open(search: jest.Mock) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: BrandsService, useValue: { brandsControllerSearch: search } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  const fixture = TestBed.createComponent(BrandsStep);
  await settle(fixture);
  return { fixture, step: fixture.nativeElement as HTMLElement };
}

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
const results = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLButtonElement>('.results button'),
];
const searchField = (step: HTMLElement) =>
  step.querySelector('input[type="search"]') as HTMLInputElement;
const field = (step: HTMLElement, name: string) =>
  step.querySelector(`input[name="${name}"]`) as HTMLInputElement;

async function type(fixture: Fixture, input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await settle(fixture);
}

async function tap(fixture: Fixture, step: HTMLElement, name: string, n = 1) {
  for (let i = 0; i < n; i++) {
    chip(step, name).click();
    await settle(fixture);
  }
}

const catalogue = () =>
  jest.fn(async (params?: { q?: string }) =>
    !params?.q
      ? page(POPULAR)
      : page(
          [...POPULAR, LADA].filter((b) =>
            b.name.toLowerCase().includes(params.q?.toLowerCase() ?? ''),
          ),
        ),
  );

describe('step 2 under hostile use', () => {
  it('marks a refused brand taken when search picks it', async () => {
    const { fixture, step } = await open(catalogue());
    await tap(fixture, step, 'Tesla', 2);
    expect(chip(step, 'Tesla').textContent).toContain('nu o primești');

    await type(fixture, searchField(step), 'tesla');
    results(step)[0].click();
    await settle(fixture);

    expect(chips(step)).toHaveLength(6);
    expect(
      fixture.componentInstance.value().brands.find((b) => b.brandId === id(4))
        ?.stance,
    ).toBe('works_on');
  });

  it('ignores an older search that answers after a newer one', async () => {
    let release: (v: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    const search = jest.fn(async (params?: { q?: string }) => {
      if (!params?.q) return page(POPULAR);
      if (params.q === 'lad') return slow;
      return page([]);
    });
    const { fixture, step } = await open(search);

    await type(fixture, searchField(step), 'lad');
    await type(fixture, searchField(step), 'zzz');
    release(page([LADA]));
    await settle(fixture);

    expect(results(step)).toHaveLength(0);
  });

  it('shows nothing and asks for nothing when the field holds only spaces', async () => {
    const search = catalogue();
    const { fixture, step } = await open(search);
    const calls = search.mock.calls.length;

    await type(fixture, searchField(step), '    ');

    expect(search.mock.calls).toHaveLength(calls);
    expect(results(step)).toHaveLength(0);
  });

  it('drops the search-failed line once a later search works', async () => {
    const search = catalogue();
    const { fixture, step } = await open(search);
    search.mockRejectedValueOnce(new Error('offline'));

    await type(fixture, searchField(step), 'lad');
    expect(text(step.querySelector('.notice'))).toBe('Căutarea nu merge acum.');
    await type(fixture, searchField(step), 'lada');

    expect(results(step).map(text)).toEqual(['Lada']);
    expect(text(step.querySelector('.notice'))).not.toBe(
      'Căutarea nu merge acum.',
    );
  });

  it('says search is down and keeps the search usable when the first list fails', async () => {
    const search = catalogue();
    search.mockRejectedValueOnce(new Error('offline'));
    const { step } = await open(search);

    expect(chips(step)).toHaveLength(0);
    expect(text(step.querySelector('.notice'))).toBe('Căutarea nu merge acum.');
  });

  it('survives an empty catalogue and a catalogue of one', async () => {
    const empty = await open(jest.fn(async () => page([])));
    expect(chips(empty.step)).toHaveLength(0);
    expect(text(empty.step.querySelector('[aria-live="polite"]'))).toBe(
      '0 primite · 0 refuzate',
    );
    TestBed.resetTestingModule();

    const one = await open(jest.fn(async () => page([POPULAR[0]])));
    expect(chips(one.step).map(text)).toEqual(['BMW']);
  });

  it('restores a draft with a brand outside the popular chips, in its stance, and cycles it', async () => {
    const { fixture, step } = await open(catalogue());

    fixture.componentRef.setInput('value', {
      brandNote: 'Doar benzină',
      brands: [{ brandId: LADA.id, name: 'Lada', stance: 'does_not_take' }],
      refusalPhrase: 'orice nu e Lada',
    });
    await settle(fixture);

    expect(chip(step, 'Lada').textContent).toContain('nu o primești');
    expect(field(step, 'brandNote').value).toBe('Doar benzină');
    expect(field(step, 'refusalPhrase').value).toBe('orice nu e Lada');
    await tap(fixture, step, 'Lada');
    expect(fixture.componentInstance.value().brands).toEqual([]);
  });

  it('counts the limit after trimming, so padded text of 140 letters is kept whole', async () => {
    const { fixture, step } = await open(catalogue());

    await type(fixture, field(step, 'brandNote'), `   ${'a'.repeat(140)}  `);
    await type(fixture, field(step, 'refusalPhrase'), ` ${'b'.repeat(60)} `);

    const value = fixture.componentInstance.value();
    expect(value.brandNote).toBe('a'.repeat(140));
    expect(value.refusalPhrase).toBe('b'.repeat(60));
  });

  it('keeps a 140 letter note made of two code point characters whole', async () => {
    const { fixture, step } = await open(catalogue());
    const family = '👨‍👩‍👧';

    await type(fixture, field(step, 'brandNote'), `é${'😀'.repeat(139)}`);

    expect([
      ...(fixture.componentInstance.value().brandNote ?? ''),
    ]).toHaveLength(140);
    await type(fixture, field(step, 'refusalPhrase'), family.repeat(10));
    expect(fixture.componentInstance.value().refusalPhrase).toBe(
      family.repeat(10).trim(),
    );
  });

  it('removes the text from the values when the field is emptied again', async () => {
    const { fixture, step } = await open(catalogue());
    await type(fixture, field(step, 'brandNote'), 'Doar benzină');

    await type(fixture, field(step, 'brandNote'), '');

    expect(fixture.componentInstance.value()).toEqual({ brands: [] });
  });

  it('holds no entry for a brand tapped three times and no text keys when none was typed', async () => {
    const { fixture, step } = await open(catalogue());

    await tap(fixture, step, 'BMW', 3);

    expect(fixture.componentInstance.value()).toEqual({ brands: [] });
  });

  it('uses "de" in the counter from twenty marked brands on', async () => {
    const many = Array.from({ length: 25 }, (_, i) => brand(`Marca${i}`, i, i));
    const { fixture, step } = await open(jest.fn(async () => page(many)));
    fixture.componentRef.setInput('value', {
      brands: many
        .slice(0, 20)
        .map((b) => ({ brandId: b.id, name: b.name, stance: 'works_on' })),
    });
    await settle(fixture);

    expect(text(step.querySelector('[aria-live="polite"]'))).toBe(
      '20 de primite · 0 refuzate',
    );
  });

  it('takes a search term with regular-expression characters without failing', async () => {
    const { fixture, step } = await open(catalogue());

    await type(fixture, searchField(step), '(*[');

    expect(results(step)).toHaveLength(0);
    await tap(fixture, step, 'BMW');
    expect(fixture.componentInstance.value().brands).toHaveLength(1);
  });
});

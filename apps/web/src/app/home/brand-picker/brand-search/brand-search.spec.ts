import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type BrandDto,
  type BrandPageDto,
  BrandsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { BrandSearch } from './brand-search';

const brand = (name: string, popularity: number | null = null): BrandDto => ({
  id: `id-${name}`,
  name,
  popularity,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
});
const AUDI = brand('Audi', 1);
const ALFA = brand('Alfa Romeo');
const ASTON = brand('Aston Martin');
const SKODA = brand('Škoda', 2);

type Page = {
  resolve: (page: BrandPageDto) => Promise<void>;
  reject: (error: unknown) => Promise<void>;
};
let pages: Page[];
const api = {
  brandsControllerSearch: jest.fn(
    () =>
      new Promise<BrandPageDto>((resolve, reject) => {
        pages.push({
          reject: async (error) => {
            reject(error);
            await settle();
          },
          resolve: async (page) => {
            resolve(page);
            await settle();
          },
        });
      }),
  ),
};
const onePage = (items: BrandDto[]): BrandPageDto => ({
  items,
  nextCursor: null,
  total: items.length,
});

let fixture: ComponentFixture<BrandSearch>;
let chosen: BrandDto[];
let reached: number;

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  fixture.detectChanges();
}

beforeEach(async () => {
  pages = [];
  chosen = [];
  reached = 0;
  api.brandsControllerSearch.mockClear();
  TestBed.configureTestingModule({
    providers: [{ provide: BrandsService, useValue: api }],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(BrandSearch);
  fixture.componentInstance.chosen.subscribe((b) => chosen.push(b));
  fixture.componentInstance.reached.subscribe(() => reached++);
  fixture.detectChanges();
  document.body.append(fixture.nativeElement);
});

afterEach(() => fixture.nativeElement.remove());

const host = () => fixture.nativeElement as HTMLElement;
const input = () => host().querySelector('input') as HTMLInputElement;
const options = () => [
  ...host().querySelectorAll<HTMLElement>('[role="option"]'),
];
const optionNames = () => options().map((o) => o.textContent?.trim());
const listbox = () => host().querySelector<HTMLElement>('[role="listbox"]');
const status = () =>
  host().querySelector('[role="status"]')?.textContent?.trim();
const retry = () =>
  [...host().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    /Reîncearcă|Try again/.test(b.textContent ?? ''),
  );

async function reach() {
  input().focus();
  input().dispatchEvent(new FocusEvent('focus'));
  await settle();
}
async function loaded(items: BrandDto[] = [AUDI, ALFA, ASTON, SKODA]) {
  await reach();
  await pages[0].resolve(onePage(items));
}
async function type(text: string) {
  input().value = text;
  input().dispatchEvent(new Event('input'));
  await settle();
}
async function key(name: string) {
  input().dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: name,
    }),
  );
  await settle();
}

describe('BrandSearch', () => {
  it('is a field labelled "Caută marca"', () => {
    expect(input().labels?.[0]?.textContent?.trim()).toBe('Caută marca');
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-autocomplete')).toBe('list');
  });

  it('reads no brand until the visitor reaches for the field', async () => {
    await settle();

    expect(api.brandsControllerSearch).not.toHaveBeenCalled();
  });

  it.each([
    ['focus', () => reach()],
    ['a key press', () => key('a')],
    [
      'a pointer press',
      async () => {
        input().dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await settle();
      },
    ],
  ])('starts reading the list on %s', async (_, act) => {
    await act();

    expect(api.brandsControllerSearch).toHaveBeenCalledTimes(1);
  });

  it('reads every page once, following the cursor', async () => {
    await reach();
    await pages[0].resolve({ items: [AUDI], nextCursor: AUDI.id, total: 2 });
    await pages[1].resolve({ items: [ALFA], nextCursor: null, total: 2 });
    await reach();
    await type('a');

    expect(
      api.brandsControllerSearch.mock.calls.map(
        (call) => (call as unknown as [{ cursor?: string }?])[0]?.cursor,
      ),
    ).toEqual([undefined, AUDI.id]);
    expect(optionNames()).toEqual(['Audi', 'Alfa Romeo']);
  });

  it('tells its host it was reached only once', async () => {
    await reach();
    await key('a');
    input().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await reach();

    expect(reached).toBe(1);
  });

  it('suggests the brands that start with what was typed', async () => {
    await loaded();
    await type('alf');

    expect(optionNames()).toEqual(['Alfa Romeo']);
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-controls')).toBe(listbox()?.id);
  });

  it('finds a brand whatever its case and diacritics', async () => {
    await loaded();
    await type('SKODA');

    expect(optionNames()).toEqual(['Škoda']);
  });

  it('gives a tapped suggestion to its host, then clears and closes', async () => {
    await loaded();
    await type('alf');
    options()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    options()[0].click();
    await settle();

    expect(chosen).toEqual([ALFA]);
    expect(input().value).toBe('');
    expect(listbox()).toBeNull();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(input());
  });

  it('walks the suggestions with the arrows, wrapping at both ends', async () => {
    await loaded();
    await type('a');
    const active = () => input().getAttribute('aria-activedescendant');

    expect(active()).toBeNull();
    await key('ArrowDown');
    expect(active()).toBe(options()[0].id);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    await key('ArrowDown');
    await key('ArrowDown');
    expect(active()).toBe(options()[2].id);
    await key('ArrowDown');
    expect(active()).toBe(options()[0].id);
    await key('ArrowUp');
    expect(active()).toBe(options()[2].id);
  });

  it('chooses the active suggestion with Enter', async () => {
    await loaded();
    await type('a');
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Enter');

    expect(chosen).toEqual([ALFA]);
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(input());
  });

  it('chooses nothing with Enter when no suggestion is active', async () => {
    await loaded();
    await type('a');
    await key('Enter');

    expect(chosen).toEqual([]);
  });

  it('closes with Escape or when the field loses focus, choosing nothing', async () => {
    await loaded();
    await type('a');
    await key('ArrowDown');
    await key('Escape');

    expect(listbox()).toBeNull();
    expect(chosen).toEqual([]);

    await type('al');
    input().dispatchEvent(new FocusEvent('blur'));
    await settle();

    expect(listbox()).toBeNull();
    expect(chosen).toEqual([]);
  });

  it('says how many brands it found, in Romanian and in English', async () => {
    await loaded();
    await type('a');
    expect(status()).toBe('3 mărci găsite');

    await type('alf');
    expect(status()).toBe('1 marcă găsită');

    await TestBed.inject(I18n).use('en');
    await settle();
    expect(status()).toBe('1 brand found');
  });

  it('never counts more than the eight suggestions it shows', async () => {
    const many = Array.from({ length: 11 }, (_, i) => brand(`Auto ${i + 1}`));
    await loaded(many);
    await type('auto');

    expect(options()).toHaveLength(8);
    expect(status()).toBe('8 mărci găsite');
  });

  it('reads "Nicio marcă găsită" when nothing matches, and Enter selects nothing', async () => {
    await loaded();
    await type('zzz');

    expect(options()).toHaveLength(0);
    expect(host().textContent).toContain('Nicio marcă găsită');
    expect(status()).toBe('Nicio marcă găsită');
    await key('Enter');
    input().dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(chosen).toEqual([]);
  });

  it('suggests nothing for an empty field', async () => {
    await loaded();
    await type('   ');

    expect(listbox()).toBeNull();
    expect(host().textContent).not.toContain('Nicio marcă găsită');
  });

  it('keeps the typed text while the list loads, then suggests', async () => {
    await reach();
    await type('alf');

    expect(input().value).toBe('alf');
    expect(input().disabled).toBe(false);
    expect(status()).toBe('Se încarcă mărcile…');

    await pages[0].resolve(onePage([AUDI, ALFA]));

    expect(optionNames()).toEqual(['Alfa Romeo']);
  });

  it('keeps the typed text and turns English when the language changes', async () => {
    await loaded();
    await type('alf');
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(input().labels?.[0]?.textContent?.trim()).toBe('Search for a brand');
    expect(input().value).toBe('alf');
    expect(optionNames()).toEqual(['Alfa Romeo']);
  });

  it('fails the whole list when a later page fails, suggesting nothing', async () => {
    await reach();
    await pages[0].resolve({ items: [AUDI], nextCursor: AUDI.id, total: 2 });
    await pages[1].reject(new Error('down'));
    await type('a');

    expect(options()).toHaveLength(0);
    expect(input().disabled).toBe(true);
    const message = host().querySelector<HTMLElement>(
      `#${input().getAttribute('aria-describedby')}`,
    );
    expect(message?.textContent?.trim()).toBe('Lista de mărci nu s‑a încărcat');
    expect(retry()).toBeDefined();
  });

  it('reads the list again on retry, then opens and focuses the field', async () => {
    await reach();
    await pages[0].reject(new Error('down'));
    retry()?.click();
    await settle();
    retry()?.click();
    await settle();

    expect(api.brandsControllerSearch).toHaveBeenCalledTimes(2);

    await pages[1].resolve(onePage([AUDI, ALFA]));

    expect(input().disabled).toBe(false);
    expect(retry()).toBeUndefined();
    expect(document.activeElement).toBe(input());
    await type('alf');
    expect(optionNames()).toEqual(['Alfa Romeo']);
  });
});

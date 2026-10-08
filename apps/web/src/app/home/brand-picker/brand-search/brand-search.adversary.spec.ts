import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type BrandDto,
  type BrandPageDto,
  BrandsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { BrandSearch } from './brand-search';

const brand = (name: string): BrandDto => ({
  id: `id-${name}`,
  name,
  popularity: null,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
});
const CITROEN = brand('Citroën');
const SKODA = brand('Škoda');
const BENZ = brand('Mercedes-Benz');
const ALFA = brand('Alfa Romeo');
const AUDI = brand('Audi');
const ASTON = brand('Aston Martin');

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
const listbox = () =>
  host().querySelector<HTMLElement>('#mf-brand-search-list');
const failed = () =>
  host().querySelector<HTMLElement>('#mf-brand-search-failed');
const status = () =>
  host().querySelector('[role="status"]')?.textContent?.trim();
const active = () => input().getAttribute('aria-activedescendant');
const retry = () =>
  [...host().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    /Reîncearcă|Try again/.test(b.textContent ?? ''),
  );

async function reach() {
  input().focus();
  input().dispatchEvent(new FocusEvent('focus'));
  await settle();
}
async function loaded(items: BrandDto[]) {
  await reach();
  await pages[0].resolve(onePage(items));
}
async function type(text: string) {
  input().value = text;
  input().dispatchEvent(new Event('input'));
  await settle();
}
async function key(name: string) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: name,
  });
  input().dispatchEvent(event);
  await settle();
  return event;
}

describe('BrandSearch (edge cases)', () => {
  it('finds Citroën from plain letters and from diacritics', async () => {
    await loaded([CITROEN, SKODA, AUDI]);
    await type('citroen');
    expect(optionNames()).toEqual(['Citroën']);
    await type('CITROËN');
    expect(optionNames()).toEqual(['Citroën']);
    await type('škod');
    expect(optionNames()).toEqual(['Škoda']);
  });

  it('finds a brand with a Romanian comma-below letter from the plain letter', async () => {
    await loaded([brand('Șerban Auto'), AUDI]);
    await type('serb');
    expect(optionNames()).toEqual(['Șerban Auto']);
  });

  it('suggests nothing and shows no "none" text for whitespace-only text', async () => {
    await loaded([AUDI, ALFA]);
    await type('   ');
    expect(listbox()).toBeNull();
    expect(options()).toHaveLength(0);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(status() ?? '').toBe('');
  });

  it('finds Mercedes-Benz by "benz" and Alfa Romeo by "romeo" but not by "lfa"', async () => {
    await loaded([BENZ, ALFA, AUDI]);
    await type('benz');
    expect(optionNames()).toEqual(['Mercedes-Benz']);
    await type('romeo');
    expect(optionNames()).toEqual(['Alfa Romeo']);
    await type('lfa');
    expect(options()).toHaveLength(0);
    expect(status()).toBe('Nicio marcă găsită');
  });

  it('shows at most eight of twenty matches, the first eight in list order', async () => {
    const many = Array.from({ length: 20 }, (_, i) => brand(`Auto ${i}`));
    await loaded(many);
    await type('auto');
    expect(optionNames()).toEqual(many.slice(0, 8).map((b) => b.name));
    expect(status()).toBe('8 mărci găsite');
  });

  it('shows exactly eight when exactly eight match', async () => {
    await loaded(Array.from({ length: 8 }, (_, i) => brand(`Auto ${i}`)));
    await type('auto');
    expect(options()).toHaveLength(8);
  });

  it('offers no partial list when the second page fails after the first succeeded', async () => {
    await reach();
    await pages[0].resolve({ items: [AUDI], nextCursor: AUDI.id, total: 2 });
    await type('a');
    await pages[1].reject(new Error('down'));

    expect(options()).toHaveLength(0);
    expect(listbox()).toBeNull();
    expect(input().disabled).toBe(true);
    expect(input().getAttribute('aria-describedby')).toBe(
      'mf-brand-search-failed',
    );
    expect(failed()?.textContent?.trim()).toBe(
      'Lista de mărci nu s‑a încărcat',
    );
    expect(retry()).toBeDefined();
  });

  it('offers no partial list after retry when the first page succeeds and the second fails again', async () => {
    await reach();
    await pages[0].reject(new Error('down'));
    retry()?.click();
    await settle();
    await pages[1].resolve({ items: [AUDI], nextCursor: AUDI.id, total: 2 });
    await pages[2].reject(new Error('down again'));

    expect(input().disabled).toBe(true);
    expect(retry()).toBeDefined();
    expect(options()).toHaveLength(0);
  });

  it('ignores a retry pressed while the list is loading', async () => {
    await reach();
    await pages[0].reject(new Error('down'));
    const button = retry();
    button?.click();
    button?.click();
    button?.click();
    await settle();

    expect(api.brandsControllerSearch).toHaveBeenCalledTimes(2);
  });

  it('leaves the field enabled and focused with the full list after a successful retry', async () => {
    await reach();
    await pages[0].reject(new Error('down'));
    expect(input().disabled).toBe(true);
    input().blur();
    retry()?.click();
    await settle();
    await pages[1].resolve(onePage([AUDI, ALFA]));

    expect(input().disabled).toBe(false);
    expect(failed()).toBeNull();
    expect(retry()).toBeUndefined();
    expect(input().getAttribute('aria-describedby')).toBeNull();
    expect(document.activeElement).toBe(input());
    await type('a');
    expect(optionNames()).toEqual(['Audi', 'Alfa Romeo']);
  });

  it('keeps the field disabled and shows the failure again when the retry fails', async () => {
    await reach();
    await pages[0].reject(new Error('down'));
    retry()?.click();
    await settle();
    await pages[1].reject(new Error('still down'));

    expect(input().disabled).toBe(true);
    expect(failed()).not.toBeNull();
    expect(retry()).toBeDefined();
  });

  it('emits reached once even after many focus, pointer and key events and a failed retry', async () => {
    await reach();
    await reach();
    input().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await key('a');
    await key('b');
    await pages[0].reject(new Error('down'));
    retry()?.click();
    await settle();
    await pages[1].resolve(onePage([AUDI]));
    await reach();

    expect(reached).toBe(1);
  });

  it('emits reached on the first key press alone and starts one read', async () => {
    await key('x');
    expect(reached).toBe(1);
    expect(api.brandsControllerSearch).toHaveBeenCalledTimes(1);
  });

  it('does not read the list again on later reaches after a successful load', async () => {
    await loaded([AUDI]);
    await reach();
    input().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(api.brandsControllerSearch).toHaveBeenCalledTimes(1);
  });

  it('chooses nothing with Enter when the list is open and nothing is active', async () => {
    await loaded([AUDI, ALFA]);
    await type('a');
    await key('Enter');
    expect(chosen).toEqual([]);
    expect(options()).toHaveLength(2);
    expect(input().value).toBe('a');
  });

  it('chooses nothing with Enter on an empty field or before the list loaded', async () => {
    await key('Enter');
    expect(chosen).toEqual([]);
    await pages[0].resolve(onePage([AUDI]));
    await key('Enter');
    expect(chosen).toEqual([]);
  });

  it('wraps from the last suggestion to the first with Down and from no active one to the last with Up', async () => {
    await loaded([AUDI, ALFA, ASTON]);
    await type('a');
    await key('ArrowUp');
    expect(active()).toBe(options()[2].id);
    expect(active()).toBe('mf-brand-search-option-2');
    await key('ArrowDown');
    expect(active()).toBe('mf-brand-search-option-0');
    await key('ArrowUp');
    expect(active()).toBe('mf-brand-search-option-2');
  });

  it('keeps the only suggestion active when arrowing over a single option', async () => {
    await loaded([AUDI, ALFA]);
    await type('alf');
    await key('ArrowDown');
    await key('ArrowDown');
    expect(active()).toBe('mf-brand-search-option-0');
    await key('ArrowUp');
    expect(active()).toBe('mf-brand-search-option-0');
  });

  it('does not move through an empty result list and keeps no active option', async () => {
    await loaded([AUDI]);
    await type('zzz');
    await key('ArrowDown');
    await key('ArrowUp');
    expect(active()).toBeNull();
    await key('Enter');
    expect(chosen).toEqual([]);
  });

  it('clears the active option when the text changes', async () => {
    await loaded([AUDI, ALFA, ASTON]);
    await type('a');
    await key('ArrowDown');
    await key('ArrowDown');
    await type('au');
    expect(active()).toBeNull();
    await key('Enter');
    expect(chosen).toEqual([]);
  });

  it('chooses the exact active brand by Enter, clears the text, closes and keeps focus', async () => {
    await loaded([AUDI, ALFA, ASTON]);
    await type('a');
    await key('ArrowUp');
    await key('Enter');

    expect(chosen).toEqual([ASTON]);
    expect(input().value).toBe('');
    expect(listbox()).toBeNull();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(active()).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it('chooses once when Enter is pressed twice in a row', async () => {
    await loaded([AUDI, ALFA]);
    await type('alf');
    await key('ArrowDown');
    await key('Enter');
    await key('Enter');
    expect(chosen).toEqual([ALFA]);
  });

  it('reopens with fresh suggestions after a choice when typing again', async () => {
    await loaded([AUDI, ALFA]);
    await type('alf');
    options()[0].click();
    await settle();
    await type('aud');
    expect(optionNames()).toEqual(['Audi']);
    expect(active()).toBeNull();
  });

  it('closes with Escape without choosing, keeping the typed text', async () => {
    await loaded([AUDI, ALFA]);
    await type('a');
    await key('ArrowDown');
    await key('Escape');

    expect(listbox()).toBeNull();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().value).toBe('a');
    expect(chosen).toEqual([]);
  });

  it('closes on blur without choosing even with an active option', async () => {
    await loaded([AUDI, ALFA]);
    await type('a');
    await key('ArrowDown');
    input().dispatchEvent(new FocusEvent('blur'));
    await settle();

    expect(listbox()).toBeNull();
    expect(chosen).toEqual([]);
  });

  it('never chooses free text', async () => {
    await loaded([AUDI]);
    await type('Audi');
    await key('Enter');
    input().dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(chosen).toEqual([]);
  });

  it('announces one brand in the singular and none for no match, in English too', async () => {
    await loaded([AUDI, ALFA]);
    await type('alf');
    expect(status()).toBe('1 marcă găsită');
    await TestBed.inject(I18n).use('en');
    await settle();
    expect(status()).toBe('1 brand found');
    await type('a');
    expect(status()).toBe('2 brands found');
    await type('zzz');
    expect(status()).toBe('No brand found');
  });

  it('announces loading while the typed text waits for the list, and nothing for an empty field', async () => {
    await reach();
    expect(status() ?? '').toBe('');
    await type('a');
    expect(status()).toBe('Se încarcă mărcile…');
  });

  it('labels the listbox and gives each option an id matching the active descendant', async () => {
    await loaded([AUDI, ALFA]);
    await type('a');
    expect(listbox()?.getAttribute('role')).toBe('listbox');
    expect(input().getAttribute('aria-controls')).toBe('mf-brand-search-list');
    expect(options().map((o) => o.id)).toEqual([
      'mf-brand-search-option-0',
      'mf-brand-search-option-1',
    ]);
  });

  it('prevents the page from scrolling on ArrowDown and ArrowUp', async () => {
    await loaded([AUDI, ALFA]);
    await type('a');
    expect((await key('ArrowDown')).defaultPrevented).toBe(true);
    expect((await key('ArrowUp')).defaultPrevented).toBe(true);
  });

  it('ignores a page that has no items and still loads', async () => {
    await loaded([]);
    await type('a');
    expect(options()).toHaveLength(0);
    expect(input().disabled).toBe(false);
    expect(status()).toBe('Nicio marcă găsită');
  });

  it('follows three pages to the end', async () => {
    await reach();
    await pages[0].resolve({ items: [AUDI], nextCursor: 'c1', total: 3 });
    await pages[1].resolve({ items: [ALFA], nextCursor: 'c2', total: 3 });
    await pages[2].resolve({ items: [ASTON], nextCursor: null, total: 3 });
    await type('a');
    expect(optionNames()).toEqual(['Audi', 'Alfa Romeo', 'Aston Martin']);
    expect(api.brandsControllerSearch).toHaveBeenCalledTimes(3);
  });
});

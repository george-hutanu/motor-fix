import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal, TransferState } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  type BrandDto,
  BrandsService,
  HealthService,
  type HomeDto,
  HomeService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { BrandSearch } from './brand-picker/brand-search/brand-search';
import { HEALTH, Home, TILES } from './home';

const NAMES = [
  'BMW',
  'Mini',
  'Mercedes-Benz',
  'Audi',
  'Volkswagen',
  'Skoda',
  'Dacia',
  'Renault',
];
const BRANDS: BrandDto[] = NAMES.map((name, i) => ({
  id: `b${i + 1}`,
  name,
  popularity: i + 1,
  slug: name.toLowerCase(),
}));
// Two brands outside the tiles, found only by search.
const ALFA: BrandDto = {
  id: 'alfa',
  name: 'Alfa Romeo',
  popularity: null,
  slug: 'alfa-romeo',
};
const CITROEN: BrandDto = {
  id: 'citroen',
  name: 'Citroën',
  popularity: null,
  slug: 'citroen',
};
const brand = (slug: string) =>
  [...BRANDS, ALFA, CITROEN].find((b) => b.slug === slug) as BrandDto;

// Each Home read stays open until the test answers it.
type Read = {
  slug: string;
  answer: (takers: number, total: number) => Promise<void>;
  fail: (error: unknown) => Promise<void>;
};
let reads: Read[];
const homeApi = {
  homeControllerForBrand: jest.fn(
    ({ brand: slug }: { brand: string }) =>
      new Promise<HomeDto>((resolve, reject) => {
        reads.push({
          answer: async (takers, total) => {
            resolve({ brand: brand(slug), takers, total });
            await settle();
          },
          fail: async (error) => {
            reject(error);
            await settle();
          },
          slug,
        });
      }),
  ),
};
const tilesApi = {
  brandsControllerSearch: jest.fn(),
  popularBrandsControllerTiles: jest.fn(),
};
const healthApi = { healthControllerReady: jest.fn() };
const reduced = signal(false);

let fixture: ComponentFixture<Home>;

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  fixture.detectChanges();
}

beforeEach(async () => {
  reads = [];
  reduced.set(false);
  homeApi.homeControllerForBrand.mockClear();
  tilesApi.popularBrandsControllerTiles.mockReset();
  tilesApi.brandsControllerSearch.mockReset();
  healthApi.healthControllerReady.mockReset();
  await configure();
});

async function configure(platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: HomeService, useValue: homeApi },
      { provide: BrandsService, useValue: tilesApi },
      { provide: HealthService, useValue: healthApi },
      { provide: REDUCED_MOTION, useValue: reduced },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  await TestBed.inject(I18n).enter('public');
}

afterEach(() => {
  jest.useRealTimers();
  Reflect.deleteProperty(document, 'hidden');
});

async function render(tiles: BrandDto[] | null = BRANDS) {
  TestBed.inject(TransferState).set(TILES, tiles);
  fixture = TestBed.createComponent(Home);
  fixture.detectChanges();
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const page = () => fixture.nativeElement as HTMLElement;
const text = () => page().textContent?.replace(/\s+/g, ' ') ?? '';
const tiles = () => [
  ...page().querySelectorAll<HTMLButtonElement>('[role="radio"]'),
];
const checked = () =>
  tiles()
    .find((t) => t.getAttribute('aria-checked') === 'true')
    ?.textContent?.trim();
const count = () => page().querySelector<HTMLElement>('[aria-live]');
const search = () =>
  [...page().querySelectorAll<HTMLAnchorElement>('a')].find((a) =>
    /Caută service‑uri|Find garages/.test(a.textContent ?? ''),
  );
const retry = () =>
  [...page().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    /Reîncearcă|Try again/.test(b.textContent ?? ''),
  );
async function choose(name: string) {
  const tile = tiles().find((t) => t.textContent?.trim() === name);
  tile?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  tile?.click();
  await settle();
}
const slugsRead = () =>
  homeApi.homeControllerForBrand.mock.calls.map(([q]) => q.brand);

describe('Home', () => {
  it('shows the name, the version and both checks', async () => {
    TestBed.inject(TransferState).set(HEALTH, {
      checks: { postgres: 'ok', redis: 'ok', storage: 'ok' },
      status: 'ok',
      version: 'abc123',
    });
    await render();

    expect(text()).toContain('MotorFix');
    expect(text()).toContain('abc123');
    expect(text()).toContain('PostgreSQL: ok · Redis: ok');
  });

  it('names the part that failed', async () => {
    TestBed.inject(TransferState).set(HEALTH, {
      checks: { postgres: 'ok', redis: 'error', storage: 'ok' },
      status: 'error',
      version: 'abc123',
    });
    await render();

    expect(text()).toContain('PostgreSQL: ok · Redis: error');
  });

  it('says the status is unknown when the API did not answer', async () => {
    await render();

    expect(text()).toContain('versiune necunoscută');
    expect(text()).toContain('PostgreSQL: necunoscut · Redis: necunoscut');
  });

  it('has the language switch in its header, and EN turns the page English', async () => {
    await render();

    const en = [
      ...page().querySelectorAll('header [role="group"] button'),
    ].find((b) => b.textContent?.trim() === 'EN') as HTMLButtonElement;
    en.click();
    await new Promise((resolve) => setTimeout(resolve));
    await settle();

    expect(text()).toContain('version unknown');
    expect(text()).toContain('PostgreSQL: unknown · Redis: unknown');
    expect(en.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Home brand picker', () => {
  it('shows the tiles the server read, the first one selected', async () => {
    await render();

    expect(tiles().map((t) => t.textContent?.trim())).toEqual(NAMES);
    expect(checked()).toBe('BMW');
  });

  it('fills the hero with the selected brand', async () => {
    await render();
    await choose('Dacia');

    expect(text()).toContain('Service‑uri pentru Dacia');
    expect(text()).toContain('Cine lucrează pe Dacia, aproape de tine');
    expect(text()).toContain('Alege marca și vezi câte service‑uri o primesc.');
    expect(text()).toContain(
      'Căutarea este pe marcă; modelul, anul și combustibilul intră în cererea de ofertă.',
    );
  });

  it('keeps an empty, named place for the car after the picker', async () => {
    await render();

    const car = page().querySelector('section[aria-label="Mașina ta"]');
    expect(car).not.toBeNull();
    expect(car?.textContent?.trim()).toBe('');
    const picker = page().querySelector('[role="radiogroup"]') as Node;
    expect(
      picker.compareDocumentPosition(car as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('reads the count of the first brand once, then once per choice', async () => {
    await render();
    expect(slugsRead()).toEqual(['bmw']);

    await choose('Dacia');
    await choose('Audi');

    expect(slugsRead()).toEqual(['bmw', 'dacia', 'audi']);
  });

  it('shows a skeleton until the count answers, then the count in Romanian', async () => {
    await render();
    await choose('Dacia');

    expect(count()?.getAttribute('aria-busy')).toBe('true');
    expect(count()?.textContent).not.toContain('din');

    await reads[1].answer(3, 6);

    expect(count()?.getAttribute('aria-busy')).toBe('false');
    expect(count()?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '3 din 6 service‑uri primesc Dacia',
    );
  });

  it.each([
    [1, 1, '1 din 1 service primește Dacia'],
    [0, 0, '0 din 0 service‑uri primesc Dacia'],
    [20, 25, '20 din 25 de service‑uri primesc Dacia'],
    [1, 19, '1 din 19 service‑uri primește Dacia'],
  ])('writes %i of %i as "%s"', async (takers, total, expected) => {
    await render();
    await choose('Dacia');

    await reads[1].answer(takers, total);

    expect(count()?.textContent?.replace(/\s+/g, ' ').trim()).toBe(expected);
  });

  it.each([
    [3, 6, '3 of 6 garages take Dacia'],
    [1, 1, '1 of 1 garage takes Dacia'],
  ])('writes %i of %i in English as "%s"', async (takers, total, expected) => {
    await render();
    await TestBed.inject(I18n).use('en');
    await choose('Dacia');

    await reads[1].answer(takers, total);

    expect(count()?.textContent?.replace(/\s+/g, ' ').trim()).toBe(expected);
  });

  it('drops the answer for a brand no longer selected', async () => {
    await render();
    await choose('Dacia');
    await choose('Audi');

    await reads[2].answer(5, 6);
    await reads[1].answer(3, 6);

    expect(count()?.textContent).toContain('5 din 6 service‑uri primesc Audi');
  });

  it('points the main button at the results for the selected brand, with no request', async () => {
    await render();
    await choose('Dacia');

    expect(search()?.getAttribute('href')).toBe('/ro/garages?brand=dacia');
    expect(slugsRead()).toEqual(['bmw', 'dacia']);
  });

  it('points the main button at the English results on the English page', async () => {
    await render();
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(search()?.textContent?.trim()).toBe('Find garages');
    expect(search()?.getAttribute('href')).toBe('/en/garages?brand=bmw');
  });

  it('keeps the selected brand when the language changes', async () => {
    await render();
    await choose('Dacia');

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(checked()).toBe('Dacia');
    expect(text()).toContain('Garages for Dacia');
  });

  it.each([
    ['no brands', []],
    ['a tiles read that failed on the server', null],
  ])('shows no picker, hero or count for %s, and no error', async (_, list) => {
    await render(list);

    expect(page().querySelector('[role="radiogroup"]')).toBeNull();
    expect(count()).toBeNull();
    expect(text()).not.toContain('Service‑uri pentru');
    expect(text()).not.toContain('Nu am putut');
    expect(homeApi.homeControllerForBrand).not.toHaveBeenCalled();
    expect(text()).toContain('MotorFix');
  });

  it('keeps the count silent until the first touch, then polite', async () => {
    await render();
    expect(count()?.getAttribute('aria-live')).toBe('off');

    await choose('Dacia');

    expect(count()?.getAttribute('aria-live')).toBe('polite');
  });
});

describe('Home brand search', () => {
  const field = () => fixture.debugElement.query(By.directive(BrandSearch));
  async function find(found: BrandDto) {
    field().componentInstance.chosen.emit(found);
    await settle();
  }
  const names = () => tiles().map((t) => t.textContent?.trim());

  it('puts the search field right after the brand tiles', async () => {
    await render();

    const picker = page().querySelector('mf-brand-picker');
    expect(picker?.nextElementSibling?.tagName).toBe('MF-BRAND-SEARCH');
  });

  it('selects a searched brand as the first tile, the other seven after it', async () => {
    await render();
    await find(ALFA);

    expect(names()).toEqual(['Alfa Romeo', ...NAMES.slice(0, 7)]);
    expect(checked()).toBe('Alfa Romeo');
    expect(text()).toContain('Service‑uri pentru Alfa Romeo');
    expect(slugsRead()).toEqual(['bmw', 'alfa-romeo']);
    await reads[1].answer(2, 6);
    expect(count()?.textContent).toContain('Alfa Romeo');
  });

  it('points the main button at the results for a searched brand', async () => {
    await render();
    await find(ALFA);

    expect(search()?.getAttribute('href')).toBe('/ro/garages?brand=alfa-romeo');
  });

  it('lets a later searched brand take the first place of the earlier one', async () => {
    await render();
    await find(ALFA);
    await find(CITROEN);

    expect(names()).toEqual(['Citroën', ...NAMES.slice(0, 7)]);
    expect(checked()).toBe('Citroën');
  });

  it('selects a searched brand that is already a tile where it is', async () => {
    await render();
    await find(brand('dacia'));

    expect(names()).toEqual(NAMES);
    expect(checked()).toBe('Dacia');
  });

  it('reads nothing again when the selected brand is searched', async () => {
    await render();
    await find(ALFA);
    await find(ALFA);
    await find(brand('bmw'));
    await find(brand('bmw'));

    expect(slugsRead()).toEqual(['bmw', 'alfa-romeo', 'bmw']);
  });

  it('keeps a tile chosen after a search working', async () => {
    await render();
    await find(ALFA);
    await choose('Dacia');

    expect(checked()).toBe('Dacia');
    expect(names()[0]).toBe('Alfa Romeo');
  });

  it('shows the popular tiles again on a new visit to Home', async () => {
    await render();
    await find(ALFA);
    fixture.destroy();
    await render();

    expect(names()).toEqual(NAMES);
    expect(checked()).toBe('BMW');
  });

  it('keeps the tiles, hero, count and button working when the brand list fails', async () => {
    tilesApi.brandsControllerSearch.mockRejectedValue(new Error('down'));
    await render();
    const input = page().querySelector<HTMLInputElement>(
      'mf-brand-search input',
    );
    input?.dispatchEvent(new FocusEvent('focus'));
    await settle();
    await choose('Dacia');

    expect(input?.disabled).toBe(true);
    expect(checked()).toBe('Dacia');
    expect(search()?.getAttribute('href')).toBe('/ro/garages?brand=dacia');
    expect(slugsRead()).toEqual(['bmw', 'dacia']);
  });
});

describe('Home brand picker on the server', () => {
  beforeEach(async () => {
    TestBed.resetTestingModule();
    await configure('server');
    healthApi.healthControllerReady.mockResolvedValue(null);
  });

  it('reads eight tiles and hands them to the browser', async () => {
    tilesApi.popularBrandsControllerTiles.mockResolvedValue(BRANDS);
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(tilesApi.popularBrandsControllerTiles).toHaveBeenCalledWith({
      limit: 8,
    });
    expect(TestBed.inject(TransferState).get(TILES, null)).toEqual(BRANDS);
    expect(tiles()).toHaveLength(8);
    expect(homeApi.homeControllerForBrand).not.toHaveBeenCalled();
    expect(count()?.getAttribute('aria-busy')).toBe('true');
  });

  it('hands the browser no tiles when the read fails', async () => {
    tilesApi.popularBrandsControllerTiles.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(TransferState).get(TILES, undefined)).toEqual([]);
    expect(tiles()).toHaveLength(0);
  });
});

describe('Home brand cycling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  async function tick(ms: number) {
    jest.advanceTimersByTime(ms);
    await settle();
  }

  it('moves to the next brand every 5 seconds and wraps from the last to the first', async () => {
    await render();

    await tick(4999);
    expect(checked()).toBe('BMW');
    await tick(1);
    expect(checked()).toBe('Mini');
    await tick(5000 * 7);

    expect(checked()).toBe('BMW');
    expect(slugsRead()).toEqual([...BRANDS.map((b) => b.slug), 'bmw']);
    expect(text()).toContain('Service‑uri pentru BMW');
  });

  it('keeps the count silent while it moves on its own', async () => {
    await render();

    await tick(5000);

    expect(count()?.getAttribute('aria-live')).toBe('off');
  });

  it('waits while the page is hidden and goes on when it is shown', async () => {
    await render();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });

    await tick(15000);
    expect(checked()).toBe('BMW');

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    await tick(5000);
    expect(checked()).toBe('Mini');
  });

  it.each([
    [
      'a pointer down',
      (t: HTMLElement) =>
        t.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })),
    ],
    [
      'a key press',
      (t: HTMLElement) =>
        t.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }),
        ),
    ],
    [
      'keyboard focus',
      (t: HTMLElement) =>
        t.dispatchEvent(new FocusEvent('focusin', { bubbles: true })),
    ],
  ])('stops for good at %s on a tile', async (_, touch) => {
    await render();
    await tick(5000);

    touch(tiles()[3]);
    await tick(60000);

    expect(checked()).toBe('Mini');
    expect(slugsRead()).toEqual(['bmw', 'mini']);
  });

  it('stops for good when the visitor reaches for the brand search', async () => {
    tilesApi.brandsControllerSearch.mockReturnValue(new Promise(() => {}));
    await render();
    await tick(5000);

    page()
      .querySelector('mf-brand-search input')
      ?.dispatchEvent(new FocusEvent('focus'));
    await tick(60000);

    expect(checked()).toBe('Mini');
    expect(count()?.getAttribute('aria-live')).toBe('polite');
  });

  it('keeps the chosen brand after a tap', async () => {
    await render();

    await choose('Dacia');
    await tick(12000);

    expect(checked()).toBe('Dacia');
  });

  it('never moves when the device asks for reduced motion', async () => {
    reduced.set(true);
    await render();

    await tick(30000);

    expect(checked()).toBe('BMW');
    expect(slugsRead()).toEqual(['bmw']);
  });

  it('stops at once when reduced motion turns on', async () => {
    await render();
    await tick(5000);

    reduced.set(true);
    await settle();
    await tick(30000);

    expect(checked()).toBe('Mini');
  });

  it('leaves no timer behind once the page is gone', async () => {
    await render();
    const clear = jest.spyOn(globalThis, 'clearInterval');

    fixture.destroy();

    expect(clear).toHaveBeenCalledTimes(1);
    await tick(60000);
    expect(slugsRead()).toEqual(['bmw']);
  });
});

describe('Home count that fails', () => {
  it.each([
    ['the network', new HttpErrorResponse({ status: 0 })],
    ['a server error', new HttpErrorResponse({ status: 503 })],
    ['an unknown brand', new HttpErrorResponse({ status: 404 })],
  ])(
    'says it could not load the garages after %s, and retries',
    async (_, error) => {
      await render();
      await choose('Dacia');

      await reads[1].fail(error);

      expect(count()?.textContent).toContain(
        'Nu am putut încărca service‑urile',
      );
      expect(search()?.getAttribute('href')).toBe('/ro/garages?brand=dacia');

      retry()?.click();
      await settle();
      expect(slugsRead()).toEqual(['bmw', 'dacia', 'dacia']);
      await reads[2].answer(3, 6);

      expect(count()?.textContent).not.toContain('Nu am putut');
      expect(count()?.textContent).toContain(
        '3 din 6 service‑uri primesc Dacia',
      );
    },
  );

  it('keeps the picker working and clears the error on a new choice', async () => {
    await render();
    await choose('Dacia');
    await reads[1].fail(new HttpErrorResponse({ status: 503 }));

    await choose('Audi');

    expect(checked()).toBe('Audi');
    expect(text()).toContain('Service‑uri pentru Audi');
    expect(count()?.textContent).not.toContain('Nu am putut');
    expect(retry()).toBeUndefined();
  });

  it('says it in English on the English page', async () => {
    await render();
    await TestBed.inject(I18n).use('en');
    await choose('Dacia');

    await reads[1].fail(new HttpErrorResponse({ status: 503 }));

    expect(count()?.textContent).toContain('We could not load the garages');
    expect(retry()?.textContent?.trim()).toBe('Try again');
  });
});

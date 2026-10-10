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
  type HomeGarageDto,
  HomeService,
  type MeDto,
  PlacesService,
} from '@motor-fix/data-access';
import { I18n, LanguageChoice } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { BrandSearch } from './brand-picker/brand-search/brand-search';
import { HEALTH, Home, TILES } from './home';
import { PlaceDialog } from './place/place-dialog/place-dialog';
import type { Place } from './place/place-store';
import { Session } from '../dashboard/session';

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
  near: string | undefined;
  answer: (
    takers: number,
    total: number,
    garages?: Partial<Pick<HomeDto, 'best' | 'preview'>>,
  ) => Promise<void>;
  fail: (error: unknown) => Promise<void>;
};
let reads: Read[];
const homeApi = {
  homeControllerForBrand: jest.fn(
    ({ brand: slug, near }: { brand: string; near?: string }) =>
      new Promise<HomeDto>((resolve, reject) => {
        reads.push({
          answer: async (takers, total, garages) => {
            resolve({
              best: null,
              brand: brand(slug),
              preview: [],
              takers,
              total,
              ...garages,
            });
            await settle();
          },
          fail: async (error) => {
            reject(error);
            await settle();
          },
          near,
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
const placesApi = { placesControllerSearch: jest.fn() };
const session = {
  current: signal<MeDto | null>(null),
  load: jest.fn<Promise<MeDto | null>, []>(),
};
let dialog: (value: OverlayResult<Place>) => void;
const overlays = {
  open: jest.fn(
    () =>
      new Promise<OverlayResult<Place>>((resolve) => {
        dialog = resolve;
      }),
  ),
};
const reduced = signal(false);

let fixture: ComponentFixture<Home>;

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  fixture.detectChanges();
}

beforeEach(async () => {
  reads = [];
  reduced.set(false);
  localStorage.clear();
  session.load.mockReset().mockResolvedValue(null);
  session.current.set(null);
  placesApi.placesControllerSearch.mockReset();
  overlays.open.mockClear();
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
      { provide: PlacesService, useValue: placesApi },
      { provide: Session, useValue: session },
      { provide: Overlays, useValue: overlays },
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
// What the count line says, apart from what the live region adds for the dial.
const tally = () =>
  count()?.querySelector('.tally')?.textContent?.replace(/\s+/g, ' ').trim();
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

  // The switch itself is the site bar's, in the public frame.
  it('turns the page English when English is picked', async () => {
    await render();

    await TestBed.inject(LanguageChoice).pick('en');
    await new Promise((resolve) => setTimeout(resolve));
    await settle();

    expect(text()).toContain('version unknown');
    expect(text()).toContain('PostgreSQL: unknown · Redis: unknown');
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
    expect(tally()).toBe('3 din 6 service‑uri primesc Dacia');
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

    expect(tally()).toBe(expected);
  });

  it.each([
    [3, 6, '3 of 6 garages take Dacia'],
    [1, 1, '1 of 1 garage takes Dacia'],
  ])('writes %i of %i in English as "%s"', async (takers, total, expected) => {
    await render();
    await TestBed.inject(I18n).use('en');
    await choose('Dacia');

    await reads[1].answer(takers, total);

    expect(tally()).toBe(expected);
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

  it('shows a popular brand a search pushed off the tiles when it is searched next', async () => {
    await render();
    await find(ALFA);
    await find(brand('renault'));

    expect(names()).toEqual(['Renault', ...NAMES.slice(0, 7)]);
    expect(checked()).toBe('Renault');
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

  it('renders the brand search field, labelled and enabled', async () => {
    tilesApi.popularBrandsControllerTiles.mockResolvedValue(BRANDS);
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const field = root.querySelector<HTMLInputElement>(
      'mf-brand-search input#mf-brand-search',
    );
    expect(field).not.toBeNull();
    expect(field?.disabled).toBe(false);
    expect(field?.getAttribute('role')).toBe('combobox');
    expect(
      root
        .querySelector('mf-brand-search label[for="mf-brand-search"]')
        ?.textContent?.trim(),
    ).toBeTruthy();
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

describe('Home opened from another screen in the app', () => {
  // No server render handed tiles over: the browser reads them itself, so
  // the brands and the place line still show.
  async function visit() {
    TestBed.inject(TransferState).remove(TILES);
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle();
    await settle();
  }

  it('reads the eight tiles in the browser and shows the place line', async () => {
    tilesApi.popularBrandsControllerTiles.mockResolvedValue(BRANDS);
    await visit();

    expect(tilesApi.popularBrandsControllerTiles).toHaveBeenCalledWith({
      limit: 8,
    });
    expect(tiles()).toHaveLength(8);
    expect(page().querySelector('.place')).not.toBeNull();
  });

  it('shows no brands, quietly, when that read fails', async () => {
    tilesApi.popularBrandsControllerTiles.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );
    await visit();

    expect(tiles()).toHaveLength(0);
  });

  it('does not read the tiles again when the server handed them over', async () => {
    await render();

    expect(tilesApi.popularBrandsControllerTiles).not.toHaveBeenCalled();
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

const CLUJ: Place = {
  label: 'Strada Exemplu 2, Cluj-Napoca',
  lat: 46.771,
  lng: 23.624,
  origin: 'address',
};
const HERE: Place = {
  label: null,
  lat: 44.427,
  lng: 26.103,
  origin: 'location',
};
const line = () => page().querySelector<HTMLElement>('.place');
const lineText = () => line()?.textContent?.replace(/\s+/g, ' ').trim();
const lineButton = () => line()?.querySelector('button') as HTMLButtonElement;
const nearsRead = () =>
  homeApi.homeControllerForBrand.mock.calls.map(([q]) => q.near);
const stored = () => localStorage.getItem('mf-place');
const store = (place: Place) =>
  localStorage.setItem('mf-place', JSON.stringify(place));

async function pick(place: OverlayResult<Place>) {
  lineButton().click();
  await settle();
  dialog(place);
  await settle();
}

describe('Home place line', () => {
  it('covers all of Romania before a place is chosen, and reads no place', async () => {
    await render();

    expect(lineText()).toBe('În toată România · Alege locul');
    expect(nearsRead()).toEqual([undefined]);
  });

  it('sits between the hero and the picker', async () => {
    await render();

    const hero = page().querySelector('.hero') as Node;
    const picker = page().querySelector('[role="radiogroup"]') as Node;
    expect(
      hero.compareDocumentPosition(line() as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (line() as Node).compareDocumentPosition(picker) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says it in English on the English page', async () => {
    await render();
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(lineText()).toBe('All of Romania · Choose a place');
  });

  it('opens the place dialog from its button', async () => {
    await render();

    lineButton().click();
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(PlaceDialog, {
      confirmDiscard: false,
      shape: 'dialog',
      title: 'public.home.place.title',
    });
  });

  it('reads the count once more, near the location chosen, and says so', async () => {
    await render();

    await pick(HERE);

    expect(lineText()).toBe('Lângă tine · Schimbă');
    expect(nearsRead()).toEqual([undefined, '44.427,26.103']);
    await reads[1].answer(2, 2);
    expect(count()?.textContent).toContain('2 din 2 service‑uri primesc BMW');
  });

  it('names the address chosen, and keeps it for the next visit', async () => {
    await render();

    await pick(CLUJ);

    expect(lineText()).toBe('Lângă Strada Exemplu 2, Cluj-Napoca · Schimbă');
    expect(JSON.parse(stored() ?? 'null')).toEqual(CLUJ);
  });

  it('changes nothing when the dialog is closed without a place', async () => {
    await render();

    await pick('cancelled');

    expect(lineText()).toBe('În toată România · Alege locul');
    expect(nearsRead()).toEqual([undefined]);
  });

  it('starts from the stored place, in the very first read', async () => {
    store(CLUJ);
    await render();

    expect(lineText()).toBe('Lângă Strada Exemplu 2, Cluj-Napoca · Schimbă');
    expect(nearsRead()).toEqual(['46.771,23.624']);
    expect(session.load).not.toHaveBeenCalled();
  });

  it('keeps the place when the language changes, and re-fills the line', async () => {
    store(HERE);
    await render();

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(lineText()).toBe('Near you · Change');
    expect(nearsRead()).toEqual(['44.427,26.103']);
  });

  it('drops the answer for a place no longer chosen', async () => {
    await render();
    await pick(HERE);
    await pick(CLUJ);

    await reads[2].answer(2, 2);
    await reads[1].answer(9, 9);

    expect(count()?.textContent).toContain('2 din 2');
    expect(nearsRead()).toEqual([undefined, '44.427,26.103', '46.771,23.624']);
  });

  it('retries a failed read with the same place', async () => {
    store(CLUJ);
    await render();

    await reads[0].fail(new HttpErrorResponse({ status: 503 }));
    retry()?.click();
    await settle();

    expect(nearsRead()).toEqual(['46.771,23.624', '46.771,23.624']);
  });

  it('reads the brand chosen near the place chosen', async () => {
    store(CLUJ);
    await render();

    await choose('Dacia');

    expect(homeApi.homeControllerForBrand).toHaveBeenLastCalledWith({
      brand: 'dacia',
      near: '46.771,23.624',
    });
  });
});

describe('Home place from the Setări city', () => {
  const driver = (city: string | null) => ({ city }) as MeDto;

  it('looks the city up once and takes its first suggestion, without storing it', async () => {
    session.current.set(driver('Cluj-Napoca'));
    placesApi.placesControllerSearch.mockResolvedValue({
      items: [
        { label: 'Cluj-Napoca, Cluj', lat: 46.7712, lng: 23.6236 },
        { label: 'Cluj, Iași', lat: 47.1, lng: 27.5 },
      ],
    });

    await render();
    await settle();

    expect(placesApi.placesControllerSearch).toHaveBeenCalledTimes(1);
    expect(placesApi.placesControllerSearch).toHaveBeenCalledWith({
      lang: 'ro',
      q: 'Cluj-Napoca',
    });
    expect(lineText()).toBe('Lângă Cluj-Napoca · Schimbă');
    expect(nearsRead()).toEqual([undefined, '46.771,23.624']);
    expect(stored()).toBeNull();
    expect(session.load).not.toHaveBeenCalled();
  });

  it('takes the city once another screen has loaded the session', async () => {
    placesApi.placesControllerSearch.mockResolvedValue({
      items: [{ label: 'Cluj-Napoca, Cluj', lat: 46.7712, lng: 23.6236 }],
    });
    await render();
    await settle();
    expect(placesApi.placesControllerSearch).not.toHaveBeenCalled();

    session.current.set(driver('Cluj-Napoca'));
    await settle();
    session.current.set(driver('Cluj-Napoca'));
    await settle();

    expect(placesApi.placesControllerSearch).toHaveBeenCalledTimes(1);
    expect(lineText()).toBe('Lângă Cluj-Napoca · Schimbă');
  });

  it.each([
    ['a visitor', null, undefined],
    ['a driver with no city', driver(null), undefined],
    ['a city nothing is found for', driver('Nicaieri'), { items: [] }],
  ])('stays on all of Romania for %s', async (_, me, answer) => {
    session.current.set(me);
    placesApi.placesControllerSearch.mockResolvedValue(answer);

    await render();
    await settle();

    expect(lineText()).toBe('În toată România · Alege locul');
    expect(nearsRead()).toEqual([undefined]);
  });

  it('stays on all of Romania, saying nothing, when the look-up fails', async () => {
    session.current.set(driver('Cluj-Napoca'));
    placesApi.placesControllerSearch.mockRejectedValue(
      new HttpErrorResponse({ status: 503 }),
    );

    await render();
    await settle();

    expect(lineText()).toBe('În toată România · Alege locul');
    expect(text()).not.toContain('Nu putem');
  });

  it('lets a place chosen meanwhile win over the city', async () => {
    let answer: (value: unknown) => void = () => undefined;
    session.current.set(driver('Cluj-Napoca'));
    placesApi.placesControllerSearch.mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    await render();
    await settle();

    await pick(HERE);
    answer({ items: [{ label: 'Cluj-Napoca', lat: 46.77, lng: 23.62 }] });
    await settle();

    expect(lineText()).toBe('Lângă tine · Schimbă');
  });
});

const garageOf = (over: Partial<HomeGarageDto> = {}): HomeGarageDto => ({
  businessKind: 'company',
  city: 'București',
  id: 'militari',
  labourFromLei: 180,
  name: 'Service Auto Militari',
  rating: 4.9,
  reviewCount: 120,
  slug: 'service-auto-militari',
  stance: 'works_on',
  ...over,
});
const MILITARI = garageOf();
const BERCENI = garageOf({
  id: 'berceni',
  labourFromLei: 150,
  name: 'Atelier Berceni',
  reviewCount: 80,
  slug: 'atelier-berceni',
});
const COLENTINA = garageOf({
  id: 'colentina',
  labourFromLei: 160,
  name: 'Service Colentina',
  rating: 4.6,
  reviewCount: 40,
  slug: 'service-colentina',
  stance: 'does_not_take',
});
const MOBILE = garageOf({
  businessKind: 'mobile',
  city: undefined,
  comesToYou: true,
  distanceKm: null,
  id: 'mobil',
  name: 'Mecanic Mobil Cluj',
  rating: 4.8,
  slug: 'mecanic-mobil-cluj',
});
const THREE = { best: MILITARI, preview: [MILITARI, BERCENI, COLENTINA] };

const dialArea = () => page().querySelector<HTMLElement>('.dial');
const dial = () => page().querySelector<HTMLElement>('mf-rating-dial');
const dialValue = () =>
  dial()?.querySelector('.mf-dial-value')?.textContent?.trim();
const bestName = () =>
  dialArea()?.querySelector('.name')?.textContent?.replace(/\s+/g, ' ').trim();
const bestLine = () =>
  dialArea()?.querySelector('.line')?.textContent?.replace(/\s+/g, ' ').trim();
const rows = () => [
  ...page().querySelectorAll<HTMLAnchorElement>('mf-home-preview a'),
];

// @traces 226-best-rated-brand-dial-FR-001
// @traces 226-best-rated-brand-dial-FR-006
// @traces 226-best-rated-brand-dial-FR-007
describe('Home rating dial', () => {
  it('points the large dial at the best rating and names the garage and its city', async () => {
    await render();
    await choose('Dacia');

    await reads[1].answer(3, 6, THREE);

    expect(dial()?.getAttribute('data-size')).toBe('large');
    expect(dialValue()).toBe('4,9');
    expect(dialArea()?.textContent).toContain('NOTĂ');
    expect(bestName()).toBe('Service Auto Militari');
    expect(bestLine()).toBe('București');
  });

  it('adds the distance to the city once a place is set', async () => {
    store(HERE);
    await render();

    await reads[0].answer(3, 6, {
      best: { ...MILITARI, comesToYou: false, distanceKm: 3.2 },
      preview: [],
    });

    expect(bestLine()).toBe('București · 3,2 km');
  });

  it('says a mobile mechanic comes to you, never its city', async () => {
    store(HERE);
    await render();

    await reads[0].answer(1, 1, { best: MOBILE, preview: [MOBILE] });

    expect(bestLine()).toBe('Mecanic mobil · vine la tine');
    expect(dialArea()?.textContent).not.toContain('București');
  });

  it('switches to English without a new read', async () => {
    store(HERE);
    await render();
    await reads[0].answer(3, 6, {
      best: { ...MILITARI, comesToYou: false, distanceKm: 3.2 },
      preview: [MILITARI],
    });

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(dialValue()).toBe('4.9');
    expect(dialArea()?.textContent).toContain('RATING');
    expect(bestLine()).toBe('București · 3.2 km');
    expect(homeApi.homeControllerForBrand).toHaveBeenCalledTimes(1);
  });

  it('moves the dial and the first row together, from the one read per brand', async () => {
    await render();
    await reads[0].answer(3, 6, THREE);
    await choose('Dacia');

    await reads[1].answer(1, 2, {
      best: BERCENI,
      preview: [BERCENI, COLENTINA],
    });

    expect(slugsRead()).toEqual(['bmw', 'dacia']);
    expect(bestName()).toBe('Atelier Berceni');
    expect(rows()[0]?.textContent).toContain('Atelier Berceni');
  });

  it('announces the rating and the garage in the count area, once touched', async () => {
    await render();
    await choose('Dacia');

    await reads[1].answer(3, 6, THREE);

    expect(count()?.getAttribute('aria-live')).toBe('polite');
    expect(count()?.textContent).toContain('4,9 · Service Auto Militari');
    expect(page().querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('shows the preview under the dial, one row per garage', async () => {
    await render();
    await choose('Dacia');

    await reads[1].answer(3, 6, THREE);

    expect(rows().map((row) => row.getAttribute('href'))).toEqual([
      '/ro/garages/service-auto-militari?brand=dacia',
      '/ro/garages/atelier-berceni?brand=dacia',
      '/ro/garages/service-colentina?brand=dacia',
    ]);
  });
});

// @traces 226-best-rated-brand-dial-FR-004
// @traces 226-best-rated-brand-dial-FR-005
describe('Home rating dial with nothing to name', () => {
  it('rests at "—" and says nobody nearby takes the brand, with the refusing rows', async () => {
    await render();
    await choose('Dacia');

    await reads[1].answer(0, 1, { best: null, preview: [COLENTINA] });

    const nobody = 'Niciun service din zonă nu primește încă Dacia';
    expect(dialValue()).toBe('—');
    expect(bestName()).toBe(nobody);
    expect(
      dialArea()?.querySelector('[role="img"]')?.getAttribute('aria-label'),
    ).toBe(nobody);
    expect(count()?.textContent).toContain(nobody);
    expect(rows()).toHaveLength(1);
  });

  it('says so in English', async () => {
    await render();
    await TestBed.inject(I18n).use('en');
    await choose('Dacia');

    await reads[1].answer(0, 0);

    expect(bestName()).toBe('No garage nearby takes Dacia yet');
  });

  it('says no garage is within 25 km of the place, and offers to change it', async () => {
    store(HERE);
    await render();

    await reads[0].answer(0, 0);

    expect(bestName()).toBe('Niciun service în 25 km');
    const change = [
      ...(dialArea()?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ].find((b) => b.textContent?.trim() === 'Schimbă locul');
    change?.click();
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(PlaceDialog, {
      confirmDiscard: false,
      shape: 'dialog',
      title: 'public.home.place.title',
    });
  });

  it('says nobody takes the brand when no garage is listed and no place is set', async () => {
    await render();

    await reads[0].answer(0, 0);

    expect(bestName()).toBe('Niciun service din zonă nu primește încă BMW');
  });

  it('dims the dial while it loads, with a skeleton name and three skeleton rows', async () => {
    await render();

    expect(dialArea()?.getAttribute('aria-busy')).toBe('true');
    expect(dialArea()?.classList).toContain('dimmed');
    expect(dialValue()).toBe('—');
    expect(dialArea()?.querySelector('.name.skeleton')).not.toBeNull();
    expect(
      page().querySelectorAll('mf-home-preview .row.skeleton'),
    ).toHaveLength(3);
    expect(rows()).toHaveLength(0);

    await reads[0].answer(3, 6, THREE);

    expect(dialArea()?.getAttribute('aria-busy')).toBe('false');
    expect(dialArea()?.classList).not.toContain('dimmed');
  });

  it('keeps the dial at "—" with no name and no rows when the read fails, and refills on retry', async () => {
    await render();

    await reads[0].fail(new HttpErrorResponse({ status: 503 }));

    expect(dialValue()).toBe('—');
    expect(bestName()).toBeUndefined();
    expect(rows()).toHaveLength(0);
    expect(page().querySelectorAll('mf-home-preview .row')).toHaveLength(0);

    retry()?.click();
    await settle();
    await reads[1].answer(3, 6, THREE);

    expect(dialValue()).toBe('4,9');
    expect(rows()).toHaveLength(3);
  });
});

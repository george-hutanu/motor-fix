import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HttpErrorResponse,
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { PLATFORM_ID, signal, TransferState } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import {
  type BrandDto,
  BrandsService,
  HealthService,
  type HomeDto,
  type HomeGarageDto,
  HomeService,
  type MeDto,
  PlacesService,
  provideApiConfiguration,
} from '@motor-fix/data-access';
import { I18n, LanguageChoice } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { BrandChoice } from './brand-choice/brand-choice';
import { BrandSearch } from './brand-picker/brand-search/brand-search';
import { HEALTH, Home } from './home';
import { PlaceDialog } from './place/place-dialog/place-dialog';
import type { Place } from './place/place-store';
import { Consent } from '../consent/consent';
import { Session } from '../dashboard/session';
import { PUBLIC_READ } from '../public-read';
import { serverTimeoutInterceptor } from '../server-timeout.interceptor';

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
const consent = { track: jest.fn() };

let fixture: ComponentFixture<Home>;

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  fixture.detectChanges();
}

beforeEach(async () => {
  reads = [];
  consent.track.mockClear();
  reduced.set(false);
  localStorage.clear();
  session.load.mockReset().mockResolvedValue(null);
  session.current.set(null);
  placesApi.placesControllerSearch.mockReset();
  overlays.open.mockClear();
  homeApi.homeControllerForBrand.mockClear();
  tilesApi.popularBrandsControllerTiles.mockReset();
  tilesApi.brandsControllerSearch.mockReset();
  healthApi.healthControllerReady.mockReset().mockResolvedValue(null);
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
      { provide: Consent, useValue: consent },
    ],
  });
  await TestBed.inject(I18n).enter('public');
}

afterEach(() => {
  jest.useRealTimers();
  Reflect.deleteProperty(document, 'hidden');
});

// No list stands for a tiles read that failed.
async function render(tiles: BrandDto[] | null = BRANDS) {
  if (tiles) tilesApi.popularBrandsControllerTiles.mockResolvedValue(tiles);
  else
    tilesApi.popularBrandsControllerTiles.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );
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
  it('shows the name, the version and both checks the server read', async () => {
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

  it('says the status is unknown when the server render handed no answer over', async () => {
    await render();

    expect(text()).toContain('versiune necunoscută');
    expect(text()).toContain('PostgreSQL: necunoscut · Redis: necunoscut');
  });

  // The browser cannot reach the API's ready check: on the page's own origin
  // the web server answers its own, with the status alone. Every Home of the
  // visit, one the browser opened after a redirect included, shows the
  // server's answer.
  // @traces 1200-FR-006
  it('never asks the ready check in the browser, and keeps the server answer for a later Home', async () => {
    TestBed.inject(TransferState).set(HEALTH, {
      checks: { postgres: 'ok', redis: 'ok', storage: 'ok' },
      status: 'ok',
      version: 'abc123',
    });
    await render();
    fixture.destroy();
    await render();

    expect(healthApi.healthControllerReady).not.toHaveBeenCalled();
    expect(text()).toContain('PostgreSQL: ok · Redis: ok');
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

    expect(text()).toContain('Cine se pricepe la Dacia?');
    expect(text()).toContain('Găsește un mecanic');
    expect(text()).toContain(
      'Alege marca. Acul se duce la cel mai bine cotat service care o primește',
    );
  });

  it('keeps an empty, named place for the car after the picker', async () => {
    await render();

    const car = page().querySelector(
      'section[aria-label="Ce trebuie reparat?"]',
    );
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

    expect(
      search()?.querySelector('[data-voice-of="1"]')?.textContent?.trim(),
    ).toBe('Find garages');
    expect(search()?.getAttribute('href')).toBe('/en/garages?brand=bmw');
  });

  it('keeps the selected brand when the language changes', async () => {
    await render();
    await choose('Dacia');

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(checked()).toBe('Dacia');
    expect(text()).toContain('Who’s tuned for your Dacia?');
  });

  it.each([
    ['no brands', []],
    ['a tiles read that failed on the server', null],
  ])('shows no picker, hero or count for %s, and no error', async (_, list) => {
    await render(list);

    expect(page().querySelector('[role="radiogroup"]')).toBeNull();
    expect(count()).toBeNull();
    expect(text()).not.toContain('Cine se pricepe la');
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
    expect(text()).toContain('Cine se pricepe la Alfa Romeo?');
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

  // @traces 1200-FR-006
  it('reads the ready check and hands it to the browser, a 503 report included', async () => {
    const report = {
      checks: { postgres: 'ok', redis: 'error', storage: 'ok' },
      status: 'error',
      version: 'abc123',
    };
    healthApi.healthControllerReady.mockRejectedValue(
      new HttpErrorResponse({ error: report, status: 503 }),
    );
    tilesApi.popularBrandsControllerTiles.mockResolvedValue(BRANDS);
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(TestBed.inject(TransferState).get(HEALTH, null)).toEqual(report);
  });

  // @traces 228-FR-007 228-FR-009
  it('reads sixteen brands once, shows the first eight as tiles and hands them to the browser', async () => {
    tilesApi.popularBrandsControllerTiles.mockResolvedValue(BRANDS);
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(tilesApi.popularBrandsControllerTiles).toHaveBeenCalledWith(
      { limit: 16 },
      expect.anything(),
    );
    expect(tiles()).toHaveLength(8);
    expect(homeApi.homeControllerForBrand).not.toHaveBeenCalled();
    expect(count()?.getAttribute('aria-busy')).toBe('true');
  });

  // @traces 228-FR-011
  it('asks for no more brands than the popular-brands call accepts', () => {
    const api = JSON.parse(
      readFileSync(join(__dirname, '../../../../api/openapi.json'), 'utf8'),
    );
    const limit = api.paths['/api/v1/brands/popular'].get.parameters.find(
      (p: { name: string }) => p.name === 'limit',
    );

    expect(limit.schema.maximum).toBe(16);
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

  it('shows no tiles when the read fails', async () => {
    tilesApi.popularBrandsControllerTiles.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(tiles()).toHaveLength(0);
  });
});

// The real brand and health reads through the app's HttpClient, against an
// API that never answers: the cap ends both, and the page renders its
// fallback instead of waiting.
// @traces 1188-FR-002
describe('Home on the server when the API does not answer', () => {
  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(
          withFetch(),
          withInterceptors([serverTimeoutInterceptor]),
        ),
        provideApiConfiguration('http://api.internal:3000'),
        { provide: HomeService, useValue: homeApi },
        { provide: PlacesService, useValue: placesApi },
        { provide: Session, useValue: session },
        { provide: Overlays, useValue: overlays },
        { provide: REDUCED_MOTION, useValue: reduced },
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: Consent, useValue: consent },
      ],
    });
    await TestBed.inject(I18n).enter('public');
    globalThis.fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          );
        }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('renders with no tiles and an unknown status once the 3 s cap ends both reads', async () => {
    jest.useFakeTimers();
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    let stable = false;
    void fixture.whenStable().then(() => {
      stable = true;
    });

    await jest.advanceTimersByTimeAsync(2_999);
    expect(stable).toBe(false);

    // The cap, then the render's own scheduling: well inside SC-001's 4 s.
    await jest.advanceTimersByTimeAsync(1 + 100);
    await settle();

    expect(stable).toBe(true);
    const fetched = (globalThis.fetch as jest.Mock).mock.calls as [
      string,
      RequestInit,
    ][];
    expect(fetched.map(([url, init]) => [url, init.signal?.aborted])).toEqual([
      ['http://api.internal:3000/api/v1/brands/popular?limit=16', true],
      ['http://api.internal:3000/health/ready', true],
    ]);
    expect(tiles()).toHaveLength(0);
    expect(TestBed.inject(TransferState).get(HEALTH, null)).toBeNull();
  });
});

describe('Home opened from another screen in the app', () => {
  // No server render handed tiles over: the browser reads them itself, so
  // the brands and the place line still show.
  async function visit() {
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle();
    await settle();
  }

  // @traces 228-FR-009
  it('reads the sixteen brands in the browser and shows the place line', async () => {
    tilesApi.popularBrandsControllerTiles.mockResolvedValue(BRANDS);
    await visit();

    expect(tilesApi.popularBrandsControllerTiles).toHaveBeenCalledWith(
      { limit: 16 },
      expect.anything(),
    );
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

  // A signed-in visitor's token would keep the browser from the answer the
  // server render handed over, so the tiles go out as a public read.
  // @traces 1200-FR-004
  // @traces 1200-FR-005
  it('reads the tiles once, as a public read', async () => {
    await render();

    expect(tilesApi.popularBrandsControllerTiles).toHaveBeenCalledTimes(1);
    const [, context] = tilesApi.popularBrandsControllerTiles.mock.calls[0];
    expect(context.get(PUBLIC_READ)).toBe(true);
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
    expect(text()).toContain('Cine se pricepe la BMW?');
  });

  it('keeps the count silent while it moves on its own', async () => {
    await render();

    await tick(5000);

    expect(count()?.getAttribute('aria-live')).toBe('off');
  });

  // What the browser does as the tab goes to the back and comes forward.
  const hide = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: hidden,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('waits while the page is hidden and goes on when it is shown', async () => {
    await render();
    hide(true);

    await tick(15000);
    expect(checked()).toBe('BMW');

    hide(false);
    await tick(5000);
    expect(checked()).toBe('Mini');
  });

  // @traces 007-FR-018
  it('pauses mid-count when hidden and waits a full 5 seconds once shown', async () => {
    await render();
    await tick(3000);
    hide(true);
    await tick(2000);
    expect(checked()).toBe('BMW');
    await tick(60500);
    expect(checked()).toBe('BMW');

    hide(false);
    await tick(0);
    expect(checked()).toBe('BMW');
    await tick(4999);
    expect(checked()).toBe('BMW');
    await tick(1);
    expect(checked()).toBe('Mini');
    await tick(5000);
    expect(checked()).toBe('Mercedes-Benz');
  });

  // @traces 007-FR-018
  it('does not start a second count when shown twice', async () => {
    await render();
    hide(false);
    hide(false);

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

// @traces 227-FR-005
describe('Home on the way back from a card', () => {
  // Home created again inside the browser's back (or a new visit).
  async function again(trigger: 'popstate' | 'imperative' = 'popstate') {
    fixture.destroy();
    Object.defineProperty(TestBed.inject(Router), 'currentNavigation', {
      configurable: true,
      value: signal({ trigger }),
    });
    await render();
  }

  it('keeps the tile the person chose, not the first one', async () => {
    await render();
    await choose('Dacia');

    await again();

    expect(checked()).toBe('Dacia');
    expect(search()?.getAttribute('href')).toBe('/ro/garages?brand=dacia');
  });

  it('starts at the first tile on a new visit to Home', async () => {
    await render();
    await choose('Dacia');

    await again('imperative');

    expect(checked()).toBe('BMW');
  });

  it('shows the popular tiles again after a searched brand', async () => {
    await render();
    await choose('Dacia');
    fixture.debugElement
      .query(By.directive(BrandSearch))
      .componentInstance.chosen.emit(ALFA);
    await settle();

    await again();

    expect(tiles().map((t) => t.textContent?.trim())).toEqual(NAMES);
    expect(checked()).toBe('BMW');
  });

  it('starts at the first tile while nobody chose, the cycle aside', async () => {
    jest.useFakeTimers();
    await render();
    jest.advanceTimersByTime(5000);
    await settle();

    await again();

    expect(checked()).toBe('BMW');
  });

  it('stays on the kept tile instead of cycling on', async () => {
    await render();
    await choose('Audi');
    jest.useFakeTimers();

    await again();
    for (let step = 0; step < 8; step++) {
      jest.advanceTimersByTime(5000);
      await settle();
      expect(checked()).toBe('Audi');
    }
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
    expect(text()).toContain('Cine se pricepe la Audi?');
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
    // The city is placed before the first Home read answers, so it is the only one.
    expect(nearsRead()).toEqual(['46.771,23.624']);
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
  doesNotTake: [],
  id: 'militari',
  labourFromLei: 180,
  name: 'Service Auto Militari',
  rating: 4.9,
  reviewCount: 120,
  slug: 'service-auto-militari',
  stance: 'works_on',
  worksOn: ['Dacia'],
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

// @traces 226-FR-001
// @traces 226-FR-006
// @traces 226-FR-007
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

  // @traces 227-FR-003
  it('marks a line that is only the city as shown as written', async () => {
    await render();
    await choose('Dacia');
    await reads[1].answer(3, 6, THREE);

    const line = dialArea()?.querySelector('.line');
    expect(line?.textContent?.trim()).toBe('București');
    expect(line?.closest('[translate="no"]')).not.toBeNull();
  });

  // @traces 227-FR-003
  it('marks the city beside the distance as shown as written', async () => {
    store(HERE);
    await render();
    await reads[0].answer(3, 6, {
      best: { ...MILITARI, comesToYou: false, distanceKm: 3.2 },
      preview: [],
    });

    const city = dialArea()?.querySelector('.line [translate="no"]');
    expect(city?.textContent?.trim()).toBe('București');
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

// @traces 226-FR-004
// @traces 226-FR-005
// @traces 227-FR-011
describe('Home rating dial with nothing to name', () => {
  it('rests at "—" and says nobody nearby takes the brand, with the refusing rows', async () => {
    await render();
    await choose('Dacia');

    await reads[1].answer(0, 1, { best: null, preview: [COLENTINA] });

    const nobody = 'Niciun service din zonă nu primește Dacia';
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

    expect(bestName()).toBe('No garage nearby takes Dacia');
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

    expect(bestName()).toBe('Niciun service din zonă nu primește BMW');
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

const cardsArea = () => page().querySelector<HTMLElement>('mf-home-cards');
const cards = () => [
  ...page().querySelectorAll<HTMLAnchorElement>('mf-home-cards a.card'),
];
const allLink = () =>
  page().querySelector<HTMLAnchorElement>('mf-home-cards a.all');

// @traces 227-FR-001
// @traces 227-FR-002
// @traces 227-FR-006
describe('Home garage cards', () => {
  it('follows the car section with one card per preview garage, from the same read', async () => {
    await render();
    await choose('Dacia');

    await reads[1].answer(3, 6, THREE);

    expect(
      page().querySelector('section.car')?.nextElementSibling?.localName,
    ).toBe('mf-home-cards');
    expect(cards().map((card) => card.getAttribute('href'))).toEqual(
      rows().map((row) => row.getAttribute('href')),
    );
    expect(slugsRead()).toEqual(['bmw', 'dacia']);
  });

  it('points its link where the main button points', async () => {
    await render();
    await choose('Dacia');
    await reads[1].answer(0, 0);

    expect(allLink()?.getAttribute('href')).toBe(
      search()?.getAttribute('href'),
    );
    expect(allLink()?.getAttribute('href')).toBe('/ro/garages?brand=dacia');
    expect(cards()).toHaveLength(0);
  });

  it('shows skeleton cards while the read loads, and none of the last brand', async () => {
    await render();
    await reads[0].answer(3, 6, THREE);
    await choose('Dacia');

    expect(cardsArea()?.querySelectorAll('.card.skeleton')).toHaveLength(3);
    expect(cards()).toHaveLength(0);
  });

  it('says the read failed in the cards too, and its retry reads again', async () => {
    await render();
    await reads[0].fail(new HttpErrorResponse({ status: 503 }));

    expect(cardsArea()?.querySelector('[role="alert"]')?.textContent).toContain(
      'Nu am putut încărca service‑urile',
    );
    cardsArea()?.querySelector<HTMLButtonElement>('button')?.click();
    await settle();
    await reads[1].answer(3, 6, THREE);

    expect(slugsRead()).toEqual(['bmw', 'bmw']);
    expect(cards()).toHaveLength(3);
  });

  it('is absent with no brand selected', async () => {
    await render([]);

    expect(cardsArea()).toBeNull();
  });
});

// @traces 250-FR-005
describe('Home brand events', () => {
  const find = async (found: BrandDto) => {
    fixture.debugElement
      .query(By.directive(BrandSearch))
      .componentInstance.chosen.emit(found);
    await settle();
  };

  it('tells a tile picked as a brand picked on the home picker', async () => {
    await render();
    expect(consent.track).not.toHaveBeenCalled();

    await choose('Dacia');

    expect(consent.track).toHaveBeenCalledTimes(1);
    expect(consent.track).toHaveBeenCalledWith('brand_picked', {
      brand: 'dacia',
      source: 'home_picker',
    });
  });

  it('tells a brand found by the search the same way', async () => {
    await render();

    await find(ALFA);

    expect(consent.track).toHaveBeenCalledTimes(1);
    expect(consent.track).toHaveBeenCalledWith('brand_picked', {
      brand: 'alfa-romeo',
      source: 'home_picker',
    });
  });

  it('tells nothing for the brands the picker moves through by itself', async () => {
    jest.useFakeTimers();
    await render();

    jest.advanceTimersByTime(5000 * 3);
    await settle();

    expect(checked()).not.toBe('BMW');
    expect(consent.track).not.toHaveBeenCalled();
  });
});

// Sixteen ranked brands: the eight tiles, then eight more only the strip shows.
const SIXTEEN: BrandDto[] = [
  ...BRANDS,
  ...[
    'Opel',
    'Ford',
    'Kia',
    'Toyota',
    'Peugeot',
    'Volvo',
    'Hyundai',
    'Seat',
  ].map((name, i) => ({
    id: `s${i}`,
    name,
    popularity: 9 + i,
    slug: name.toLowerCase(),
  })),
];
const strip = () => page().querySelector('mf-brand-strip');
const stripButton = (name: string) =>
  [...(strip()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.textContent?.trim() === name && b.tabIndex !== -1,
  );

// @traces 228-FR-007 228-FR-008 228-FR-009
describe('Home brand strip', () => {
  it('shows the sixteen brands under the picker, in ranking order, the tiles still eight', async () => {
    await render(SIXTEEN);

    expect(tiles()).toHaveLength(8);
    expect(
      [...(strip()?.querySelectorAll('button') ?? [])]
        .filter((b) => b.tabIndex !== -1)
        .map((b) => b.textContent?.trim()),
    ).toEqual(SIXTEEN.map((b) => b.name));
    const order = [
      ...page().querySelectorAll('mf-brand-search, mf-brand-strip, .car'),
    ].map((e) => e.tagName.toLowerCase());
    expect(order).toEqual(['mf-brand-search', 'mf-brand-strip', 'section']);
  });

  it('shows fewer brands as they are', async () => {
    await render(BRANDS.slice(0, 5));

    expect(
      [...(strip()?.querySelectorAll('button') ?? [])].filter(
        (b) => b.tabIndex !== -1,
      ),
    ).toHaveLength(5);
  });

  it('leaves the strip out when the read fails or finds none, the rest of Home working', async () => {
    await render(null);
    expect(strip()).toBeNull();
    expect(page().querySelector('mf-how-it-works')).not.toBeNull();

    fixture.destroy();
    await render([]);
    expect(strip()).toBeNull();
  });

  it('selects a tile brand tapped in the strip where it is', async () => {
    await render(SIXTEEN);

    stripButton('Dacia')?.click();
    await settle();

    expect(checked()).toBe('Dacia');
    expect(tiles()).toHaveLength(8);
  });

  it('puts a brand only the strip shows first among the tiles, as a search does', async () => {
    await render(SIXTEEN);

    stripButton('Volvo')?.click();
    await settle();

    expect(checked()).toBe('Volvo');
    expect(tiles()[0].textContent?.trim()).toBe('Volvo');
    expect(tiles()).toHaveLength(8);
    expect(slugsRead()).toContain('volvo');
  });

  it('stops the brand changing on its own once the strip is tapped', async () => {
    jest.useFakeTimers();
    await render(SIXTEEN);

    stripButton('Audi')?.click();
    await settle();
    jest.advanceTimersByTime(30000);
    await settle();

    expect(checked()).toBe('Audi');
    expect(count()?.getAttribute('aria-live')).toBe('polite');
  });
});

// @traces 228-FR-003
describe('Home and the brand it shows', () => {
  it('tells the site bar the brand shown, as it changes', async () => {
    await render();
    const choice = TestBed.inject(BrandChoice);

    expect(choice.shown()).toBe('bmw');
    await choose('Dacia');
    expect(choice.shown()).toBe('dacia');
  });

  it('clears it once Home is gone', async () => {
    await render();

    fixture.destroy();

    expect(TestBed.inject(BrandChoice).shown()).toBeNull();
  });
});

// @traces 228-FR-005 228-FR-016
describe('Home sections', () => {
  it('ends with how MotorFix works after the cards, then the garage invitation', async () => {
    await render();

    const order = [
      ...page().querySelectorAll(
        'mf-home-cards, mf-how-it-works, mf-garage-invite',
      ),
    ].map((e) => e.tagName.toLowerCase());
    expect(order).toEqual([
      'mf-home-cards',
      'mf-how-it-works',
      'mf-garage-invite',
    ]);
  });

  it('shows both when no brand could be read', async () => {
    await render(null);

    expect(page().querySelector('mf-how-it-works')).not.toBeNull();
    expect(page().querySelector('mf-garage-invite')).not.toBeNull();
  });
});

describe('Home in the visit’s voice', () => {
  afterEach(() => {
    delete document.documentElement.dataset['voice'];
  });

  const words = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const hero = (n: number) =>
    page().querySelector(`.hero [data-voice-of="${n}"]`);

  // @traces 006-FR-010
  it('carries every voice’s hero, each in its own group, whatever the visit’s voice', async () => {
    document.documentElement.dataset['voice'] = '2';
    await render();
    await reads[0].answer(2, 3);

    expect(
      [1, 2, 3, 4, 5].map((n) => words(hero(n)?.querySelector('h2'))),
    ).toEqual([
      'Cine se pricepe la BMW?',
      'Știm un mecanic bun pentru BMW.',
      'BMW. 2 service‑uri.',
      'BMW merită mai mult decât „merge și așa”.',
      'Știi cât costă înainte să lași cheile.',
    ]);
    expect(page().querySelectorAll('.hero h2')).toHaveLength(5);
    expect(
      [1, 2, 3, 4, 5].map((n) =>
        words(search()?.querySelector(`[data-voice-of="${n}"]`)),
      ),
    ).toEqual([
      'Caută service‑uri',
      'Arată‑mi mecanicii',
      'Pornește căutarea',
      'Găsește‑l acum',
      'Vezi prețuri și service‑uri',
    ]);
  });

  // @traces 006-FR-007
  it('fills the hero group of voice 4 with its eyebrow and its line', async () => {
    await render();
    await reads[0].answer(2, 3);

    expect(words(hero(4)?.querySelector('.label'))).toBe(
      'Fără „las‑o la noi și vedem”',
    );
    expect(words(hero(4)?.querySelector('p:not(.label)'))).toBe(
      'Găsește mecanicul care chiar lucrează pe marca ta. Cu prețul spus dinainte, nu ghicit la final.',
    );
  });

  // @traces 006-FR-007
  it('speaks in voice 4 below the hero: the car, the garages, the benefits and the call to garages', async () => {
    document.documentElement.dataset['voice'] = '4';
    await render();
    await reads[0].answer(2, 3);

    expect(
      page().querySelector('section.car')?.getAttribute('aria-label'),
    ).toBe('Ce face figuri?');
    expect(words(page().querySelector('mf-home-cards h2'))).toBe(
      'Ei nu strâmbă din nas la BMW',
    );
    expect(words(page().querySelector('mf-how-it-works h2'))).toBe(
      'Fără „vedem noi”. Vezi tu, de acum.',
    );
    expect(words(page().querySelector('mf-garage-invite h2'))).toBe(
      'Ai mâini bune? Să afle tot orașul.',
    );
  });

  // @traces 006-FR-006
  it('keeps the voice when the language changes in the app', async () => {
    document.documentElement.dataset['voice'] = '4';
    await render();
    await reads[0].answer(2, 3);
    await TestBed.inject(LanguageChoice).choose('en');
    await settle();

    expect(words(page().querySelector('mf-home-cards h2'))).toBe(
      'They don’t frown at a BMW',
    );
    expect(words(hero(4)?.querySelector('h2'))).toBe(
      'Your BMW deserves better than “it’ll do”.',
    );
  });
});

describe('Home headline in voice 4', () => {
  const FORMS: Record<string, string> = {
    bmw: 'BMW‑ul tău',
    dacia: 'Dacia ta',
  };
  const WITH_FORMS = BRANDS.map((b) => ({ ...b, roPossessive: FORMS[b.slug] }));
  const FORD: BrandDto = {
    id: 'ford',
    name: 'Ford',
    popularity: 9,
    roPossessive: 'Fordul tău',
    slug: 'ford',
  };
  const headline = () =>
    page()
      .querySelector('.hero [data-voice-of="4"] h2')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
  const find = async (found: BrandDto) => {
    fixture.debugElement
      .query(By.directive(BrandSearch))
      .componentInstance.chosen.emit(found);
    await settle();
  };

  // @traces 007-FR-001
  // @traces 007-FR-020
  it('names the car by its your form in Romanian, tile by tile and from the search', async () => {
    await render(WITH_FORMS);
    expect(headline()).toBe('BMW‑ul tău merită mai mult decât „merge și așa”.');

    await choose('Dacia');
    expect(headline()).toBe('Dacia ta merită mai mult decât „merge și așa”.');

    await find(FORD);
    expect(headline()).toBe('Fordul tău merită mai mult decât „merge și așa”.');
  });

  // @traces 007-FR-003
  // @traces 007-FR-020
  it.each([
    ['null', null],
    ['empty', ''],
    ['absent', undefined],
  ])('falls back to the plain name when the form is %s', async (_, form) => {
    await render([{ ...BRANDS[1], roPossessive: form }, ...BRANDS.slice(2)]);

    expect(headline()).toBe('Mini merită mai mult decât „merge și așa”.');
  });

  // @traces 007-FR-001
  it('keeps the plain name in English', async () => {
    await render(WITH_FORMS);
    await TestBed.inject(LanguageChoice).choose('en');
    await settle();

    expect(headline()).toBe('Your BMW deserves better than “it’ll do”.');
  });

  // @traces 007-FR-001
  it('leaves the other voices on the plain name', async () => {
    await render(WITH_FORMS);

    expect(
      page().querySelector('.hero [data-voice-of="1"] h2')?.textContent,
    ).toContain('Cine se pricepe la BMW?');
  });
});

describe('Home headline in voice 3', () => {
  const headline = () =>
    page()
      .querySelector('.hero [data-voice-of="3"] h2')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
  const english = async () => {
    await TestBed.inject(LanguageChoice).choose('en');
    await settle();
  };

  // @traces 007-FR-006
  // @traces 007-FR-009
  it('reads the takers and the best rating from the Home answer', async () => {
    await render();
    await reads[0].answer(3, 6, THREE);

    expect(headline()).toBe('BMW. 3 service‑uri. Nota maximă: 4,9.');
    await english();
    expect(headline()).toBe('BMW. 3 garages. Top rating: 4.9.');
  });

  // @traces 007-FR-007
  // @traces 007-FR-020
  it.each([
    [1, 'BMW. 1 service.'],
    [2, 'BMW. 2 service‑uri.'],
    [19, 'BMW. 19 service‑uri.'],
    [20, 'BMW. 20 de service‑uri.'],
    [101, 'BMW. 101 service‑uri.'],
    [120, 'BMW. 120 de service‑uri.'],
  ])('counts %i takers by the Romanian plural rules', async (takers, line) => {
    await render();
    await reads[0].answer(takers, 200);

    expect(headline()).toBe(line);
  });

  // @traces 007-FR-007
  it.each([
    [1, 'BMW. 1 garage.'],
    [20, 'BMW. 20 garages.'],
  ])('counts %i takers in English', async (takers, line) => {
    await render();
    await reads[0].answer(takers, 200);
    await english();

    expect(headline()).toBe(line);
  });

  // @traces 007-FR-008
  // @traces 007-FR-020
  it('says no garage takes the brand yet, with no rating, at 0 takers', async () => {
    await render();
    await reads[0].answer(0, 5);

    expect(headline()).toBe('BMW. Niciun service încă.');
    await english();
    expect(headline()).toBe('BMW. No garage yet.');
  });

  // @traces 007-FR-008
  it('leaves the rating out when the dial has no rated garage', async () => {
    await render();
    await reads[0].answer(2, 5, {
      best: { ...MILITARI, rating: null },
      preview: [],
    });

    expect(headline()).toBe('BMW. 2 service‑uri.');
  });

  // @traces 007-FR-011
  it('shows the brand line alone while loading and after a failure', async () => {
    await render();
    expect(headline()).toBe('BMW.');

    await reads[0].fail(new HttpErrorResponse({ status: 500 }));
    expect(headline()).toBe('BMW.');
  });

  // @traces 007-FR-010
  it('agrees with the count line and the dial, and moves with them when the place changes', async () => {
    await render();
    await reads[0].answer(3, 6, THREE);
    expect(tally()).toContain('3 din 6');
    expect(dialValue()).toBe('4,9');
    expect(headline()).toBe('BMW. 3 service‑uri. Nota maximă: 4,9.');

    await pick(HERE);
    expect(headline()).toBe('BMW.');
    await reads[1].answer(1, 2, {
      best: garageOf({ rating: 4.6 }),
      preview: [],
    });

    expect(tally()).toContain('1 din 2');
    expect(dialValue()).toBe('4,6');
    expect(headline()).toBe('BMW. 1 service. Nota maximă: 4,6.');
    expect(homeApi.homeControllerForBrand).toHaveBeenCalledTimes(2);
  });
});

describe('Home headline swap', () => {
  afterEach(() => {
    delete document.documentElement.dataset['voice'];
  });

  const rising = () =>
    page().querySelector('.hero')?.classList.contains('rising');
  const heading = () => page().querySelector('[data-voice-of="1"] h2');

  const settled = async () => {
    heading()?.dispatchEvent(new Event('animationend', { bubbles: true }));
    await settle();
  };

  // @traces 007-FR-002
  it('blurs the headline in after a brand change until its animation ends, not on the first render', async () => {
    await render();
    expect(rising()).toBe(false);
    const before = heading();

    await choose('Audi');

    expect(rising()).toBe(true);
    expect(heading()).not.toBe(before);
    expect(heading()?.textContent?.trim()).toBe('Cine se pricepe la Audi?');
    await settled();
    expect(rising()).toBe(false);
  });

  // @traces 007-FR-002
  it('restarts the blur for a second change mid-animation', async () => {
    await render();

    await choose('Audi');
    const first = heading();
    await choose('Mini');

    expect(heading()).not.toBe(first);
    expect(heading()?.textContent?.trim()).toBe('Cine se pricepe la Mini?');
    await settle();
    expect(rising()).toBe(true);
    await settled();
    expect(rising()).toBe(false);
  });

  // @traces 007-FR-002
  it('never marks the headline rising under reduced motion, where no animation ends', async () => {
    reduced.set(true);
    await render();

    await choose('Audi');

    expect(heading()?.textContent?.trim()).toBe('Cine se pricepe la Audi?');
    expect(rising()).toBe(false);
  });

  // @traces 007-FR-002
  it('blurs the headline in on the automatic change too', async () => {
    jest.useFakeTimers();
    await render();

    jest.advanceTimersByTime(5000);
    await settle();

    expect(checked()).toBe('Mini');
    expect(rising()).toBe(true);
  });

  // The Jest transform drops component styles, so they are read from the source.
  // @traces 008-FR-006
  it('sets the hero headline in Michroma capitals, scaled up from the phone', () => {
    const css = readFileSync(join(__dirname, 'home.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
    const wide =
      css.match(
        /@media \(min-width: 768px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
      )?.[1] ?? '';
    const rule = (block: string) =>
      [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, sel]) => sel.trim() === '.hero h2')
        .map(([, , body]) => body.trim())
        .join(' ');
    const phone = rule(css.replace(wide, ''));

    expect(phone).toContain('font-family: var(--mf-font-label);');
    expect(phone).toContain('text-transform: uppercase;');
    expect(phone).toContain('font-size: var(--mf-size-subheading);');
    expect(rule(wide)).toContain('font-size: var(--mf-size-title);');
  });

  // @traces 008-FR-003
  it('sets the hero label at body size on a phone and in the label type above it', () => {
    const css = readFileSync(join(__dirname, 'home.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
    const phone = css.match(
      /@media \(max-width: 767\.98px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
    )?.[1];
    const size = (block: string) =>
      [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, sel]) => sel.trim() === '.label')
        .map(([, , body]) => body.match(/font-size: ([^;]+);/)?.[1])
        .filter(Boolean);

    expect(size(phone ?? '')).toEqual(['var(--mf-size-body)']);
    expect(size(css.replace(phone ?? '', ''))).toEqual([
      'var(--mf-size-label)',
    ]);
  });

  // @traces 007-FR-002
  it('plays the blur-in only on a rising headline, and only without reduced motion', () => {
    const css = readFileSync(join(__dirname, 'home.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
    const motion = css.match(
      /@media \(prefers-reduced-motion: no-preference\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
    )?.[1];
    const animating = (block: string) =>
      [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => body.includes('mf-swap-in 520ms'))
        .map(([, sel]) => sel.trim());

    expect(animating(motion ?? '')).toEqual(['.hero.rising h2']);
    expect(animating(css.replace(motion ?? '', ''))).toEqual([]);
  });

  // @traces 007-FR-002
  it('does not blur the headline on the server', async () => {
    TestBed.resetTestingModule();
    await configure('server');
    await render();

    expect(rising()).toBe(false);
  });

  // @traces 007-FR-002
  it.each(['1', '2', '3', '4', '5'])(
    'keeps voice %s through a brand change',
    async (voice) => {
      document.documentElement.dataset['voice'] = voice;
      localStorage.setItem('mf-copy', voice);
      await render();

      await choose('Audi');

      expect(rising()).toBe(true);
      expect(document.documentElement.dataset['voice']).toBe(voice);
      expect(localStorage.getItem('mf-copy')).toBe(voice);
    },
  );
});

describe('Home tiles for a signed-in driver', () => {
  const own = [BRANDS[5], ...BRANDS.filter((_, i) => i !== 5)];
  const signedIn = (role: MeDto['role'], id = 'ana') =>
    session.current.set({ city: null, id, role } as MeDto);
  const reads = () => tilesApi.popularBrandsControllerTiles.mock.calls;

  // @traces 007-FR-014
  it('reads the tiles again with the session once the driver is known, and shows their order', async () => {
    await render();
    expect(reads()).toHaveLength(1);
    expect(reads()[0][1].get(PUBLIC_READ)).toBe(true);
    tilesApi.popularBrandsControllerTiles.mockResolvedValue(own);

    signedIn('driver');
    await settle();
    await settle();

    expect(reads()).toHaveLength(2);
    expect(reads()[1][1]).toBeUndefined();
    expect(tiles()[0].textContent?.trim()).toBe(own[0].name);
    signedIn('driver');
    await settle();
    expect(reads()).toHaveLength(2);
  });

  // @traces 007-FR-016
  it('never reads them again for a visitor or another role', async () => {
    await render();
    signedIn('garage');
    await settle();

    expect(reads()).toHaveLength(1);
    expect(checked()).toBe('BMW');
  });

  // @traces 007-FR-014
  it('keeps the public tiles when the driver’s read fails', async () => {
    await render();
    tilesApi.popularBrandsControllerTiles.mockRejectedValue(
      new HttpErrorResponse({ status: 503 }),
    );

    signedIn('driver');
    await settle();
    await settle();

    expect(reads()).toHaveLength(2);
    expect(tiles().map((t) => t.textContent?.trim())).toEqual(NAMES);
  });
  // @traces 007-FR-014
  it('shows the driver’s order even when the public read answers after it', async () => {
    let answer!: (tiles: BrandDto[]) => void;
    tilesApi.popularBrandsControllerTiles.mockImplementation((_, context) =>
      context?.get(PUBLIC_READ)
        ? new Promise<BrandDto[]>((resolve) => {
            answer = resolve;
          })
        : Promise.resolve(own),
    );
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await settle();

    signedIn('driver');
    await settle();
    answer(BRANDS);
    await settle();
    await settle();

    expect(tiles()[0].textContent?.trim()).toBe(own[0].name);
  });

  // @traces 007-FR-015
  it('gives the visitor after a sign-out the popular tiles again', async () => {
    await render();
    tilesApi.popularBrandsControllerTiles.mockImplementation((_, context) =>
      Promise.resolve(context?.get(PUBLIC_READ) ? BRANDS : own),
    );
    signedIn('driver');
    await settle();
    await settle();
    expect(tiles()[0].textContent?.trim()).toBe(own[0].name);

    session.current.set(null);
    await settle();
    await settle();

    expect(reads()).toHaveLength(3);
    expect(reads()[2][1].get(PUBLIC_READ)).toBe(true);
    expect(tiles().map((t) => t.textContent?.trim())).toEqual(NAMES);
  });
});

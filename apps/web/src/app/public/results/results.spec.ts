import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Location } from '@angular/common';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  GuardsCheckStart,
  provideRouter,
  type Route,
  Router,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type BrandDto,
  BrandsService,
  CarsService,
  type GaragePinsDto,
  type GarageSearchControllerForBrand$Params,
  type GarageSearchControllerPins$Params,
  type GarageSearchPageDto,
  type ListedGarageDto,
  PlacesService,
  SearchService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { Layout, type LayoutName, REDUCED_MOTION } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { FilterWarm } from './filter-warm/filter-warm';
import type { Filters, SwitchKey } from './filters/filters';
import { FiltersPanel } from './filters/filters-panel/filters-panel';
import { Results } from './results';
import type { MapEvents, MapMove } from './results-map/pins-map';
import { RESULTS_MAP, type ResultsMapView } from './results-map/results-map';
import { ResultsSheet } from './results-sheet/results-sheet';
import { routes } from '../../app.routes';
import { BrandSearch } from '../../home/brand-picker/brand-search/brand-search';
import { PlaceDialog } from '../../home/place/place-dialog/place-dialog';
import { type Place, PlaceStore } from '../../home/place/place-store';
import { placesAnswered } from '../address-field/address-field.testing';
import { PublicFrame } from '../frame/frame';
import { PublicLive } from '../live';

const BMW = { id: 'b-bmw', name: 'BMW', slug: 'bmw' };
const PLACE: Place = {
  label: 'Strada Lizeanu 2, București',
  lat: 44.4471,
  lng: 26.1172,
  origin: 'address',
};

const garageOf = (id: string, name: string): ListedGarageDto => ({
  brandNote: null,
  businessKind: 'company',
  city: 'București',
  distanceKm: 3,
  doesNotTake: [],
  facilities: [],
  id,
  labourFromLei: 150,
  name,
  rating: 4.5,
  refusalPhrase: null,
  reviewCount: 10,
  slug: id,
  stance: 'works_on',
  worksOn: [BMW],
});

const pageOf = (
  over: Partial<GarageSearchPageDto> = {},
): GarageSearchPageDto => ({
  brand: BMW,
  counts: { doesNotTake: 17, worksOn: 31 },
  items: [garageOf('one', 'Atelier Unu'), garageOf('two', 'Service Doi')],
  nextCursor: null,
  total: 48,
  ...over,
});

// Each search stays open until the test answers it.
type Read = {
  params: GarageSearchControllerForBrand$Params;
  answer: (page?: GarageSearchPageDto) => Promise<void>;
  fail: (status?: number, retryAfter?: number, body?: unknown) => Promise<void>;
};
let reads: Read[];
const searchApi = {
  garageSearchControllerForBrand: jest.fn(
    (params: GarageSearchControllerForBrand$Params) =>
      new Promise<GarageSearchPageDto>((resolve, reject) => {
        reads.push({
          answer: async (page = pageOf()) => {
            resolve(page);
            await settle();
          },
          fail: async (status = 500, retryAfter?: number, body?: unknown) => {
            reject(
              new HttpErrorResponse({
                error: body,
                headers:
                  retryAfter === undefined
                    ? undefined
                    : new HttpHeaders({ 'Retry-After': String(retryAfter) }),
                status,
              }),
            );
            await settle();
          },
          params,
        });
      }),
  ),
};
const pinsOf = (count: number): GaragePinsDto => ({
  pins: Array.from({ length: count }, (_, i) => ({
    id: `pin-${i}`,
    lat: 44.4 + i / 1000,
    lng: 26.1,
    matches: true,
    rateLei: 150,
    stance: 'works_on' as const,
  })),
  total: count,
});
let pinsAnswer: GaragePinsDto;
const pinsApi = jest.fn((_params: GarageSearchControllerPins$Params) =>
  Promise.resolve(pinsAnswer),
);
Object.assign(searchApi, { garageSearchControllerPins: pinsApi });
const mapView: jest.Mocked<ResultsMapView> = {
  destroy: jest.fn(),
  fit: jest.fn(),
  light: jest.fn(),
  mark: jest.fn(),
  show: jest.fn(),
  spot: jest.fn((_at: { lat: number; lng: number }) => ({ x: 100, y: 200 })),
};
let mapMoved: (move: MapMove) => void;
let mapPicked: (id: string | undefined) => void;
const openMap = jest.fn((_host: HTMLElement, on: MapEvents) => {
  mapMoved = on.moved;
  mapPicked = on.picked;
  return Promise.resolve(mapView);
});
let dialog: (value: OverlayResult<Place>) => void;
const overlays = {
  open: jest.fn(
    () =>
      new Promise<OverlayResult<Place>>((resolve) => {
        dialog = resolve;
      }),
  ),
};

const messages = new Subject<LiveMessage>();
const resync = new Subject<void>();
const live = {
  names: jest.fn((_view: unknown) => true),
  on: (kinds: readonly EventKind[]) =>
    messages.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  register: jest.fn((_view: unknown) => () => undefined),
  resync,
};
const reduced = signal(false);
// jsdom matches no media query, so the page is laid out as on a phone.
const layout = signal<LayoutName>('phone');
// The address look-up of the field Results shows when it has no place.
const placesApi = {
  placesControllerSearch: jest.fn(
    async (_params: { lang: string; q: string }) => ({
      items: [] as { label: string; lat: number; lng: number }[],
    }),
  ),
};

// The brands behind the chips: the popular ones, and no driver signed in.
const AUDI = { id: 'b-audi', name: 'Audi', slug: 'audi' };
const DACIA = { id: 'b-dacia', name: 'Dacia', slug: 'dacia' };
const brandsApi = {
  brandsControllerSearch: jest.fn(async () => ({
    items: [],
    nextCursor: null,
  })),
  popularBrandsControllerTiles: jest.fn(
    async (): Promise<BrandDto[]> =>
      [BMW, AUDI, DACIA].map((b, i) => ({ ...b, popularity: i + 1 })),
  ),
};
const carsApi = { carsControllerList: jest.fn(async () => ({ items: [] })) };

// The warm of the filtered answer: its own reads would join every search
// these tests count, so Results gets a stand-in and FilterWarm has its spec.
const warmer = { judge: jest.fn(), warm: jest.fn() };

let harness: RouterTestingHarness;

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  harness.detectChanges();
}

async function configure(platform = 'browser', more: Route[] = []) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ component: Results, path: ':lang/garages' }, ...more]),
      { provide: SearchService, useValue: searchApi },
      { provide: PlacesService, useValue: placesApi },
      placesAnswered((asked) => placesApi.placesControllerSearch(asked)),
      { provide: Overlays, useValue: overlays },
      { provide: PLATFORM_ID, useValue: platform },
      { provide: PublicLive, useValue: live },
      { provide: REDUCED_MOTION, useValue: reduced },
      { provide: RESULTS_MAP, useValue: openMap },
      { provide: Layout, useValue: { current: layout } },
      { provide: BrandsService, useValue: brandsApi },
      { provide: CarsService, useValue: carsApi },
      { provide: FilterWarm, useValue: warmer },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  harness = await RouterTestingHarness.create();
}

beforeEach(() => {
  reads = [];
  localStorage.clear();
  searchApi.garageSearchControllerForBrand.mockClear();
  pinsAnswer = pinsOf(48);
  pinsApi.mockClear();
  placesApi.placesControllerSearch.mockClear();
  openMap.mockClear();
  mapView.show.mockClear();
  mapView.fit.mockClear();
  mapView.light.mockClear();
  overlays.open.mockClear();
  warmer.warm.mockClear();
  warmer.judge.mockClear();
  live.register.mockClear();
  live.names.mockReset().mockImplementation(() => true);
  reduced.set(false);
  layout.set('phone');
});

afterEach(() => jest.useRealTimers());

// Results searches only from a place: a page opened with a brand and neither
// a place in the bar nor a kept one gets the bar's, unless the test wants
// none.
const NEAR = '44.437,26.117';
async function open(
  url: string,
  { language = 'ro' as 'ro' | 'en', placed = true } = {},
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const bare =
    url.includes('brand=') &&
    !url.includes('near=') &&
    localStorage.getItem('mf-place') === null;
  await harness.navigateByUrl(placed && bare ? `${url}&near=${NEAR}` : url);
  await settle();
  await interactive();
}

// The map shows a static image until the driver taps it; these tests drive
// the interactive map, so they ask for it as a driver would.
async function interactive() {
  const ask = page().querySelector<HTMLElement>('mf-static-map button');
  if (!ask) return;
  ask.click();
  await settle();
}

const page = () => harness.routeNativeElement as HTMLElement;
const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const searches = () =>
  searchApi.garageSearchControllerForBrand.mock.calls.map(([q]) => q);
const keep = (place: Place) =>
  localStorage.setItem('mf-place', JSON.stringify(place));

// @traces 267-FR-012 267-FR-013 267-FR-015 267-FR-016 267-FR-017 267-FR-018 267-FR-019 267-FR-020 267-FR-021
describe('Results', () => {
  describe('in the browser', () => {
    beforeEach(() => configure());

    // @traces 267-FR-012
    // @traces 271-FR-017
    it('reads the brand from the address bar and runs one logged search from the place in it', async () => {
      await open('/ro/garages?brand=bmw');

      expect(searches()).toEqual([{ brand: 'bmw', log: '1', near: NEAR }]);
    });

    // @traces 267-FR-022
    it('reads no other search once the list has come', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();

      expect(searches()).toEqual([{ brand: 'bmw', log: '1', near: NEAR }]);
    });

    // @traces 267-FR-007
    it('logs the search again when the bar names another brand or place', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();
      await open('/ro/garages?brand=audi');
      await reads[1]?.answer();
      await open('/ro/garages?brand=audi&near=44.447,26.117');

      expect(searches()).toEqual([
        { brand: 'bmw', log: '1', near: NEAR },
        { brand: 'audi', log: '1', near: NEAR },
        { brand: 'audi', log: '1', near: '44.447,26.117' },
      ]);
    });

    // @traces 267-FR-012
    it('asks by id when the bar names the brand by its id', async () => {
      await open('/ro/garages?brand=6f1c0a52-3b7e-4c1d-9a2f-0e8b7d6c5a41');

      expect(searches()).toEqual([
        {
          brandId: '6f1c0a52-3b7e-4c1d-9a2f-0e8b7d6c5a41',
          log: '1',
          near: NEAR,
        },
      ]);
    });

    // @traces 267-FR-012
    it('searches near the kept place and writes it into the bar without a history entry', async () => {
      keep(PLACE);
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigate');

      await open('/ro/garages?brand=bmw');

      expect(searches()).toEqual([
        { brand: 'bmw', log: '1', near: '44.447,26.117' },
      ]);
      expect(router.url).toBe('/ro/garages?brand=bmw&near=44.447,26.117');
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ replaceUrl: true }),
      );
    });

    // @traces 267-FR-012
    it('takes the place in the bar over the kept one, and the wider radius with it', async () => {
      keep(PLACE);

      await open('/ro/garages?brand=bmw&near=46.77,23.59&radius=50');

      expect(searches()).toEqual([
        { brand: 'bmw', log: '1', near: '46.77,23.59', radius: 50 },
      ]);
    });

    // @traces 267-FR-012
    it('runs no search without a place, whatever the radius', async () => {
      await open('/ro/garages?brand=bmw&radius=50', { placed: false });

      expect(searches()).toEqual([]);
    });

    // @traces 267-FR-016
    it('shows six skeleton cards while the search runs', async () => {
      await open('/ro/garages?brand=bmw');

      expect(page().querySelectorAll('.card.skeleton')).toHaveLength(6);
      expect(page().querySelector('mf-result-card')).toBeNull();
    });

    // @traces 267-FR-013
    it('titles the page with the brand and sums up the two groups', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();

      expect(said(page().querySelector('h1'))).toBe('Cine primește BMW');
      expect(said(page().querySelector('.summary .tally'))).toBe(
        '48 de service‑uri găsite · 31 lucrează pe BMW · 17 nu o primesc',
      );
    });

    // @traces 267-FR-013
    it('follows the Romanian plural rules in the summary', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer(
        pageOf({ counts: { doesNotTake: 1, worksOn: 2 }, total: 3 }),
      );

      expect(said(page().querySelector('.summary .tally'))).toBe(
        '3 service‑uri găsite · 2 lucrează pe BMW · 1 nu o primește',
      );
    });

    // @traces 267-FR-013
    it('names the area of the kept place, at 25 km by default', async () => {
      keep(PLACE);
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();

      expect(said(page().querySelector('.summary .area'))).toBe(
        'în 25 km de Strada Lizeanu 2, București',
      );
    });

    // @traces 267-FR-013
    it('says no area and sums up nothing without a place', async () => {
      await open('/ro/garages?brand=bmw', { placed: false });

      expect(searches()).toEqual([]);
      expect(page().querySelector('.summary .tally')).toBeNull();
      expect(page().querySelector('.summary .area')).toBeNull();
    });

    // @traces 267-FR-013
    it('runs a new logged search at 25 km near the place chosen through "Schimbă locul"', async () => {
      await open('/ro/garages?brand=bmw&near=46.77,23.59&radius=50');
      await reads[0]?.answer();

      const change = [...page().querySelectorAll('button')].find(
        (b) => said(b) === 'Schimbă locul',
      );
      change?.click();
      await settle();
      expect(overlays.open).toHaveBeenCalledWith(
        PlaceDialog,
        expect.objectContaining({ title: 'public.home.place.title' }),
      );
      dialog(PLACE);
      await settle();
      await settle();

      expect(searches().at(-1)).toEqual({
        brand: 'bmw',
        log: '1',
        near: '44.447,26.117',
      });
      expect(TestBed.inject(Router).url).toBe(
        '/ro/garages?brand=bmw&near=44.447,26.117',
      );
    });

    // @traces 267-FR-014
    it('shows one card per garage, in the order the search gave', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();

      const cards = [...page().querySelectorAll('mf-result-card')];
      expect(cards.map((card) => said(card.querySelector('h2')))).toEqual([
        'Atelier Unu',
        'Service Doi',
      ]);
      expect(page().querySelector('.card.skeleton')).toBeNull();
    });

    // @traces 267-FR-013
    it('speaks English', async () => {
      await open('/en/garages?brand=bmw', { language: 'en' });
      await reads[0]?.answer(
        pageOf({ counts: { doesNotTake: 1, worksOn: 31 }, total: 32 }),
      );

      expect(said(page().querySelector('h1'))).toBe('Who takes your BMW');
      expect(said(page().querySelector('.summary .tally'))).toBe(
        "32 garages found · 31 work on BMW · 1 doesn't take it",
      );
    });
  });

  describe('when nothing comes back', () => {
    beforeEach(() => configure());

    const empty = (over: Partial<GarageSearchPageDto> = {}) =>
      pageOf({
        counts: { doesNotTake: 0, worksOn: 0 },
        items: [],
        total: 0,
        ...over,
      });
    const state = () => page().querySelector('.state');
    const headings = () => page().querySelectorAll('h1');
    const actions = () =>
      [...(state()?.querySelectorAll('button, a') ?? [])].map(said);
    const tap = async (text: string) => {
      const action = [...(state()?.querySelectorAll('button') ?? [])].find(
        (b) => said(b) === text,
      );
      expect(action).toBeDefined();
      action?.click();
      await settle();
    };

    // @traces 267-FR-016
    it('says the results could not be loaded when the search fails, with "Reîncearcă"', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.fail();

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'Nu am putut încărca rezultatele',
      );
      expect(actions()).toEqual(['Reîncearcă']);
      expect(page().querySelector('.card.skeleton')).toBeNull();
      expect(headings()).toHaveLength(1);
    });

    // @traces 267-FR-016
    it('shows the same failure when the API cannot be reached', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.fail(0);

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'Nu am putut încărca rezultatele',
      );
      expect(actions()).toEqual(['Reîncearcă']);
    });

    // @traces 267-FR-016
    it('runs the same search again on "Reîncearcă", without logging it, and shows skeletons meanwhile', async () => {
      keep(PLACE);
      await open('/ro/garages?brand=bmw');
      await reads[0]?.fail();

      await tap('Reîncearcă');

      expect(searches()).toEqual([
        { brand: 'bmw', log: '1', near: '44.447,26.117' },
        { brand: 'bmw', near: '44.447,26.117' },
      ]);
      expect(page().querySelectorAll('.card.skeleton')).toHaveLength(6);
      await reads[1]?.answer();
      expect(page().querySelectorAll('mf-result-card')).toHaveLength(2);
      expect(state()).toBeNull();
    });

    // @traces 1181-FR-006
    it('says calmly how long to wait when the searches from here are past their limit, keeping "Reîncearcă"', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.fail(429, 120);

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'Prea multe încercări. Încearcă din nou peste aproximativ 2 minute.',
      );
      expect(actions()).toEqual(['Reîncearcă']);
      expect(headings()).toHaveLength(1);
    });

    it('says it in English too, one minute for a wait under a minute', async () => {
      await open('/en/garages?brand=bmw', { language: 'en' });
      await reads[0]?.fail(429, 45);

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'Too many attempts. Try again in about 1 minute.',
      );
    });

    it('keeps a neutral line when the refused search names no wait', async () => {
      await open('/en/garages?brand=bmw', { language: 'en' });
      await reads[0]?.fail(429);

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'Too many attempts. Try again in a little while.',
      );
    });

    // @traces 1181-FR-006
    it.each([
      ['past the limit', 429],
      ['failed', 500],
    ])(
      'keeps the map but leaves out its legend when the search is %s, so no loose "nu primește" sits above the message',
      async (_, status) => {
        await open('/ro/garages?brand=bmw');
        await reads[0]?.fail(status);

        expect(
          page().querySelector('mf-results-map section.map'),
        ).not.toBeNull();
        expect(page().querySelector('mf-results-map .legend')).toBeNull();
      },
    );

    // @traces 267-FR-016
    it('offers "Căutare nouă" to Home instead of a retry when the brand is unknown', async () => {
      await open('/ro/garages?brand=nu-exista');
      await reads[0]?.fail(404);

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'Nu am putut încărca rezultatele',
      );
      expect(actions()).toEqual(['Căutare nouă']);
      expect(state()?.querySelector('a')?.getAttribute('href')).toBe('/ro');
      expect(headings()).toHaveLength(1);
    });

    // @traces 267-FR-016
    it('offers "Căutare nouă" and searches nothing when the bar names no brand', async () => {
      await open('/ro/garages');

      expect(searches()).toEqual([]);
      expect(actions()).toEqual(['Căutare nouă']);
    });

    // @traces 267-FR-017
    it('reads "Niciun service în 25 km" with "Caută în 50 km" and "Schimbă locul" when nothing is near the place', async () => {
      keep(PLACE);
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer(empty());

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'Niciun service în 25 km',
      );
      expect(actions()).toEqual(['Caută în 50 km', 'Schimbă locul']);
      // The empty state says it: no all-zero counts above it.
      expect(page().querySelector('.summary .tally')).toBeNull();
    });

    // @traces 267-FR-017
    it('widens to 50 km on "Caută în 50 km" without logging, and offers only "Schimbă locul" after it', async () => {
      keep(PLACE);
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer(empty());

      await tap('Caută în 50 km');
      await settle();

      expect(searches().at(-1)).toEqual({
        brand: 'bmw',
        near: '44.447,26.117',
        radius: 50,
      });
      expect(TestBed.inject(Router).url).toBe(
        '/ro/garages?brand=bmw&near=44.447,26.117&radius=50',
      );
      await reads.at(-1)?.answer(empty());

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'Niciun service în 50 km',
      );
      expect(actions()).toEqual(['Schimbă locul']);
      expect(said(page().querySelector('.summary .area'))).toBe(
        'în 50 km de Strada Lizeanu 2, București',
      );
    });

    // @traces 267-FR-017
    it('opens the place dialog from the empty state, and the place chosen runs a new logged search at 25 km', async () => {
      await open('/ro/garages?brand=bmw&near=46.77,23.59&radius=50');
      await reads[0]?.answer(empty());

      await tap('Schimbă locul');
      expect(overlays.open).toHaveBeenCalledWith(
        PlaceDialog,
        expect.objectContaining({ title: 'public.home.place.title' }),
      );
      dialog(PLACE);
      await settle();
      await settle();

      expect(searches().at(-1)).toEqual({
        brand: 'bmw',
        log: '1',
        near: '44.447,26.117',
      });
    });

    // @traces 267-FR-017
    it('reads "Niciun service în 50 km" with only "Schimbă locul" at the widest radius in the bar', async () => {
      await open('/ro/garages?brand=bmw&radius=50');
      await reads[0]?.answer(empty());

      expect(searches()).toEqual([
        { brand: 'bmw', log: '1', near: NEAR, radius: 50 },
      ]);
      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'Niciun service în 50 km',
      );
      expect(actions()).toEqual(['Schimbă locul']);
    });

    // @traces 267-FR-016
    // @traces 267-FR-017
    it('speaks English in the empty and failed states', async () => {
      keep(PLACE);
      await open('/en/garages?brand=bmw', { language: 'en' });
      await reads[0]?.answer(empty());

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        'No garage within 25 km',
      );
      expect(actions()).toEqual(['Search within 50 km', 'Change place']);

      await tap('Search within 50 km');
      await settle();
      await reads.at(-1)?.fail();

      expect(said(state()?.querySelector('h1, h2'))).toBe(
        "We couldn't load the results",
      );
      expect(actions()).toEqual(['Try again']);
    });
  });

  describe('kept live', () => {
    beforeEach(async () => {
      await configure();
      jest.useFakeTimers();
    });

    const send = (kind: string, id = 'x-1') =>
      messages.next({ at: '2026-10-11T12:00:00.000Z', id, kind });
    // The 300 ms burst window, then the read it starts.
    const coalesce = async () => {
      await jest.advanceTimersByTimeAsync(300);
      await settle();
    };
    const cards = () => [...page().querySelectorAll('.cards > li')];
    const names = () => cards().map((card) => said(card.querySelector('h2')));
    const reviewsOf = (n: number) =>
      said(cards()[n]?.querySelector('.reviews'));
    const tally = () => said(page().querySelector('.summary .tally'));
    const chip = () =>
      [...page().querySelectorAll('button')].find(
        (b) => said(b) === 'Reîncarcă',
      );
    const quietly = () =>
      jest.spyOn(TestBed.inject(LiveAnnouncer), 'announce').mockResolvedValue();

    async function loaded() {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();
    }

    // @traces 267-FR-018
    it('opens the stream with every loaded garage and the brand', async () => {
      await loaded();

      expect(live.register).toHaveBeenLastCalledWith({
        brand: 'b-bmw',
        garages: ['one', 'two'],
      });
    });

    // @traces 267-FR-019
    // @traces 267-FR-021
    it('re-reads the loaded cards through ids= on a review kind and changes them in place, highlighted and announced', async () => {
      const announce = quietly();
      await loaded();
      const [first, second] = cards();
      const focused = document.activeElement;

      send('review.posted', 'review-9');
      send('review.edited', 'review-9');
      await coalesce();

      expect(reads).toHaveLength(2);
      expect(reads[1]?.params).toEqual({
        brand: 'bmw',
        ids: 'one,two',
        near: NEAR,
      });
      await reads[1]?.answer(
        pageOf({
          items: [
            { ...garageOf('one', 'Atelier Unu'), reviewCount: 11 },
            garageOf('two', 'Service Doi'),
          ],
        }),
      );

      expect(names()).toEqual(['Atelier Unu', 'Service Doi']);
      expect(reviewsOf(0)).toContain('11');
      expect(cards()[1]).toBe(second);
      expect(cards()[0]).toBe(first);
      expect(cards()[0]?.classList).toContain('mf-live-changed');
      expect(cards()[1]?.classList).not.toContain('mf-live-changed');
      expect(announce).toHaveBeenCalledWith(
        'Atelier Unu s‑a actualizat',
        'polite',
      );
      expect(announce).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(focused);
    });

    it('keeps the cards as they are when a live re-read fails', async () => {
      quietly();
      await loaded();
      const [first, second] = cards();

      send('review.posted', 'review-9');
      await coalesce();
      await reads[1]?.fail();

      expect(names()).toEqual(['Atelier Unu', 'Service Doi']);
      expect(cards()[0]).toBe(first);
      expect(cards()[1]).toBe(second);
      expect(page().querySelector('[role="alert"]')).toBeNull();
    });

    it('drops a live re-read answered after the search changed', async () => {
      quietly();
      await loaded();

      send('review.posted', 'review-9');
      await coalesce();
      expect(reads[1]?.params).toEqual({
        brand: 'bmw',
        ids: 'one,two',
        near: NEAR,
      });
      await open('/ro/garages?brand=audi');
      await reads[2]?.answer(
        pageOf({
          counts: { doesNotTake: 0, worksOn: 1 },
          items: [garageOf('three', 'Garaj Trei')],
          total: 1,
        }),
      );
      await reads[1]?.answer(
        pageOf({
          items: [
            { ...garageOf('one', 'Atelier Unu'), reviewCount: 11 },
            garageOf('two', 'Service Doi'),
          ],
        }),
      );

      expect(names()).toEqual(['Garaj Trei']);
      expect(tally()).toContain('1 service găsit');
      expect(chip()).toBeUndefined();
    });

    // @traces 267-FR-019
    it('re-reads only the loaded garages an update or a restoration names, in one read for a burst', async () => {
      await loaded();

      send('garage.updated', 'two');
      send('garage.restored', 'one');
      await coalesce();

      expect(reads).toHaveLength(2);
      expect(reads[1]?.params.ids?.split(',').sort()).toEqual(['one', 'two']);
      expect(reads[1]?.params).not.toHaveProperty('log');
    });

    // @traces 267-FR-019
    it('keeps the order of the list when a re-read gives the cards in another order', async () => {
      await loaded();

      send('garage.updated', 'one');
      await coalesce();
      expect(reads[1]?.params).toEqual({
        brand: 'bmw',
        ids: 'one',
        near: NEAR,
      });
      await reads[1]?.answer(
        pageOf({
          items: [
            garageOf('two', 'Service Doi'),
            { ...garageOf('one', 'Atelier Unu'), rating: 3.1 },
          ],
        }),
      );

      expect(names()).toEqual(['Atelier Unu', 'Service Doi']);
    });

    // @traces 267-FR-019
    it('runs one read at a time: an event during a read makes one more read after it', async () => {
      await loaded();

      send('garage.updated', 'one');
      await coalesce();
      send('garage.updated', 'two');
      await coalesce();
      expect(reads).toHaveLength(2);

      await reads[1]?.answer();
      await settle();

      expect(reads).toHaveLength(3);
      expect(reads[2]?.params).toEqual({
        brand: 'bmw',
        ids: 'two',
        near: NEAR,
      });
    });

    // @traces 1399-FR-004
    // @traces 1399-FR-005
    it('carries the filters on every card re-read with a filter on', async () => {
      await open('/ro/garages?brand=bmw&max_price=200&card=1');
      await reads[0]?.answer();

      send('garage.updated', 'one');
      await coalesce();

      expect(reads[1]?.params).toEqual({
        brand: 'bmw',
        card: '1',
        ids: 'one',
        max_price: 200,
        near: NEAR,
      });
    });

    // @traces 1399-FR-005
    it('fades out a card the filtered re-read leaves out, and takes its filtered total', async () => {
      quietly();
      pinsAnswer = pinsOf(5);
      await open('/ro/garages?brand=bmw&min_rating=4.5');
      await reads[0]?.answer(pageOf({ total: 2 }));
      expect(tally()).toContain('· 2 cu filtrele alese');

      send('garage.updated', 'one');
      await coalesce();
      await reads[1]?.answer(
        pageOf({
          counts: { doesNotTake: 0, worksOn: 1 },
          items: [],
          total: 1,
        }),
      );

      expect(cards()[0]?.classList).toContain('leaving');
      expect(tally()).toContain('· 1 cu filtrele alese');
      await jest.advanceTimersByTimeAsync(300);
      await settle();
      expect(names()).toEqual(['Service Doi']);
    });

    // @traces 1399-FR-005
    it('removes a card the filtered re-read leaves out at once under reduced motion', async () => {
      reduced.set(true);
      quietly();
      await open('/ro/garages?brand=bmw&card=1');
      await reads[0]?.answer(pageOf({ total: 2 }));

      send('garage.updated', 'two');
      await coalesce();
      await reads[1]?.answer(pageOf({ items: [], total: 1 }));

      expect(names()).toEqual(['Atelier Unu']);
    });

    // @traces 1399-FR-005
    it('keeps a card the re-read leaves out with no filter on', async () => {
      await loaded();

      send('garage.updated', 'one');
      await coalesce();
      await reads[1]?.answer(pageOf({ items: [] }));
      await jest.advanceTimersByTimeAsync(300);
      await settle();

      expect(names()).toEqual(['Atelier Unu', 'Service Doi']);
    });

    // @traces 267-FR-021
    it('highlights nothing under reduced motion, and still announces', async () => {
      reduced.set(true);
      const announce = quietly();
      await loaded();

      send('garage.updated', 'one');
      await coalesce();
      await reads[1]?.answer(
        pageOf({
          items: [{ ...garageOf('one', 'Atelier Unu'), reviewCount: 12 }],
        }),
      );

      expect(reviewsOf(0)).toContain('12');
      expect(cards()[0]?.classList).not.toContain('mf-live-changed');
      expect(announce).toHaveBeenCalledWith(
        'Atelier Unu s‑a actualizat',
        'polite',
      );
    });

    // @traces 267-FR-019
    it('fades a suspended card out over 300 ms, then removes it and lowers the counts by one from one re-read', async () => {
      const announce = quietly();
      await loaded();

      send('garage.suspended', 'one');
      await settle();

      expect(cards()[0]?.classList).toContain('leaving');
      expect(names()).toEqual(['Atelier Unu', 'Service Doi']);
      await jest.advanceTimersByTimeAsync(299);
      await settle();
      expect(names()).toHaveLength(2);

      await jest.advanceTimersByTimeAsync(1);
      await settle();

      expect(names()).toEqual(['Service Doi']);
      expect(reads).toHaveLength(2);
      expect(reads[1]?.params).toEqual({ brand: 'bmw', near: NEAR });
      await reads[1]?.answer(
        pageOf({ counts: { doesNotTake: 17, worksOn: 30 }, total: 47 }),
      );
      expect(names()).toEqual(['Service Doi']);
      expect(tally()).toBe(
        '47 de service‑uri găsite · 30 lucrează pe BMW · 17 nu o primesc',
      );
      expect(announce).toHaveBeenCalledWith(
        'Atelier Unu nu mai apare în listă',
        'polite',
      );
    });

    // @traces 267-FR-019
    it('does not lower the counts twice when a re-read already left the suspended garage out', async () => {
      quietly();
      await loaded();

      // Another garage's event re-reads the counts after the suspension was
      // written but before its own event reached the page.
      send('verification.decided', 'verification-1');
      await coalesce();
      await reads[1]?.answer(
        pageOf({ counts: { doesNotTake: 17, worksOn: 30 }, total: 47 }),
      );
      send('garage.suspended', 'one');
      await coalesce();
      await reads[2]?.answer(
        pageOf({ counts: { doesNotTake: 17, worksOn: 30 }, total: 47 }),
      );

      expect(names()).toEqual(['Service Doi']);
      expect(tally()).toBe(
        '47 de service‑uri găsite · 30 lucrează pe BMW · 17 nu o primesc',
      );
    });

    // @traces 267-FR-019
    // @traces 267-FR-020
    it('lowers the counts for a suspended card even when other garages raised the total meanwhile', async () => {
      quietly();
      await loaded();

      send('garage.suspended', 'one');
      await coalesce();
      await jest.advanceTimersByTimeAsync(300);
      await settle();
      // Two garages were approved while the suspension was written: the
      // re-read counts them and leaves the suspended one out.
      await reads[1]?.answer(
        pageOf({ counts: { doesNotTake: 18, worksOn: 31 }, total: 49 }),
      );

      expect(names()).toEqual(['Service Doi']);
      expect(tally()).toBe(
        '49 de service‑uri găsite · 31 lucrează pe BMW · 18 nu o primesc',
      );
      expect(chip()).toBeDefined();
    });

    // @traces 267-FR-019
    it('removes a suspended card at once under reduced motion', async () => {
      reduced.set(true);
      await loaded();

      send('garage.suspended', 'two');
      await settle();

      expect(names()).toEqual(['Atelier Unu']);
    });

    // @traces 267-FR-020
    it.each([
      ['an approval', 'verification.decided', 'verification-1'],
      ['a change to a garage not loaded', 'garage.updated', 'other'],
      ['a restoration of a garage not loaded', 'garage.restored', 'other'],
      ['a suspension of a garage not loaded', 'garage.suspended', 'other'],
    ])(
      're-reads the counts only on %s, and changes them in place when the total fell',
      async (_, kind, id) => {
        await loaded();
        const shown = cards();

        send(kind, id);
        await coalesce();

        expect(reads).toHaveLength(2);
        expect(reads[1]?.params).toEqual({ brand: 'bmw', near: NEAR });
        await reads[1]?.answer(
          pageOf({
            counts: { doesNotTake: 16, worksOn: 31 },
            items: [garageOf('three', 'Alt Service')],
            total: 47,
          }),
        );

        expect(tally()).toBe(
          '47 de service‑uri găsite · 31 lucrează pe BMW · 16 nu o primesc',
        );
        expect(cards()).toEqual(shown);
        expect(chip()).toBeUndefined();
      },
    );

    // @traces 267-FR-020
    it('changes the counts in place when the total holds with another split', async () => {
      await loaded();

      send('garage.updated', 'other');
      await coalesce();
      await reads[1]?.answer(
        pageOf({ counts: { doesNotTake: 18, worksOn: 30 }, total: 48 }),
      );

      expect(tally()).toBe(
        '48 de service‑uri găsite · 30 lucrează pe BMW · 18 nu o primesc',
      );
      expect(chip()).toBeUndefined();
    });

    // @traces 267-FR-020
    it('offers "Reîncarcă" when the total rose, and changes the list only when it is tapped', async () => {
      await loaded();
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigate');

      send('verification.decided', 'verification-1');
      await coalesce();
      await reads[1]?.answer(
        pageOf({
          counts: { doesNotTake: 17, worksOn: 32 },
          items: [garageOf('new', 'Service Nou')],
          total: 49,
        }),
      );

      expect(chip()).toBeDefined();
      expect(names()).toEqual(['Atelier Unu', 'Service Doi']);

      chip()?.click();
      await settle();
      expect(reads).toHaveLength(3);
      expect(reads[2]?.params).toEqual({ brand: 'bmw', near: NEAR });
      await reads[2]?.answer(
        pageOf({
          counts: { doesNotTake: 17, worksOn: 32 },
          items: [
            garageOf('new', 'Service Nou'),
            garageOf('one', 'Atelier Unu'),
          ],
          total: 49,
        }),
      );

      expect(names()).toEqual(['Service Nou', 'Atelier Unu']);
      expect(tally()).toBe(
        '49 de service‑uri găsite · 32 lucrează pe BMW · 17 nu o primesc',
      );
      expect(chip()).toBeUndefined();
      expect(navigate).not.toHaveBeenCalled();
      expect(router.url).toBe(`/ro/garages?brand=bmw&near=${NEAR}`);
    });

    // @traces 267-FR-018
    // @traces 267-FR-019
    // @traces 267-FR-020
    it('re-reads the cards and the counts on each re-open of the stream', async () => {
      await loaded();

      resync.next();
      await settle();
      await reads[1]?.answer();
      await settle();

      expect(reads.slice(1).map((read) => read.params)).toEqual(
        expect.arrayContaining([
          { brand: 'bmw', ids: 'one,two', near: NEAR },
          { brand: 'bmw', near: NEAR },
        ]),
      );
      expect(reads).toHaveLength(3);
    });

    // @traces 267-FR-021
    it('never reloads, changes the route or moves focus on a live update', async () => {
      await open('/ro/garages?brand=bmw&near=46.77,23.59');
      await reads[0]?.answer();
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigate');
      const change = [...page().querySelectorAll('button')].find(
        (b) => said(b) === 'Schimbă locul',
      );
      change?.focus();

      send('garage.updated', 'one');
      send('verification.decided', 'v-1');
      await coalesce();
      for (const read of reads.slice(1)) await read.answer();
      await settle();
      for (const read of reads.slice(1)) await read.answer();
      send('garage.suspended', 'two');
      await jest.advanceTimersByTimeAsync(300);
      await settle();

      expect(reads.length).toBeGreaterThanOrEqual(3);
      expect(names()).toEqual(['Atelier Unu']);
      expect(navigate).not.toHaveBeenCalled();
      expect(router.url).toBe('/ro/garages?brand=bmw&near=46.77,23.59');
      expect(document.activeElement).toBe(change);
      expect(
        reads.every((read) => !('log' in read.params) || read === reads[0]),
      ).toBe(true);
      expect(
        reads.slice(1).every((read) => read.params.near === '46.77,23.59'),
      ).toBe(true);
    });

    // @traces 269-FR-018
    describe('the pins', () => {
      const pinsAsked = () => pinsApi.mock.calls.map(([q]) => q);

      it.each([
        'garage.updated',
        'garage.suspended',
        'garage.restored',
        'verification.decided',
      ])(
        'reads the pins again on %s and draws the new answer',
        async (kind) => {
          quietly();
          await loaded();
          expect(pinsAsked()).toHaveLength(1);
          pinsAnswer = pinsOf(47);

          send(kind, 'pin-3');
          await coalesce();

          expect(pinsAsked()).toEqual([
            { brand: 'bmw', near: NEAR },
            { brand: 'bmw', near: NEAR },
          ]);
          expect(mapView.show).toHaveBeenLastCalledWith(pinsOf(47));
        },
      );

      it('leaves the map where the driver has it on a re-read', async () => {
        quietly();
        await loaded();
        const fits = mapView.fit.mock.calls.length;
        pinsAnswer = pinsOf(47);

        send('garage.suspended', 'pin-3');
        await coalesce();

        expect(mapView.show).toHaveBeenLastCalledWith(pinsOf(47));
        expect(mapView.fit).toHaveBeenCalledTimes(fits);
      });

      it('reads the pins once for a burst of events', async () => {
        quietly();
        await loaded();

        send('garage.updated', 'one');
        send('garage.suspended', 'pin-7');
        send('garage.restored', 'pin-8');
        send('verification.decided', 'pin-9');
        await coalesce();
        await reads[1]?.answer();
        await reads[2]?.answer();
        await settle();

        expect(pinsAsked()).toHaveLength(2);
      });

      it('reads no pins on a review event', async () => {
        await loaded();

        send('review.posted', 'review-9');
        await coalesce();

        expect(pinsAsked()).toHaveLength(1);
      });

      it('reads the pins of the box the map shows', async () => {
        keep(PLACE);
        await loaded();
        mapMoved({ bbox: '44.4,26,44.5,26.2' });
        await settle();
        await reads[1]?.answer();

        send('garage.updated', 'pin-3');
        await coalesce();

        expect(pinsAsked().at(-1)).toEqual({
          bbox: '44.4,26,44.5,26.2',
          brand: 'bmw',
          near: '44.447,26.117',
        });
      });

      it('keeps the pins shown when the re-read fails', async () => {
        await loaded();
        pinsApi.mockImplementationOnce(() =>
          Promise.reject(new HttpErrorResponse({ status: 500 })),
        );

        send('garage.suspended', 'pin-3');
        await coalesce();

        expect(pinsAsked()).toHaveLength(2);
        expect(mapView.show).toHaveBeenLastCalledWith(pinsOf(48));
        expect(page().querySelector('[role="alert"]')).toBeNull();
      });

      it('reads the pins again on each re-open of the stream', async () => {
        await loaded();

        resync.next();
        await settle();

        expect(pinsAsked()).toHaveLength(2);
      });
    });
  });

  describe('the map beside the list', () => {
    beforeEach(() => configure());

    // @traces 269-FR-001
    it('asks for the pins of the same search, with no log and no ids', async () => {
      keep(PLACE);
      await open('/ro/garages?brand=bmw&radius=50');

      expect(pinsApi.mock.calls.map(([q]) => q)).toEqual([
        { brand: 'bmw', near: '44.447,26.117', radius: 50 },
      ]);
    });

    // @traces 269-FR-016
    it('shows the map region next to the list', async () => {
      await open('/ro/garages?brand=bmw');

      expect(
        page()
          .querySelector('mf-results-map section.map')
          ?.getAttribute('aria-label'),
      ).toBe('Harta service‑urilor');
      expect(openMap).toHaveBeenCalledTimes(1);
    });

    // @traces 269-FR-002
    it('draws every pin of the search while the list shows its first page', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer(
        pageOf({
          items: Array.from({ length: 20 }, (_, i) =>
            garageOf(`g-${i}`, `Service ${i}`),
          ),
        }),
      );

      expect(page().querySelectorAll('mf-result-card')).toHaveLength(20);
      expect(mapView.show).toHaveBeenLastCalledWith(pinsOf(48));
      expect(mapView.show.mock.lastCall?.[0]?.pins).toHaveLength(48);
    });

    // @traces 269-FR-005
    it('fits the map to the place and the pins once they come', async () => {
      keep(PLACE);
      await open('/ro/garages?brand=bmw');

      // The page renders as a phone here: no legend or sheet cover in jsdom.
      expect(mapView.fit).toHaveBeenCalledWith(
        { lat: PLACE.lat, lng: PLACE.lng },
        pinsOf(48),
        0,
        0,
      );
    });

    // @traces 269-FR-001
    it('asks for the pins again when the search changes, and not on a live re-read', async () => {
      keep(PLACE);
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer(pageOf({ items: [], total: 0 }));
      const wider = page().querySelector<HTMLButtonElement>('.state .primary');
      expect(said(wider)).toBe('Caută în 50 km');
      wider?.click();
      await settle();
      await settle();

      expect(pinsApi.mock.calls.map(([q]) => q.radius)).toEqual([
        undefined,
        50,
      ]);
    });
  });

  // @traces 269-FR-017
  describe('the map when something fails', () => {
    beforeEach(() => configure());

    const grey = () => page().querySelector('mf-results-map .placeholder');
    const status = () => page().querySelector('mf-results-map [role="status"]');
    const failPins = () =>
      pinsApi.mockImplementationOnce(() =>
        Promise.reject(new HttpErrorResponse({ status: 500 })),
      );

    it('shows a grey map while the search runs, even once the pins have come', async () => {
      await open('/ro/garages?brand=bmw');

      expect(pinsApi).toHaveBeenCalledTimes(1);
      expect(grey()).not.toBeNull();

      await reads[0]?.answer();

      expect(grey()).toBeNull();
    });

    it('leaves the map without pins and says nothing over the list when the pins request fails', async () => {
      failPins();
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();

      expect(page().querySelectorAll('mf-result-card')).toHaveLength(2);
      expect(page().querySelector('[role="alert"]')).toBeNull();
      expect(said(status())).toBe('');
      expect(grey()).toBeNull();
      expect(mapView.show).toHaveBeenLastCalledWith(undefined);
    });

    it('keeps the skeletons while the search runs with the pins failed', async () => {
      failPins();
      await open('/ro/garages?brand=bmw');

      expect(page().querySelectorAll('.cards .skeleton')).toHaveLength(6);
      expect(page().querySelector('[role="alert"]')).toBeNull();
    });

    it('keeps the empty state as it is with the pins failed', async () => {
      failPins();
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer(
        pageOf({ counts: { doesNotTake: 0, worksOn: 0 }, items: [], total: 0 }),
      );

      expect(said(page().querySelector('.state h2'))).toBe(
        'Niciun service în 25 km',
      );
    });

    it('shows the list failure once, with "Reîncearcă", when both fail', async () => {
      failPins();
      await open('/ro/garages?brand=bmw');
      await reads[0]?.fail();

      expect(page().querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(said(page().querySelector('.state[role="alert"] h1'))).toBe(
        'Nu am putut încărca rezultatele',
      );
      expect(said(status())).toBe('');
    });

    it('asks for the pins again on "Reîncearcă" after both failed', async () => {
      failPins();
      await open('/ro/garages?brand=bmw');
      await reads[0]?.fail();
      const before = pinsApi.mock.calls.length;

      const again = [
        ...page().querySelectorAll<HTMLButtonElement>('.state button'),
      ].find((b) => said(b) === 'Reîncearcă');
      expect(again).toBeDefined();
      again?.click();
      await settle();

      expect(pinsApi.mock.calls.length).toBe(before + 1);
    });
  });

  // @traces 269-FR-006
  // @traces 269-FR-007
  // @traces 269-FR-008
  // @traces 269-FR-009
  describe('the visible area of the map', () => {
    const BOX = '44.4,26,44.5,26.2';
    const OTHER = '44.41,26,44.5,26.2';
    const NEAR = '44.447,26.117';

    beforeEach(() => configure());

    async function searched(url = '/ro/garages?brand=bmw') {
      keep(PLACE);
      await open(url);
      await reads[0]?.answer();
    }
    async function settleOn(bbox: string) {
      mapMoved({ bbox });
      await settle();
    }
    const pinsAsked = () => pinsApi.mock.calls.map(([q]) => q);
    const back = () =>
      page().querySelector<HTMLButtonElement>('.summary .back');
    const hint = () => page().querySelector('mf-results-map [role="status"]');

    it('loads the list and the pins of the box the map settled on, without logging', async () => {
      await searched();

      await settleOn(BOX);

      expect(searches().at(-1)).toEqual({
        bbox: BOX,
        brand: 'bmw',
        near: NEAR,
      });
      expect(pinsAsked().at(-1)).toEqual({
        bbox: BOX,
        brand: 'bmw',
        near: NEAR,
      });
    });

    it('asks nothing for the box it has loaded', async () => {
      await searched();
      await settleOn(BOX);
      await reads[1]?.answer();

      await settleOn(BOX);

      expect(searches()).toHaveLength(2);
      expect(pinsAsked()).toHaveLength(2);
    });

    it('shows the newer box when an older answer comes after it', async () => {
      await searched();
      await settleOn(BOX);
      await settleOn(OTHER);

      await reads[2]?.answer(pageOf({ total: 23 }));
      await reads[1]?.answer(pageOf({ total: 5 }));

      expect(said(page().querySelector('.summary .tally'))).toMatch(/^23 /);
    });

    it('sums up the map area with the Romanian plural rules and offers "Înapoi la 25 km"', async () => {
      await searched();
      await settleOn(BOX);
      await reads[1]?.answer(pageOf({ total: 23 }));

      expect(said(page().querySelector('.summary .tally'))).toBe(
        '23 de service‑uri în zona hărții · 31 lucrează pe BMW · 17 nu o primesc',
      );
      expect(page().querySelector('.summary .area')).toBeNull();
      expect(said(back())).toBe('Înapoi la 25 km');

      await settleOn(OTHER);
      await reads[2]?.answer(
        pageOf({ counts: { doesNotTake: 1, worksOn: 2 }, total: 3 }),
      );
      expect(said(page().querySelector('.summary .tally'))).toMatch(
        /^3 service‑uri în zona hărții · /,
      );

      await settleOn(BOX);
      await reads[3]?.answer(
        pageOf({ counts: { doesNotTake: 0, worksOn: 1 }, total: 1 }),
      );
      expect(said(page().querySelector('.summary .tally'))).toMatch(
        /^1 service în zona hărții · /,
      );
    });

    it('speaks English in the map area', async () => {
      keep(PLACE);
      await open('/en/garages?brand=bmw', { language: 'en' });
      await reads[0]?.answer();
      await settleOn(BOX);
      await reads[1]?.answer(pageOf({ total: 23 }));

      expect(said(page().querySelector('.summary .tally'))).toMatch(
        /^23 garages in the map area · /,
      );
      expect(said(back())).toBe('Back to 25 km');
    });

    it('offers "Înapoi la 50 km" after a widened search', async () => {
      await searched(`/ro/garages?brand=bmw&near=${NEAR}&radius=50`);
      await settleOn(BOX);
      await reads[1]?.answer();

      expect(said(back())).toBe('Înapoi la 50 km');
    });

    it('offers "Înapoi la 25 km" from the place in the bar, with no place kept', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();
      await settleOn(BOX);
      await reads[1]?.answer();

      expect(searches().at(-1)).toEqual({
        bbox: BOX,
        brand: 'bmw',
        near: '44.437,26.117',
      });
      expect(said(back())).toBe('Înapoi la 25 km');
    });

    it('restores the first search on "Înapoi la 25 km", unlogged, and fits the map to it', async () => {
      await searched();
      await settleOn(BOX);
      await reads[1]?.answer(pageOf({ total: 23 }));
      mapView.fit.mockClear();

      back()?.click();
      await settle();
      await reads[2]?.answer();
      await settle();

      expect(searches().at(-1)).toEqual({ brand: 'bmw', near: NEAR });
      expect(pinsAsked().at(-1)).toEqual({ brand: 'bmw', near: NEAR });
      // The page renders as a phone here: no legend or sheet cover in jsdom.
      expect(mapView.fit).toHaveBeenCalledWith(
        { lat: PLACE.lat, lng: PLACE.lng },
        pinsOf(48),
        0,
        0,
      );
      expect(back()).toBeNull();
      expect(said(page().querySelector('.summary .tally'))).toMatch(
        /^48 de service‑uri găsite/,
      );
    });

    it('never moves the map to the pins of a box', async () => {
      await searched();
      mapView.fit.mockClear();

      await settleOn(BOX);
      await reads[1]?.answer();
      await settle();

      expect(mapView.fit).not.toHaveBeenCalled();
    });

    it('keeps the pins on the map while a box loads', async () => {
      await searched();
      pinsApi.mockImplementationOnce(() => new Promise(() => undefined));

      await settleOn(BOX);

      expect(mapView.show).toHaveBeenLastCalledWith(pinsOf(48));
      expect(page().querySelector('mf-results-map .placeholder')).toBeNull();
    });

    it('says "Apropie harta" while the box is too wide, and asks nothing', async () => {
      await searched();

      mapMoved({ tooWide: true });
      await settle();

      expect(said(hint())).toBe('Apropie harta');
      expect(searches()).toHaveLength(1);
      expect(pinsAsked()).toHaveLength(1);
    });

    it('shows the failure with "Reîncearcă" when a box cannot load, and asks for the same box again', async () => {
      await searched();
      await settleOn(BOX);
      await reads[1]?.fail();

      expect(said(page().querySelector('.state[role="alert"] h1'))).toBe(
        'Nu am putut încărca rezultatele',
      );

      await settleOn(BOX);

      expect(searches()).toHaveLength(3);
      expect(searches().at(-1)).toEqual({
        bbox: BOX,
        brand: 'bmw',
        near: NEAR,
      });
    });

    it('leaves the address bar as it was', async () => {
      await searched();
      const router = TestBed.inject(Router);
      const before = router.url;

      await settleOn(BOX);
      await reads[1]?.answer();

      expect(router.url).toBe(before);
    });

    it('forgets the box when the bar names another brand', async () => {
      await searched();
      await settleOn(BOX);
      await reads[1]?.answer();

      await open(`/ro/garages?brand=audi&near=${NEAR}`);

      expect(searches().at(-1)).toEqual({
        brand: 'audi',
        log: '1',
        near: NEAR,
      });
    });
  });

  // @traces 270-FR-001 270-FR-002 270-FR-003 270-FR-004 270-FR-005 270-FR-006 270-FR-009 270-FR-010 270-FR-013
  describe('a card and its pin', () => {
    let scroll: jest.Mock;

    beforeEach(async () => {
      await configure();
      jest.useFakeTimers();
      scroll = jest.fn();
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: scroll,
      });
    });

    const send = (kind: string, id = 'x-1') =>
      messages.next({ at: '2026-10-17T12:00:00.000Z', id, kind });
    const coalesce = async () => {
      await jest.advanceTimersByTimeAsync(300);
      await settle();
    };
    const hosts = () => [...page().querySelectorAll('mf-result-card')];
    const host = (name: string) =>
      hosts().find((card) => said(card.querySelector('h2')) === name) as
        | HTMLElement
        | undefined;
    const amber = () =>
      hosts()
        .filter((card) => card.querySelector('article.card.selected'))
        .map((card) => said(card.querySelector('h2')));
    const lit = () => mapView.light.mock.calls.at(-1)?.[0];
    const small = () => page().querySelector('mf-map-card');
    const pointer = (type: string, pointerType = 'mouse') => {
      const event = new Event(type);
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      return event;
    };
    async function tap(name: string) {
      host(name)?.querySelector('h2')?.click();
      await settle();
    }
    async function point(name: string, type: string, pointerType = 'mouse') {
      host(name)?.dispatchEvent(pointer(type, pointerType));
      await settle();
    }
    async function picked(id: string | undefined) {
      mapPicked(id);
      await settle();
    }
    async function loaded(url = '/ro/garages?brand=bmw', answer = pageOf()) {
      await open(url);
      await reads[0]?.answer(answer);
    }

    // @traces 270-FR-001 270-FR-005
    it('selects the first card of the list and lights its pin, in the page only', async () => {
      const stored = localStorage.length;
      await loaded();

      expect(amber()).toEqual(['Atelier Unu']);
      expect(lit()).toBe('one');
      expect(scroll).not.toHaveBeenCalled();

      await tap('Service Doi');
      await point('Atelier Unu', 'pointerenter');

      expect(TestBed.inject(Router).url).toBe(
        `/ro/garages?brand=bmw&near=${NEAR}`,
      );
      expect(localStorage.length).toBe(stored);
      expect(searches()).toHaveLength(1);
      expect(pinsApi).toHaveBeenCalledTimes(1);
    });

    // @traces 270-FR-001 270-FR-003
    it('selects the card tapped, one at a time', async () => {
      await loaded();

      await tap('Service Doi');

      expect(amber()).toEqual(['Service Doi']);
      expect(lit()).toBe('two');

      await tap('Atelier Unu');

      expect(amber()).toEqual(['Atelier Unu']);
      expect(lit()).toBe('one');
    });

    // @traces 270-FR-001 270-FR-002
    it('lights the pointed card over the selected one, and the selected one again on leave', async () => {
      await loaded();

      await point('Service Doi', 'pointerenter');

      expect(lit()).toBe('two');
      expect(amber()).toEqual(['Atelier Unu']);

      await point('Service Doi', 'pointerleave');

      expect(lit()).toBe('one');
    });

    // @traces 270-FR-002
    it('lights nothing for a touch resting on a card', async () => {
      await loaded();
      mapView.light.mockClear();

      await point('Service Doi', 'pointerenter', 'touch');

      expect(mapView.light).not.toHaveBeenCalled();
    });

    // @traces 270-FR-002
    it('lights the pin of the card holding the keyboard focus, and the selected one once focus leaves', async () => {
      await loaded();
      const link = host('Service Doi')?.querySelector('a');

      link?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await settle();

      expect(lit()).toBe('two');
      expect(amber()).toEqual(['Atelier Unu']);

      link?.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
      );
      await settle();

      expect(lit()).toBe('one');
    });

    // @traces 270-FR-001
    it('keeps a pointed card lit while another is selected', async () => {
      await loaded();

      await point('Service Doi', 'pointerenter');
      await tap('Atelier Unu');

      expect(lit()).toBe('two');
      expect(amber()).toEqual(['Atelier Unu']);
    });

    // @traces 270-FR-004
    it('selects the garage of a tapped pin and scrolls its card into view smoothly, focus unmoved', async () => {
      await loaded();
      const focused = document.activeElement;
      const fits = mapView.fit.mock.calls.length;

      await picked('two');

      expect(amber()).toEqual(['Service Doi']);
      expect(lit()).toBe('two');
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      });
      expect(scroll.mock.contexts[0]).toBe(host('Service Doi'));
      expect(document.activeElement).toBe(focused);
      expect(mapView.fit).toHaveBeenCalledTimes(fits);
      expect(small()).toBeNull();
      expect(searches()).toHaveLength(1);
    });

    // @traces 270-FR-004
    it('scrolls at once under reduced motion', async () => {
      reduced.set(true);
      await loaded();

      await picked('two');

      expect(scroll).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'nearest',
      });
    });

    // @traces 270-FR-004
    it('never moves the map when a card is selected', async () => {
      await loaded();
      const fits = mapView.fit.mock.calls.length;
      const shows = mapView.show.mock.calls.length;

      await tap('Service Doi');
      await point('Atelier Unu', 'pointerenter');

      expect(mapView.fit).toHaveBeenCalledTimes(fits);
      expect(mapView.show).toHaveBeenCalledTimes(shows);
    });

    // @traces 270-FR-004 270-FR-010
    it('selects nothing for a tap away from any pin', async () => {
      await loaded();

      await picked(undefined);

      expect(amber()).toEqual(['Atelier Unu']);
      expect(lit()).toBe('one');
    });

    // @traces 270-FR-010
    it('opens the small card for a pin whose garage is not listed, and fills it from one ids= read with the brand', async () => {
      await loaded();

      await picked('pin-3');

      expect(lit()).toBe('pin-3');
      expect(amber()).toEqual([]);
      expect(small()).not.toBeNull();
      expect(small()?.querySelector('mf-lamp')).not.toBeNull();
      expect(reads[1]?.params).toEqual({
        brand: 'bmw',
        ids: 'pin-3',
        near: NEAR,
      });

      await reads[1]?.answer(
        pageOf({ items: [garageOf('pin-3', 'Service Trei')] }),
      );

      expect(said(small())).toContain('Service Trei');
      expect(small()?.querySelector('a')?.getAttribute('href')).toBe(
        '/ro/garages/pin-3?brand=bmw',
      );
      expect(searches()).toHaveLength(2);
      expect(amber()).toEqual([]);
    });

    // @traces 270-FR-010
    it.each([
      ['fails', (read: Read) => read.fail()],
      [
        'answers no garage',
        (read: Read) => read.answer(pageOf({ items: [], total: 0 })),
      ],
    ])(
      'closes the small card when its read %s, and nothing else happens',
      async (_, end) => {
        await loaded();
        await picked('pin-3');

        await end(reads[1] as Read);

        expect(small()).toBeNull();
        expect(lit()).toBe('pin-3');
        expect(page().querySelector('[role="alert"]')).toBeNull();
        expect(hosts()).toHaveLength(2);
      },
    );

    // @traces 270-FR-010
    it('keeps the filled small card and reads nothing more when its pin is tapped again', async () => {
      await loaded();
      await picked('pin-3');
      await reads[1]?.answer(
        pageOf({ items: [garageOf('pin-3', 'Service Trei')] }),
      );

      await picked('pin-3');

      expect(said(small())).toContain('Service Trei');
      expect(searches()).toHaveLength(2);
    });

    // @traces 270-FR-010
    it('drops a read answered after another pin was tapped', async () => {
      await loaded();
      await picked('pin-3');
      await picked('pin-4');

      await reads[1]?.answer(
        pageOf({ items: [garageOf('pin-3', 'Service Trei')] }),
      );

      expect(small()).not.toBeNull();
      expect(said(small())).not.toContain('Service Trei');
      expect(reads[2]?.params).toEqual({
        brand: 'bmw',
        ids: 'pin-4',
        near: NEAR,
      });
    });

    // @traces 270-FR-005 270-FR-010
    it('drops a read answered after the search changed', async () => {
      await loaded();
      await picked('pin-3');

      await open('/ro/garages?brand=audi');
      await reads[1]?.answer(
        pageOf({ items: [garageOf('pin-3', 'Service Trei')] }),
      );

      expect(small()).toBeNull();

      await reads[2]?.answer();

      expect(small()).toBeNull();
      expect(amber()).toEqual(['Atelier Unu']);
    });

    // @traces 270-FR-010
    it.each([
      ['a card is tapped', () => tap('Service Doi')],
      ['the map is tapped away from any pin', () => picked(undefined)],
      ['a listed pin is tapped', () => picked('two')],
    ])('closes the small card when %s', async (_, close) => {
      await loaded();
      await picked('pin-3');
      await reads[1]?.answer(
        pageOf({ items: [garageOf('pin-3', 'Service Trei')] }),
      );

      await close();

      expect(small()).toBeNull();
    });

    // @traces 270-FR-005
    it('selects the first card of a list for another brand, clears the pointed one and scrolls nothing', async () => {
      await loaded();
      await tap('Service Doi');
      await point('Service Doi', 'pointerenter');

      await open('/ro/garages?brand=audi');
      await reads[1]?.answer(
        pageOf({
          items: [
            garageOf('three', 'Alt Service'),
            garageOf('two', 'Service Doi'),
          ],
        }),
      );

      expect(amber()).toEqual(['Alt Service']);
      expect(lit()).toBe('three');
      expect(scroll).not.toHaveBeenCalled();
    });

    // @traces 270-FR-005
    it('selects the first card of a visible-area load, and of the search again on "Înapoi la 25 km"', async () => {
      keep(PLACE);
      await loaded('/ro/garages?brand=bmw');

      mapMoved({ bbox: '44.4,26,44.5,26.2' });
      await settle();
      await reads[1]?.answer(
        pageOf({
          items: [
            garageOf('three', 'Alt Service'),
            garageOf('one', 'Atelier Unu'),
          ],
        }),
      );

      expect(amber()).toEqual(['Alt Service']);

      await tap('Atelier Unu');
      page().querySelector<HTMLButtonElement>('.summary .back')?.click();
      await settle();
      await reads[2]?.answer();

      expect(amber()).toEqual(['Atelier Unu']);
      expect(lit()).toBe('one');
    });

    // @traces 270-FR-005
    it('selects the first card of the list "Reîncarcă" brings, and clears the pointed one', async () => {
      await loaded();
      await tap('Service Doi');
      await point('Service Doi', 'pointerenter');

      send('verification.decided', 'verification-1');
      await coalesce();
      await reads[1]?.answer(pageOf({ total: 49 }));
      [...page().querySelectorAll('button')]
        .find((b) => said(b) === 'Reîncarcă')
        ?.click();
      await settle();
      await reads[2]?.answer(
        pageOf({
          items: [
            garageOf('new', 'Service Nou'),
            garageOf('two', 'Service Doi'),
          ],
          total: 49,
        }),
      );

      expect(amber()).toEqual(['Service Nou']);
      expect(lit()).toBe('new');
      expect(scroll).not.toHaveBeenCalled();
    });

    // @traces 270-FR-005
    it('selects nothing in an empty list', async () => {
      await loaded(
        '/ro/garages?brand=bmw',
        pageOf({ counts: { doesNotTake: 0, worksOn: 0 }, items: [], total: 0 }),
      );

      expect(mapView.light).toHaveBeenLastCalledWith(undefined);
    });

    // @traces 270-FR-005
    it('keeps the selection through an in-place card change and a pins re-read', async () => {
      await loaded();
      await tap('Service Doi');

      send('garage.updated', 'two');
      await coalesce();
      await reads[1]?.answer(
        pageOf({
          items: [{ ...garageOf('two', 'Service Doi'), reviewCount: 30 }],
        }),
      );
      resync.next();
      await settle();
      await reads[2]?.answer();
      await reads[3]?.answer();

      expect(amber()).toEqual(['Service Doi']);
      expect(lit()).toBe('two');
      expect(pinsApi.mock.calls.length).toBeGreaterThan(1);
    });

    // @traces 270-FR-006
    it('passes the selection to the first card left when the selected card fades out', async () => {
      await loaded();

      send('garage.suspended', 'one');
      await jest.advanceTimersByTimeAsync(300);
      await settle();

      expect(amber()).toEqual(['Service Doi']);
      expect(lit()).toBe('two');
    });

    // @traces 270-FR-006
    it('selects nothing once the last card has faded out', async () => {
      await loaded(
        '/ro/garages?brand=bmw',
        pageOf({ items: [garageOf('one', 'Atelier Unu')] }),
      );

      send('garage.suspended', 'one');
      await jest.advanceTimersByTimeAsync(300);
      await settle();

      expect(mapView.light).toHaveBeenLastCalledWith(undefined);
    });

    // @traces 270-FR-006
    it('stops pointing at a card that fades out', async () => {
      await loaded();
      await point('Service Doi', 'pointerenter');

      send('garage.suspended', 'two');
      await jest.advanceTimersByTimeAsync(300);
      await settle();

      expect(lit()).toBe('one');
      expect(amber()).toEqual(['Atelier Unu']);
    });

    // @traces 270-FR-009
    it('selects and points the cards as ever when the pins request failed, and says nothing', async () => {
      pinsApi.mockImplementationOnce(() =>
        Promise.reject(new HttpErrorResponse({ status: 500 })),
      );
      await loaded();

      await tap('Service Doi');
      await point('Atelier Unu', 'pointerenter');

      expect(amber()).toEqual(['Service Doi']);
      expect(lit()).toBe('one');
      expect(page().querySelector('[role="alert"]')).toBeNull();
    });

    // @traces 270-FR-009
    it('selects the cards as ever when the map could not open', async () => {
      openMap.mockImplementationOnce(() => Promise.reject(new Error('style')));
      await loaded();

      await tap('Service Doi');

      expect(amber()).toEqual(['Service Doi']);
      expect(small()).toBeNull();
      expect(page().querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('on the server', () => {
    beforeEach(() => configure('server'));

    // @traces 267-FR-016
    it('renders six skeleton cards and never searches', async () => {
      await open('/ro/garages?brand=bmw');

      expect(searches()).toEqual([]);
      expect(pinsApi).not.toHaveBeenCalled();
      expect(page().querySelectorAll('.card.skeleton')).toHaveLength(6);
    });
  });

  // @traces 267-FR-012
  // @traces 267-FR-015
  it('is served at /:lang/garages inside the public frame, in place of the placeholder', async () => {
    const lang = routes.find((route) => route.path === ':lang') as Route;
    const garages = lang.children?.find((route) => route.path === 'garages');

    expect(garages?.component).toBeUndefined();
    expect(await garages?.loadComponent?.()).toBe(Results);
    expect(await lang.loadComponent?.()).toBe(PublicFrame);
  });
});

// The browser's location, answered when the test says so.
type Ask = {
  options: PositionOptions | undefined;
  found: (lat: number, lng: number) => Promise<void>;
  refuse: () => Promise<void>;
};
let asks: Ask[];
const geolocation = {
  getCurrentPosition: jest.fn(
    (
      ok: PositionCallback,
      fail?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) => {
      asks.push({
        found: async (latitude, longitude) => {
          ok({ coords: { latitude, longitude } } as GeolocationPosition);
          await settle();
          await settle();
        },
        options,
        refuse: async () => {
          fail?.({ code: 1 } as GeolocationPositionError);
          await settle();
        },
      });
    },
  ),
};
const CLUJ = { lat: 46.7712, lng: 23.6236 };

// @traces 271-FR-001
// @traces 271-FR-018
// @traces 271-FR-003
// @traces 271-FR-006
// @traces 271-FR-007
describe('Results measured from where the driver is', () => {
  beforeEach(async () => {
    asks = [];
    geolocation.getCurrentPosition.mockClear();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocation,
    });
    await configure();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'geolocation');
  });

  const status = () => said(page().querySelector('.locating[role="status"]'));

  it('asks the location once, within 10 s, with no place in the bar and none kept', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(asks[0]?.options).toEqual(
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it('says "Se caută locația…" politely and searches nothing while the request is open, showing the loading state', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });

    expect(status()).toBe('Se caută locația…');
    expect(searches()).toEqual([]);
    expect(pinsApi).not.toHaveBeenCalled();
    expect(page().querySelectorAll('.card.skeleton')).toHaveLength(6);
    expect(page().querySelector('mf-result-card')).toBeNull();
  });

  it('says "Finding your location…" in English', async () => {
    await open('/en/garages?brand=bmw', { language: 'en', placed: false });

    expect(status()).toBe('Finding your location…');
  });

  it('takes a box in the bar for no place, and asks', async () => {
    await open('/ro/garages?brand=bmw&bbox=26.0,44.4,26.2,44.5', {
      placed: false,
    });

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(searches()).toEqual([]);
  });

  it('keeps a location inside Romania as the place, writes it into the bar and runs one logged search from it', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    await asks[0]?.found(CLUJ.lat, CLUJ.lng);

    expect(JSON.parse(localStorage.getItem('mf-place') ?? 'null')).toEqual({
      label: null,
      lat: 46.771,
      lng: 23.624,
      origin: 'location',
    });
    expect(TestBed.inject(PlaceStore).place()).toEqual({
      label: null,
      lat: 46.771,
      lng: 23.624,
      origin: 'location',
    });
    expect(TestBed.inject(Router).url).toBe(
      '/ro/garages?brand=bmw&near=46.771,23.624',
    );
    expect(searches()).toEqual([
      { brand: 'bmw', log: '1', near: '46.771,23.624' },
    ]);
    expect(status()).toBeFalsy();
  });

  it('measures the cards from the place found and names it as the driver', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    await asks[0]?.found(CLUJ.lat, CLUJ.lng);
    await reads[0]?.answer(
      pageOf({
        items: [{ ...garageOf('one', 'Service Mărăști'), distanceKm: 1 }],
        total: 1,
      }),
    );

    expect(said(page().querySelector('mf-result-card'))).toContain('1,0 km');
    expect(said(page().querySelector('.summary .area'))).toBe(
      'în 25 km de tine',
    );
    expect(searches()).toHaveLength(1);
  });

  it('runs one new logged search from the place chosen after the location', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    await asks[0]?.found(CLUJ.lat, CLUJ.lng);
    await reads[0]?.answer();

    const change = [...page().querySelectorAll('button')].find(
      (b) => said(b) === 'Schimbă locul',
    );
    change?.click();
    await settle();
    dialog(PLACE);
    await settle();
    await settle();

    expect(searches()).toEqual([
      { brand: 'bmw', log: '1', near: '46.771,23.624' },
      { brand: 'bmw', log: '1', near: '44.447,26.117' },
    ]);
  });

  it('asks nothing and searches at once with a place in the bar', async () => {
    await open('/ro/garages?brand=bmw&near=44.437,26.117');

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(searches()).toEqual([
      { brand: 'bmw', log: '1', near: '44.437,26.117' },
    ]);
    expect(status()).toBeFalsy();
  });

  it('asks nothing and searches at once with a kept place', async () => {
    keep(PLACE);
    await open('/ro/garages?brand=bmw', { placed: false });

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(searches()).toEqual([
      { brand: 'bmw', log: '1', near: '44.447,26.117' },
    ]);
  });

  it('asks nothing without a brand', async () => {
    await open('/ro/garages');

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('drops a location that answers after a place was chosen another way', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    TestBed.inject(PlaceStore).set(PLACE);
    await settle();
    await asks[0]?.found(CLUJ.lat, CLUJ.lng);

    expect(TestBed.inject(PlaceStore).place()).toEqual({
      ...PLACE,
      lat: 44.447,
      lng: 26.117,
    });
    expect(TestBed.inject(Router).url).toBe(
      '/ro/garages?brand=bmw&near=44.447,26.117',
    );
    expect(searches()).toEqual([
      { brand: 'bmw', log: '1', near: '44.447,26.117' },
    ]);
  });

  it('ends the wait without searching when the location is refused', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    await asks[0]?.refuse();

    expect(status()).toBeFalsy();
    expect(searches()).toEqual([]);
    expect(pinsApi).not.toHaveBeenCalled();
    expect(page().querySelector('.card.skeleton')).toBeNull();
  });

  it('takes a location outside Romania for no place, and searches nothing', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    await asks[0]?.found(48.8566, 2.3522);

    expect(localStorage.getItem('mf-place')).toBeNull();
    expect(status()).toBeFalsy();
    expect(searches()).toEqual([]);
  });

  it('ends the wait without searching in a browser with no geolocation', async () => {
    Reflect.deleteProperty(navigator, 'geolocation');
    await open('/ro/garages?brand=bmw', { placed: false });

    expect(status()).toBeFalsy();
    expect(searches()).toEqual([]);
  });
});

// @traces 271-FR-002
// @traces 271-FR-003
describe('Results waiting for an address the driver types', () => {
  beforeEach(async () => {
    asks = [];
    geolocation.getCurrentPosition.mockClear();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocation,
    });
    await configure();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'geolocation');
  });

  const field = () =>
    page().querySelector<HTMLInputElement>(
      'mf-address-field input[role="combobox"]',
    );
  const label = () => {
    const input = field();
    return input ? said(page().querySelector(`label[for="${input.id}"]`)) : '';
  };
  const options = () => [
    ...page().querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ];
  // The field stands before the map in the page, so above it.
  const aboveMap = () => {
    const input = field();
    const map = page().querySelector('mf-results-map');
    return Boolean(
      input &&
        map &&
        input.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  };
  const nothingShown = () => {
    expect(searches()).toEqual([]);
    expect(pinsApi).not.toHaveBeenCalled();
    expect(page().querySelector('mf-result-card')).toBeNull();
    expect(page().querySelector('.card.skeleton')).toBeNull();
  };
  const shown = () => {
    expect(label()).toBe('Introdu o adresă');
    expect(document.activeElement).toBe(field());
    expect(aboveMap()).toBe(true);
    expect(
      page().querySelector('.locating[role="status"]')?.textContent?.trim(),
    ).toBeFalsy();
    nothingShown();
  };

  it('shows the field, focused above the map, on a refusal, and searches nothing', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    await asks[0]?.refuse();
    await settle();

    shown();
    expect(said(page().querySelector('.placeless'))).toBe(
      'Nu am putut afla locația.',
    );
  });

  it('heads the page with where to look, the line under it, and shows no legend for pins that are not there', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    await asks[0]?.refuse();
    await settle();

    expect(page().querySelectorAll('h1')).toHaveLength(1);
    expect(said(page().querySelector('h1'))).toBe('Unde cauți service?');
    expect(page().querySelector('h1.placeless')).toBeNull();
    expect(page().querySelector('h1 + p.placeless')).not.toBeNull();
    expect(page().querySelector('mf-results-map section.map')).not.toBeNull();
    expect(page().querySelector('mf-results-map .legend')).toBeNull();
  });

  it('shows it on a browser error', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    const [ok, fail] = geolocation.getCurrentPosition.mock.calls[0] ?? [];
    expect(ok).toBeDefined();
    fail?.({ code: 2 } as GeolocationPositionError);
    await settle();
    await settle();

    shown();
  });

  it('shows it in a browser with no geolocation', async () => {
    Reflect.deleteProperty(navigator, 'geolocation');
    await open('/ro/garages?brand=bmw', { placed: false });
    await settle();

    shown();
  });

  it('shows it for a location outside Romania', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    await asks[0]?.found(48.8566, 2.3522);
    await settle();

    shown();
  });

  it('shows it after 10 s of silence, and not before', async () => {
    jest.useFakeTimers();
    await open('/ro/garages?brand=bmw', { placed: false });

    await jest.advanceTimersByTimeAsync(9_999);
    await settle();
    expect(field()).toBeNull();

    await jest.advanceTimersByTimeAsync(1);
    await settle();
    await settle();
    shown();
  });

  it('says it in English', async () => {
    await open('/en/garages?brand=bmw', { language: 'en', placed: false });
    await asks[0]?.refuse();
    await settle();

    expect(label()).toBe('Enter an address');
    expect(said(page().querySelector('.placeless'))).toBe(
      'We could not get your location.',
    );
  });

  it('shows no field while the location is asked, nor once a place exists', async () => {
    await open('/ro/garages?brand=bmw', { placed: false });
    expect(field()).toBeNull();

    await harness.navigateByUrl('/ro/garages?brand=bmw&near=44.437,26.117');
    await settle();
    expect(field()).toBeNull();
  });

  it('keeps the place picked, writes it into the bar, runs one logged search and gives way to the summary line', async () => {
    placesApi.placesControllerSearch.mockResolvedValue({
      items: [{ label: 'Cluj-Napoca', lat: 46.77123, lng: 23.62361 }],
    });
    await open('/ro/garages?brand=bmw', { placed: false });
    await asks[0]?.refuse();
    await settle();

    const input = field() as HTMLInputElement;
    input.value = 'Cluj';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();
    await settle();
    expect(placesApi.placesControllerSearch).toHaveBeenCalledWith({
      lang: 'ro',
      q: 'Cluj',
    });
    options()[0]?.click();
    await settle();
    await settle();

    const kept = {
      label: 'Cluj-Napoca',
      lat: 46.771,
      lng: 23.624,
      origin: 'address',
    };
    expect(TestBed.inject(PlaceStore).place()).toEqual(kept);
    expect(JSON.parse(localStorage.getItem('mf-place') ?? 'null')).toEqual(
      kept,
    );
    expect(TestBed.inject(Router).url).toBe(
      '/ro/garages?brand=bmw&near=46.771,23.624',
    );
    expect(searches()).toEqual([
      { brand: 'bmw', log: '1', near: '46.771,23.624' },
    ]);

    await reads[0]?.answer();
    expect(field()).toBeNull();
    expect(said(page().querySelector('.summary .area'))).toBe(
      'în 25 km de Cluj-Napoca',
    );
    expect(page().querySelectorAll('mf-result-card')).toHaveLength(2);
  });

  it('drops a location that answers after an address was picked', async () => {
    jest.useFakeTimers();
    await open('/ro/garages?brand=bmw', { placed: false });
    await jest.advanceTimersByTimeAsync(10_000);
    await settle();
    TestBed.inject(PlaceStore).set(PLACE);
    await settle();

    await asks[0]?.found(CLUJ.lat, CLUJ.lng);

    expect(TestBed.inject(PlaceStore).place()).toEqual({
      ...PLACE,
      lat: 44.447,
      lng: 26.117,
    });
    expect(searches()).toEqual([
      { brand: 'bmw', log: '1', near: '44.447,26.117' },
    ]);
  });
});

// @traces 1355-FR-004
// @traces 1355-FR-005
// @traces 1355-FR-006
// @traces 1355-FR-007
// @traces 1355-FR-008
// @traces 1355-FR-009
// @traces 1355-FR-010
// @traces 1355-FR-011
// @traces 1355-FR-014
describe('Results changing the brand', () => {
  beforeEach(() => {
    brandsApi.popularBrandsControllerTiles.mockClear();
    carsApi.carsControllerList.mockClear();
    return configure();
  });

  const AUDI_PAGE = () =>
    pageOf({
      brand: AUDI,
      counts: { doesNotTake: 2, worksOn: 5 },
      items: [
        garageOf('three', 'Atelier Trei'),
        garageOf('four', 'Service Patru'),
      ],
      total: 7,
    });
  const row = () => page().querySelector('mf-brand-chips');
  const chips = () => [
    ...page().querySelectorAll<HTMLButtonElement>('mf-brand-chips button'),
  ];
  const chip = (name: string) => chips().find((b) => said(b) === name);
  const marked = () =>
    chips()
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map(said);
  const tap = async (name: string) => {
    const button = chip(name);
    button?.focus();
    button?.click();
    await settle();
    await settle();
    return button;
  };
  const cardNames = () =>
    [...page().querySelectorAll('mf-result-card h2')].map(said);
  const progress = () => page().querySelector('[role="progressbar"]');
  const brandSearch = () =>
    harness.fixture.debugElement.query(By.directive(BrandSearch));
  async function shown(url = `/ro/garages?brand=bmw&near=${NEAR}&radius=50`) {
    await open(url);
    await reads[0]?.answer();
  }

  it('shows the chips above the list with the current brand marked', async () => {
    await shown();

    expect(row()).not.toBeNull();
    expect(chips().map(said)).toEqual(['BMW', 'Audi', 'Dacia']);
    expect(marked()).toEqual(['BMW']);
    expect(
      (row()?.compareDocumentPosition(page().querySelector('.found') as Node) ??
        0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('pushes a history entry naming only the new brand, keeping the place and radius', async () => {
    await shown();
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate');

    await tap('Audi');

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { brand: 'audi' },
        queryParamsHandling: 'merge',
        replaceUrl: false,
      }),
    );
    expect(router.url).toBe(`/ro/garages?brand=audi&near=${NEAR}&radius=50`);
    expect(searches().at(-1)).toEqual({
      brand: 'audi',
      log: '1',
      near: NEAR,
      radius: 50,
    });
  });

  it('still writes a place change into the bar without a history entry', async () => {
    await shown();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

    page().querySelector<HTMLButtonElement>('.summary .change')?.click();
    await settle();
    dialog(PLACE);
    await settle();

    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ replaceUrl: true }),
    );
  });

  it('changes nothing for the brand already shown, by its slug or its id', async () => {
    await shown(`/ro/garages?brand=b-bmw&near=${NEAR}`);
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

    await tap('BMW');
    brandSearch()?.componentInstance.chosen.emit({ ...BMW, popularity: 1 });
    await settle();

    expect(navigate).not.toHaveBeenCalled();
    expect(searches()).toHaveLength(1);
  });

  it('forgets the area the map was moved to', async () => {
    await shown();
    mapMoved({ bbox: '44.4,26,44.5,26.2' });
    await settle();
    await reads.at(-1)?.answer();

    await tap('Audi');

    expect(searches().at(-1)).toEqual({
      brand: 'audi',
      log: '1',
      near: NEAR,
      radius: 50,
    });
  });

  it('shows the new brand, its first card selected, and follows it live', async () => {
    await shown();

    await tap('Audi');
    await reads.at(-1)?.answer(AUDI_PAGE());

    expect(said(page().querySelector('h1'))).toBe('Cine primește Audi');
    expect(cardNames()).toEqual(['Atelier Trei', 'Service Patru']);
    expect(
      page()
        .querySelector('mf-result-card')
        ?.querySelector('article.card.selected'),
    ).not.toBeNull();
    expect(marked()).toEqual(['Audi']);
    expect(live.register).toHaveBeenLastCalledWith({
      brand: 'b-audi',
      garages: ['three', 'four'],
    });
    expect(pinsApi.mock.calls.at(-1)?.[0]).toEqual({
      brand: 'audi',
      near: NEAR,
      radius: 50,
    });
  });

  it('keeps the chip focused after the change', async () => {
    await shown();

    const button = await tap('Audi');
    await reads.at(-1)?.answer(AUDI_PAGE());

    expect(document.activeElement).toBe(button);
  });

  it('keeps the previous cards, dimmed and not tappable, under a labelled progress bar while the new brand loads', async () => {
    await shown();

    await tap('Audi');

    expect(page().querySelectorAll('.card.skeleton')).toHaveLength(0);
    expect(cardNames()).toEqual(['Atelier Unu', 'Service Doi']);
    expect(page().querySelector('.cards.swapping')).not.toBeNull();
    expect(page().querySelector('.cards.swapping')?.hasAttribute('inert')).toBe(
      true,
    );
    expect(progress()?.getAttribute('aria-label')).toBe('Se caută Audi…');
    expect(chips().every((b) => !b.disabled)).toBe(true);

    await reads.at(-1)?.answer(AUDI_PAGE());

    expect(progress()).toBeNull();
    expect(page().querySelector('.cards.swapping')).toBeNull();
  });

  it('shows skeletons again for a map move after the new brand answered', async () => {
    await shown();
    await tap('Audi');
    await reads.at(-1)?.answer(AUDI_PAGE());

    mapMoved({ bbox: '44.4,26,44.5,26.2' });
    await settle();

    expect(page().querySelectorAll('.card.skeleton')).toHaveLength(6);
    expect(progress()).toBeNull();
    expect(page().querySelector('.cards.swapping')).toBeNull();
  });

  it('keeps the skeletons for a widening', async () => {
    await open(`/ro/garages?brand=bmw&near=${NEAR}`);
    await reads[0]?.answer(
      pageOf({ counts: { doesNotTake: 0, worksOn: 0 }, items: [], total: 0 }),
    );

    [...page().querySelectorAll<HTMLButtonElement>('.state button')]
      .find((b) => said(b)?.startsWith('Caută'))
      ?.click();
    await settle();
    await settle();
    expect(searches().at(-1)).toEqual({ brand: 'bmw', near: NEAR, radius: 50 });

    expect(page().querySelectorAll('.card.skeleton')).toHaveLength(6);
    expect(progress()).toBeNull();
  });

  it('shows the failure for the new brand, its chip marked, and retries the new brand unlogged', async () => {
    await shown();

    await tap('Audi');
    await reads.at(-1)?.fail();

    expect(said(page().querySelector('.state h1'))).toBe(
      'Nu am putut încărca rezultatele',
    );
    expect(marked()).toEqual(['Audi']);

    [...page().querySelectorAll<HTMLButtonElement>('.state button')]
      .find((b) => said(b) === 'Reîncearcă')
      ?.click();
    await settle();

    expect(searches().at(-1)).toEqual({
      brand: 'audi',
      near: NEAR,
      radius: 50,
    });

    await reads.at(-1)?.answer(AUDI_PAGE());
    mapMoved({ bbox: '44.4,26,44.5,26.2' });
    await settle();

    expect(page().querySelectorAll('.card.skeleton')).toHaveLength(6);
    expect(progress()).toBeNull();
  });

  it('follows the last chip tapped while the first is still loading', async () => {
    await shown();

    await tap('Audi');
    await tap('Dacia');

    expect(cardNames()).toEqual(['Atelier Unu', 'Service Doi']);
    expect(progress()?.getAttribute('aria-label')).toBe('Se caută Dacia…');
    expect(marked()).toEqual(['Dacia']);

    await reads.at(-1)?.answer(
      pageOf({
        brand: DACIA,
        counts: { doesNotTake: 0, worksOn: 1 },
        items: [garageOf('five', 'Garaj Cinci')],
        total: 1,
      }),
    );

    expect(cardNames()).toEqual(['Garaj Cinci']);
    expect(progress()).toBeNull();
    expect(marked()).toEqual(['Dacia']);
  });

  it('logs one search per brand change and none for a retry after it', async () => {
    await shown();

    await tap('Audi');
    await reads.at(-1)?.answer(AUDI_PAGE());
    await tap('Dacia');
    await reads.at(-1)?.fail();
    [...page().querySelectorAll<HTMLButtonElement>('.state button')]
      .find((b) => said(b) === 'Reîncearcă')
      ?.click();
    await settle();

    expect(searches().filter((q) => q.log === '1')).toEqual([
      { brand: 'bmw', log: '1', near: NEAR, radius: 50 },
      { brand: 'audi', log: '1', near: NEAR, radius: 50 },
      { brand: 'dacia', log: '1', near: NEAR, radius: 50 },
    ]);
  });

  it('goes back to the previous brand with the back button and logs nothing for it', async () => {
    // The app listens for the browser's back button from its first navigation.
    TestBed.inject(Router).setUpLocationChangeListener();
    await shown();
    await tap('Audi');
    await reads.at(-1)?.answer(AUDI_PAGE());

    TestBed.inject(Location).back();
    await new Promise((r) => setTimeout(r));
    await settle();
    await settle();

    expect(TestBed.inject(Router).url).toBe(
      `/ro/garages?brand=bmw&near=${NEAR}&radius=50`,
    );
    expect(searches().at(-1)).toEqual({ brand: 'bmw', near: NEAR, radius: 50 });

    await reads.at(-1)?.fail();
    [...page().querySelectorAll<HTMLButtonElement>('.state button')]
      .find((b) => said(b) === 'Reîncearcă')
      ?.click();
    await settle();

    expect(searches().at(-1)).toEqual({ brand: 'bmw', near: NEAR, radius: 50 });
  });

  // @traces 1355-FR-011
  it('names the brand on the progress bar after a step back too', async () => {
    TestBed.inject(Router).setUpLocationChangeListener();
    await shown();
    await tap('Audi');
    await reads.at(-1)?.answer(AUDI_PAGE());

    TestBed.inject(Location).back();
    await new Promise((r) => setTimeout(r));
    await settle();
    await settle();

    expect(progress()?.getAttribute('aria-label')).toBe('Se caută BMW…');
  });

  it('offers the brand search after the chips, and a brand picked there changes the search and is marked', async () => {
    await shown();

    const search = brandSearch();
    expect(search).not.toBeNull();
    expect(
      (row()?.compareDocumentPosition(search.nativeElement) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    search.componentInstance.chosen.emit({
      id: 'b-alfa',
      name: 'Alfa Romeo',
      popularity: null,
      slug: 'alfa-romeo',
    });
    await settle();
    await settle();

    expect(TestBed.inject(Router).url).toBe(
      `/ro/garages?brand=alfa-romeo&near=${NEAR}&radius=50`,
    );
    expect(searches().at(-1)).toEqual({
      brand: 'alfa-romeo',
      log: '1',
      near: NEAR,
      radius: 50,
    });
    expect(chips().map(said)).toEqual(['Alfa Romeo', 'BMW', 'Audi', 'Dacia']);
    expect(marked()).toEqual(['Alfa Romeo']);
  });

  it('drops a picked brand from the row once another chip is chosen', async () => {
    await shown();
    brandSearch().componentInstance.chosen.emit({
      id: 'b-alfa',
      name: 'Alfa Romeo',
      popularity: null,
      slug: 'alfa-romeo',
    });
    await settle();
    await settle();

    await tap('Audi');

    expect(chips().map(said)).toEqual(['BMW', 'Audi', 'Dacia']);
    expect(marked()).toEqual(['Audi']);
  });

  it("announces the new brand's tally as a new search is", async () => {
    const announce = jest
      .spyOn(TestBed.inject(LiveAnnouncer), 'announce')
      .mockResolvedValue();
    await shown();

    await tap('Audi');
    await reads.at(-1)?.answer(AUDI_PAGE());
    await new Promise((r) => setTimeout(r, 50));
    await settle();

    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining('lucrează pe Audi'),
      'polite',
    );
  });

  // @traces 1355-FR-006
  it("rises the new brand's cards and blurs its name in only after a brand change, and only until the row-in has run", async () => {
    const rising = () => ({
      cards: page().querySelector('.cards.rising') !== null,
      title: page().querySelector('h1.rising') !== null,
    });
    await shown();
    expect(rising()).toEqual({ cards: false, title: false });

    await tap('Audi');
    expect(rising()).toEqual({ cards: false, title: false });
    await reads.at(-1)?.answer(AUDI_PAGE());
    expect(rising()).toEqual({ cards: true, title: true });

    await new Promise((r) => setTimeout(r, 560));
    await settle();
    expect(rising()).toEqual({ cards: false, title: false });

    mapMoved({ bbox: '44.4,26,44.5,26.2' });
    await settle();
    await reads.at(-1)?.answer(AUDI_PAGE());
    expect(rising()).toEqual({ cards: false, title: false });
  });
});

describe('the row-in after a brand change', () => {
  const css = readFileSync(join(__dirname, 'results.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');

  // @traces 1355-FR-006
  it('plays the rise and the blur-in only on a rising list and title, never on every render', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
      ([, sel, body]) => ({ body, sel: sel.trim() }),
    );
    const animating = (name: string) =>
      rules.filter(({ body }) => body.includes(name)).map(({ sel }) => sel);
    expect(animating('mf-row-in 320ms')).toEqual(['.cards.rising > li']);
    expect(animating('mf-swap-in 520ms')).toEqual(['h1.rising .titled']);
  });
});

describe('the brand chips and the brand search from a tablet up', () => {
  // The Jest transform drops component styles, so they are read from the source.
  const css = readFileSync(join(__dirname, 'results.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
  const topLevel = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const rule = (selector: string) =>
    [...topLevel.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, sel]) => sel.trim() === selector,
    )?.[2] ?? '';

  it('keeps the search on the chips line, the sorts on their own: the chips shrink and wrap inside their own box', () => {
    expect(rule('.brands')).toMatch(/flex-wrap: wrap;/);
    expect(rule('.brands mf-sort-control')).toMatch(/flex-basis: 100%;/);
    expect(rule('mf-brand-chips')).toMatch(/flex: 1 1 0;/);
    expect(rule('mf-brand-chips')).toMatch(/min-width: 0;/);
    expect(rule('.brands mf-brand-search')).toMatch(/flex: 0 0 16rem;/);
  });

  it('stacks them again on a phone', () => {
    const phone =
      css.match(
        /@media \(max-width: 767px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
      )?.[1] ?? '';
    expect(phone).toMatch(/\.brands \{ flex-wrap: wrap;/);
    expect(phone).toMatch(/flex-basis: 100%;/);
  });

  it('scrolls the filters line sideways inside itself on a phone, like the brand chips', () => {
    const filters = [
      ...css.matchAll(
        /@media \(max-width: 767px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/g,
      ),
    ]
      .map(([, body]) => body)
      .find((body) => body.includes('.brands .filters {'));
    expect(filters).toMatch(
      /\.brands \.filters \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/,
    );
    expect(filters).toMatch(/white-space: nowrap;/);
  });

  it('sets the filters line beside the brand search on a phone, level with its field, so the header grows no row', () => {
    const filters =
      [
        ...css.matchAll(
          /@media \(max-width: 767px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/g,
        ),
      ]
        .map(([, body]) => body)
        .find((body) => body.includes('.brands .filters {')) ?? '';
    expect(filters).toMatch(
      /\.brands mf-brand-search \{ flex: 1 1 0; min-width: 9\.5rem; \}/,
    );
    expect(filters).toMatch(
      /\.brands \.filters \{ align-self: flex-end; flex: 0 1 auto;/,
    );
    const phone =
      css.match(
        /@media \(max-width: 767px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
      )?.[1] ?? '';
    expect(phone).not.toMatch(/mf-brand-search/);
  });
});

// @traces 1358-FR-001 1358-FR-002 1358-FR-006 1358-FR-007 1358-FR-008 1358-FR-010
describe('Results on a phone, with the list in a sheet over the map', () => {
  let scroll: jest.Mock;

  beforeEach(async () => {
    brandsApi.popularBrandsControllerTiles.mockClear();
    await configure();
    scroll = jest.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    Element.prototype.scrollTo = jest.fn();
    window.scrollTo = jest.fn();
  });

  afterEach(() => jest.restoreAllMocks());

  const sheet = () => page().querySelector<HTMLElement>('mf-results-sheet');
  const position = () => sheet()?.getAttribute('data-position');
  const intro = () => page().querySelector('header.intro');
  async function shown(url = `/ro/garages?brand=bmw&near=${NEAR}`) {
    await open(url);
    await reads[0]?.answer();
  }

  // @traces 1358-FR-001 1358-FR-006
  it("puts the brand chips in the sheet's header and the list in its body", async () => {
    await shown();

    expect(
      sheet()?.querySelector('.header .brands mf-brand-chips'),
    ).not.toBeNull();
    expect(
      sheet()?.querySelector('.header .brands mf-brand-search'),
    ).not.toBeNull();
    expect(
      sheet()?.querySelectorAll('.body .found mf-result-card'),
    ).toHaveLength(2);
    expect(position()).toBe('half');
  });

  // @traces 1358-FR-002
  it("keeps the summary above the map with the page's one heading and its actions", async () => {
    await shown();

    expect(page().querySelectorAll('h1')).toHaveLength(1);
    expect(intro()?.querySelector('h1')).not.toBeNull();
    expect(sheet()?.contains(intro())).toBe(false);
    expect(intro()?.querySelector('.summary .tally')).not.toBeNull();
    expect([...(intro()?.querySelectorAll('button') ?? [])].map(said)).toEqual(
      expect.arrayContaining(['Schimbă locul']),
    );
    expect(
      intro()?.compareDocumentPosition(
        page().querySelector('mf-results-map') as Node,
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // @traces 1358-FR-001 1358-FR-015
  it('follows the layout across 768 px, the sheet starting again at half', async () => {
    await shown();
    sheet()?.querySelector<HTMLButtonElement>('button.handle')?.click();
    await settle();
    expect(position()).toBe('full');

    layout.set('tablet');
    await settle();
    expect(sheet()?.querySelector('button.handle')).toBeNull();
    expect(page().querySelectorAll('mf-result-card')).toHaveLength(2);

    layout.set('phone');
    await settle();
    expect(position()).toBe('half');
  });

  // @traces 1358-FR-013 1358-FR-016
  it('moves the sheet with no request, no search, no storage and no new address', async () => {
    await shown();
    const router = TestBed.inject(Router);
    const address = router.url;
    const stored = localStorage.length;
    const handle = () =>
      sheet()?.querySelector<HTMLButtonElement>('button.handle');

    for (let i = 0; i < 3; i++) {
      handle()?.click();
      await settle();
    }

    expect(position()).toBe('half');
    expect(reads).toHaveLength(1);
    expect(router.url).toBe(address);
    expect(localStorage.length).toBe(stored);
  });

  // @traces 1358-FR-007 1358-FR-015
  it("raises the sheet before it brings a listed garage's card into view on a pin tap", async () => {
    const raise = jest.spyOn(ResultsSheet.prototype, 'raise');
    await shown();

    mapPicked('two');
    await settle();

    expect(raise).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(raise.mock.invocationCallOrder[0]).toBeLessThan(
      scroll.mock.invocationCallOrder[0] ?? 0,
    );
  });

  // @traces 1358-FR-007
  it('moves the sheet nowhere for a pin whose garage is not in the list', async () => {
    const raise = jest.spyOn(ResultsSheet.prototype, 'raise');
    await shown();

    mapPicked('pin-5');
    await settle();

    expect(raise).not.toHaveBeenCalled();
    expect(position()).toBe('half');
  });

  // @traces 1358-FR-008
  it("keeps the position on a brand change and sends the list to the sheet's top", async () => {
    const top = jest.spyOn(ResultsSheet.prototype, 'toTop');
    await shown();

    page()
      .querySelectorAll<HTMLButtonElement>('mf-brand-chips button')[1]
      ?.click();
    await settle();
    await settle();
    await reads
      .at(-1)
      ?.answer(pageOf({ brand: { id: 'b-audi', name: 'Audi', slug: 'audi' } }));

    expect(top).toHaveBeenCalledWith(true);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(position()).toBe('half');
    expect(
      sheet()?.querySelector('mf-result-card article.card.selected'),
    ).not.toBeNull();
  });

  // @traces 1358-FR-008
  it('keeps the position and the list where it is on a map move', async () => {
    const top = jest.spyOn(ResultsSheet.prototype, 'toTop');
    await shown();

    mapMoved({ bbox: '44.4,26,44.5,26.2' });
    await settle();
    await reads.at(-1)?.answer();

    expect(top).not.toHaveBeenCalled();
    expect(position()).toBe('half');
  });

  // @traces 1358-FR-010
  it('rests the sheet at full with no history step and says so in the summary when the map fails', async () => {
    const push = jest.spyOn(history, 'pushState');
    openMap.mockImplementationOnce(() => Promise.reject(new Error('style')));
    await shown();
    await settle();

    expect(position()).toBe('full');
    expect(push).not.toHaveBeenCalledWith(
      expect.objectContaining({ mfSheet: true }),
      '',
    );
    const status = intro()?.querySelector(
      '[role="status"][aria-live="polite"]',
    );
    expect(said(status)).toBe('Harta nu este disponibilă acum');
    expect(page().querySelectorAll('mf-result-card')).toHaveLength(2);
  });

  // @traces 1358-FR-010 1358-FR-014
  it('says the map is not available in English', async () => {
    openMap.mockImplementationOnce(() => Promise.reject(new Error('style')));
    await open(`/en/garages?brand=bmw&near=${NEAR}`, { language: 'en' });
    await reads[0]?.answer();
    await settle();

    expect(
      said(intro()?.querySelector('[role="status"][aria-live="polite"]')),
    ).toBe('The map is not available now');
  });

  // @traces 1358-FR-010
  it('says nothing in the summary while the map works', async () => {
    await shown();

    expect(
      said(intro()?.querySelector('[role="status"][aria-live="polite"]')) ?? '',
    ).toBe('');
  });
});

// @traces 1358-FR-001 1358-FR-005 1358-FR-011
// @traces 1351-FR-003 1351-FR-004 1351-FR-007
describe('the phone results screen in the stylesheet', () => {
  const css = readFileSync(join(__dirname, 'results.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
  const phone =
    css.match(
      /@media \(max-width: 767px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
    )?.[1] ?? '';
  const rule = (selector: string) =>
    [...phone.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, sel]) => sel.trim() === selector,
    )?.[2] ?? '';

  it('makes the page one screen between the site bar and the tab bar, above the consent bar, which does not scroll', () => {
    expect(rule(':host')).toMatch(
      /height: calc\(\s*100dvh\s*-\s*var\(--public-site-bar\)\s*-\s*var\(--tab-bar\)\s*-\s*var\(--consent-bar, 0px\)\s*\);/,
    );
    expect(rule(':host')).toMatch(/overflow: hidden;/);
  });

  // Up to 880 px tall: under the summary the sheet's header (the chips, the
  // brand search and the sorts) left a 375 x 812 phone's map a strip with
  // the bar asking, its pins under the low sheet (ST-328 full CI).
  it('lets the consent bar lie over the stage on a phone up to 880 px tall, so the map and the half sheet keep their room', () => {
    const short =
      css.match(
        /@media \(max-width: 767px\) and \(max-height: 880px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
      )?.[1] ?? '';

    expect(short).toMatch(
      /:host \{ height: calc\(100dvh - var\(--public-site-bar\) - var\(--tab-bar\)\); \}/,
    );
  });

  it('keeps the one column as wide as the screen, whatever the title holds', () => {
    expect(rule(':host')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('cuts only the summary title to one line, not the list states the sheet holds', () => {
    expect(rule('.intro h1.title')).toMatch(/white-space: nowrap;/);
    expect(rule('h1')).toBe('');
  });

  it('lets the question asked for a place wrap at 320 px', () => {
    expect(rule('.intro h1')).not.toMatch(/nowrap|ellipsis|overflow/);
  });

  it('keeps the title to one line and shows the whole count and place line under it, never cut', () => {
    expect(rule('.intro h1')).toMatch(
      /font-size: var\(--mf-size-subheading\);/,
    );
    expect(rule('.summary')).toMatch(/flex-wrap: wrap;/);
    // A phone's running text stays at body size: the summary is read, not a caption.
    expect(rule('.summary')).not.toMatch(/font-size/);
    expect(phone).not.toMatch(/\.tally|\.area/);
    expect(rule('.summary')).not.toMatch(/nowrap|ellipsis/);
  });

  it('lets the map fill the stage down to the tab bar: its tablet height stays on the tablet', () => {
    expect(rule('mf-results-map')).toMatch(/height: auto;/);
    const outside = css.replace(
      /@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g,
      '',
    );
    expect(outside).not.toMatch(/mf-results-map \{/);
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1023px\) \{(?:[^{}]*\{[^}]*\})*?\s*mf-results-map \{[^}]*height: 40vh;/,
    );
  });

  it('keeps the map and its controls under the sheet', () => {
    expect(rule('mf-results-map')).toMatch(/isolation: isolate;/);
  });

  it('lays the sheet over the map, which fills the screen under the summary', () => {
    expect(rule('mf-results-map')).toMatch(/grid-area: stage;/);
    expect(rule('mf-results-sheet')).toMatch(/grid-area: stage;/);
    expect(rule(':host:has(mf-results-sheet.typing)')).toMatch(
      /height: calc\(100dvh - var\(--public-site-bar\) - var\(--consent-bar, 0px\)\);/,
    );
  });
});

// QA lap 4 at 1440 x 900: the unanswered consent bar lay over the map's
// bottom, and the static map's control and credit under it.
describe('the desktop map in the stylesheet', () => {
  const desktop =
    readFileSync(join(__dirname, 'results.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .match(/@media \(min-width: 1024px\) \{(.*?\}) \}/)?.[1] ?? '';

  it('holds the sticky map between the site bar and the consent bar while it asks', () => {
    expect(desktop).toMatch(
      /mf-results-map \{[^}]*height: calc\(\s*100vh - var\(--public-site-bar\) - 2 \* var\(--mf-space-4\) - var\(--consent-bar, 0px\)\s*\);/,
    );
    expect(desktop).toMatch(
      /mf-results-map \{[^}]*top: calc\(var\(--public-site-bar\) \+ var\(--mf-space-4\)\);/,
    );
  });
});

// A garage's profile, say: any screen but Results.
@Component({ template: '' })
class Elsewhere {}

// @traces 1356-FR-001 1356-FR-002 1356-FR-003 1356-FR-004 1356-FR-005 1356-FR-007
describe('Results loading more', () => {
  let observers: {
    callback: IntersectionObserverCallback;
    targets: Element[];
  }[];
  class FakeObserver {
    private readonly at: number;
    constructor(callback: IntersectionObserverCallback) {
      this.at = observers.push({ callback, targets: [] }) - 1;
    }
    observe(target: Element) {
      observers[this.at].targets.push(target);
    }
    disconnect() {
      observers[this.at].targets = [];
    }
    unobserve() {}
  }
  let scroll: jest.Mock;

  beforeEach(async () => {
    observers = [];
    Object.assign(window, { IntersectionObserver: FakeObserver });
    scroll = jest.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    await configure('browser', [
      { component: Elsewhere, path: ':lang/elsewhere' },
    ]);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
  });

  const garages = (from: number, count: number, stance = 'works_on') =>
    Array.from({ length: count }, (_, i) => ({
      ...garageOf(`g${from + i}`, `Garage ${from + i}`),
      stance: stance as ListedGarageDto['stance'],
    }));
  const first = (over: Partial<GarageSearchPageDto> = {}) =>
    pageOf({ items: garages(0, 20), nextCursor: 'c1', ...over });
  const hosts = () => [...page().querySelectorAll('mf-result-card')];
  const names = () => hosts().map((card) => said(card.querySelector('h2')));
  // Results makes the first observer; each card has its own after it.
  const watched = () => observers[0]?.targets[0];
  const skeletons = () =>
    page().querySelectorAll('.cards.later .card.skeleton');
  const button = () => page().querySelector<HTMLButtonElement>('button.more');
  const end = () => page().querySelector<HTMLElement>('p.end');
  const cursors = () => searches().filter((q) => q.cursor);
  async function loaded(answer = first()) {
    await open('/ro/garages?brand=bmw');
    await reads[0]?.answer(answer);
  }
  // The card three from the end scrolls into view.
  async function scrolledToEnd(at = 0) {
    for (const o of observers.slice(0, 1)) {
      const target = o.targets[at];
      if (target)
        o.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          o as unknown as IntersectionObserver,
        );
    }
    await settle();
  }

  // @traces 1356-FR-001 1356-FR-002
  it('asks for the next page of the same search when the card three from the end shows', async () => {
    await loaded();

    expect(watched()).toBe(hosts()[17]);
    await scrolledToEnd();

    expect(searches().at(-1)).toEqual({
      brand: 'bmw',
      cursor: 'c1',
      near: NEAR,
    });
    expect(skeletons()).toHaveLength(3);
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );

    expect(names()).toEqual(
      Array.from({ length: 40 }, (_, i) => `Garage ${i}`),
    );
    expect(skeletons()).toHaveLength(0);
    expect(watched()).toBe(hosts()[37]);
  });

  // @traces 1356-FR-001
  it('asks for the next page when a jump to the bottom shows only the last card', async () => {
    await loaded();

    expect(observers[0]?.targets).toEqual([hosts()[17], hosts()[19]]);
    await scrolledToEnd(1);

    expect(cursors()).toEqual([{ brand: 'bmw', cursor: 'c1', near: NEAR }]);
  });

  // @traces 1356-FR-001
  it('keeps the brand groups in the order the pages answer them', async () => {
    await loaded(first({ items: garages(0, 20) }));
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({
        items: [...garages(20, 11), ...garages(31, 9, 'does_not_take')],
        nextCursor: null,
      }),
    );

    expect(names()).toHaveLength(40);
    expect(names()).toEqual(
      Array.from({ length: 40 }, (_, i) => `Garage ${i}`),
    );
  });

  // @traces 1356-FR-002
  it('asks for one page at a time', async () => {
    await loaded();
    await scrolledToEnd();
    await scrolledToEnd();
    button()?.click();
    await settle();

    expect(cursors()).toHaveLength(1);
  });

  // @traces 1356-FR-002
  it('drops a page answered after another search started', async () => {
    await loaded();
    await scrolledToEnd();
    await open('/ro/garages?brand=audi');
    await reads[2]?.answer(pageOf());
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );

    expect(names()).toEqual(['Atelier Unu', 'Service Doi']);
  });

  // @traces 1356-FR-002
  it('drops a page answered after the map moved', async () => {
    await loaded();
    await scrolledToEnd();
    mapMoved({ bbox: '44.4,26,44.5,26.2' });
    await settle();
    const box = reads.findIndex((read) => read.params.bbox);
    await reads[box]?.answer(pageOf());
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );

    expect(names()).toEqual(['Atelier Unu', 'Service Doi']);
  });

  // @traces 1356-FR-002
  it('asks again at once after an empty page with a cursor, three times at most, then offers the retry', async () => {
    await loaded();
    await scrolledToEnd();
    await reads[1]?.answer(pageOf({ items: [], nextCursor: 'c2' }));
    await reads[2]?.answer(pageOf({ items: [], nextCursor: 'c3' }));
    await reads[3]?.answer(pageOf({ items: [], nextCursor: 'c4' }));

    expect(cursors().map((q) => q.cursor)).toEqual(['c1', 'c2', 'c3']);
    expect(said(button())).toBe('Reîncearcă');
    expect(names()).toHaveLength(20);
  });

  // @traces 1356-FR-003 1356-FR-004
  it('ends the list with the total once the last page came, the top unchanged', async () => {
    await loaded();
    const tally = said(page().querySelector('.summary .tally'));
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );
    await scrolledToEnd();
    await reads[2]?.answer(pageOf({ items: garages(40, 8), nextCursor: null }));

    expect(names()).toHaveLength(48);
    expect(said(end())).toBe('Ai văzut toate cele 48');
    expect(end()?.getAttribute('role')).toBe('status');
    expect(button()).toBeNull();
    expect(watched()).toBeUndefined();
    expect(said(page().querySelector('.summary .tally'))).toBe(tally);
  });

  // @traces 1356-FR-003
  it('adds nothing under a list of one page', async () => {
    await loaded(pageOf());

    expect(said(end())).toBe('');
    expect(button()).toBeNull();
    expect(watched()).toBeUndefined();
  });

  // @traces 1356-FR-003
  it('says the end in English', async () => {
    await TestBed.inject(I18n).use('en');
    await loaded();
    await scrolledToEnd();
    await reads[1]?.answer(pageOf({ items: garages(20, 5), nextCursor: null }));

    expect(said(end())).toBe('You have seen all 48');
  });

  // @traces 1356-FR-007
  it('stops at 500 cards, cutting the page that would pass them, even with a cursor', async () => {
    await loaded(
      pageOf({ items: garages(0, 490), nextCursor: 'c1', total: 900 }),
    );
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(490, 20), nextCursor: 'c2', total: 900 }),
    );

    expect(names()).toHaveLength(500);
    expect(said(end())).toBe(
      'Ai văzut primele 500 · apropie harta pentru mai puține',
    );
    expect(button()).toBeNull();
    expect(watched()).toBeUndefined();
    await scrolledToEnd();
    expect(cursors()).toHaveLength(1);
    expect(said(page().querySelector('.summary .tally'))).toContain('900');
  });

  // @traces 1356-FR-007
  it('says the first 500 when the last page passes them and has no next', async () => {
    await loaded(
      pageOf({ items: garages(0, 495), nextCursor: 'c1', total: 505 }),
    );
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(495, 10), nextCursor: null, total: 505 }),
    );

    expect(names()).toHaveLength(500);
    expect(said(end())).toBe(
      'Ai văzut primele 500 · apropie harta pentru mai puține',
    );
  });

  // @traces 1356-FR-005
  it('loads the next page from its button, keeping the focus on it, and gives the focus to the end line at the last page', async () => {
    await loaded();
    expect(said(button())).toBe('Încarcă mai multe');
    button()?.focus();
    button()?.click();
    await settle();

    expect(searches().at(-1)).toEqual({
      brand: 'bmw',
      cursor: 'c1',
      near: NEAR,
    });
    expect(button()?.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(button());
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );

    expect(button()?.getAttribute('aria-busy')).toBe('false');
    expect(document.activeElement).toBe(button());
    button()?.click();
    await settle();
    await reads[2]?.answer(pageOf({ items: garages(40, 8), nextCursor: null }));

    expect(button()).toBeNull();
    expect(end()?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(end());
  });

  // @traces 1356-FR-006
  it('keeps the cards when a page fails and asks for the same page again only from the retry', async () => {
    await loaded();
    await scrolledToEnd();
    await reads[1]?.fail();

    expect(names()).toHaveLength(20);
    expect(skeletons()).toHaveLength(0);
    expect(said(button())).toBe('Reîncearcă');
    await scrolledToEnd();
    expect(cursors()).toHaveLength(1);

    for (const lap of [2, 3, 4]) {
      button()?.click();
      await settle();
      expect(searches().at(-1)).toEqual({
        brand: 'bmw',
        cursor: 'c1',
        near: NEAR,
      });
      await reads[lap]?.fail();
      expect(said(button())).toBe('Reîncearcă');
    }
    button()?.click();
    await settle();
    await reads[5]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: null }),
    );

    expect(names()).toHaveLength(40);
  });

  // @traces 1356-FR-010
  it('starts the list again from the top when the cursor is refused', async () => {
    await loaded();
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );
    await scrolledToEnd();
    await reads[2]?.fail(400, undefined, {
      code: 'invalid_cursor',
      message: 'cursor is not a page of this search',
    });

    expect(searches().at(-1)).toEqual({ brand: 'bmw', near: NEAR });
    await reads[3]?.answer(first({ items: garages(100, 20) }));

    expect(names()).toEqual(
      Array.from({ length: 20 }, (_, i) => `Garage ${100 + i}`),
    );
    expect(
      hosts().filter((card) => card.querySelector('article.card.selected')),
    ).toEqual([hosts()[0]]);
    expect(page().querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 1356-FR-011
  it('never adds a card twice: a garage answered again keeps its place with the fresher card', async () => {
    await loaded();
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({
        items: [
          ...garages(20, 10),
          { ...garageOf('g5', 'Garage 5 nou'), rating: 3 },
          ...garages(30, 9),
        ],
        nextCursor: null,
      }),
    );

    expect(names()).toHaveLength(39);
    expect(names()[5]).toBe('Garage 5 nou');
    expect(
      names().filter((name) => name?.startsWith('Garage 5 ')),
    ).toHaveLength(1);
  });

  // @traces 1356-FR-012
  it('follows and reads again by ids the first page garages only', async () => {
    jest.useFakeTimers();
    await loaded();
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: null }),
    );
    const ids = Array.from({ length: 20 }, (_, i) => `g${i}`);

    expect(live.register).toHaveBeenLastCalledWith({
      brand: 'b-bmw',
      garages: ids,
    });
    messages.next({
      at: '2026-10-20T12:00:00.000Z',
      id: 'review-1',
      kind: 'review.posted',
    });
    await jest.advanceTimersByTimeAsync(300);
    await settle();

    expect(reads[2]?.params).toEqual({
      brand: 'bmw',
      ids: ids.join(','),
      near: NEAR,
    });
    messages.next({
      at: '2026-10-20T12:00:01.000Z',
      id: 'g30',
      kind: 'garage.updated',
    });
    await reads[2]?.answer(pageOf({ items: garages(0, 20) }));
    await jest.advanceTimersByTimeAsync(300);
    await settle();
    const idsReads = searches().filter((q) => q.ids);
    expect(idsReads.every((q) => (q.ids?.split(',').length ?? 0) <= 20)).toBe(
      true,
    );
    expect(idsReads.some((q) => q.ids?.includes('g30'))).toBe(false);
  });

  // @traces 1356-FR-013 1356-FR-014
  it('links a card of a later page to its pin, and changes no selection or map while a page loads', async () => {
    pinsAnswer = {
      pins: Array.from({ length: 40 }, (_, i) => ({
        id: `g${i}`,
        lat: 44.4 + i / 1000,
        lng: 26.1,
        matches: true,
        rateLei: 150,
        stance: 'works_on' as const,
      })),
      total: 40,
    };
    await loaded();
    await settle();
    hosts()[3]?.querySelector('h2')?.click();
    await settle();
    const fits = mapView.fit.mock.calls.length;
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: null }),
    );

    const amber = () =>
      hosts()
        .filter((card) => card.querySelector('article.card.selected'))
        .map((card) => said(card.querySelector('h2')));
    expect(amber()).toEqual(['Garage 3']);
    expect(mapView.fit.mock.calls.length).toBe(fits);

    const pointed = new Event('pointerenter');
    Object.defineProperty(pointed, 'pointerType', { value: 'mouse' });
    hosts()[30]?.dispatchEvent(pointed);
    await settle();
    expect(mapView.light.mock.calls.at(-1)?.[0]).toBe('g30');

    mapPicked('g35');
    await settle();
    expect(amber()).toEqual(['Garage 35']);
    expect(scroll).toHaveBeenCalled();
    expect(page().querySelector('mf-map-card')).toBeNull();
  });

  // @traces 1356-FR-013
  it('closes a tapped pin small card when its garage comes with a page, that card selected', async () => {
    pinsAnswer = {
      pins: Array.from({ length: 40 }, (_, i) => ({
        id: `g${i}`,
        lat: 44.4 + i / 1000,
        lng: 26.1,
        matches: true,
        rateLei: 150,
        stance: 'works_on' as const,
      })),
      total: 40,
    };
    await loaded();
    await settle();
    mapPicked('g25');
    await settle();
    expect(page().querySelector('mf-map-card')).not.toBeNull();
    await reads[1]?.answer(pageOf({ items: garages(25, 1) }));
    await scrolledToEnd();
    await reads[2]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: null }),
    );

    expect(page().querySelector('mf-map-card')).toBeNull();
    expect(
      hosts()
        .filter((card) => card.querySelector('article.card.selected'))
        .map((card) => said(card.querySelector('h2'))),
    ).toEqual(['Garage 25']);
  });

  // @traces 1356-FR-008
  it('shows the loaded pages again at once on the way back, reads the first page again without log and no later one', async () => {
    await loaded();
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );
    await harness.navigateByUrl('/ro/elsewhere');
    await settle();
    await harness.navigateByUrl(`/ro/garages?brand=bmw&near=${NEAR}`);
    await settle();

    expect(names()).toHaveLength(40);
    expect(searches().slice(2)).toEqual([{ brand: 'bmw', near: NEAR }]);
    await reads[2]?.answer(
      first({
        items: [{ ...garageOf('g0', 'Garage 0 nou') }, ...garages(1, 19)],
      }),
    );

    expect(names()).toHaveLength(40);
    expect(names()[0]).toBe('Garage 0 nou');
    expect(button()).not.toBeNull();
    expect(cursors()).toHaveLength(1);
  });

  // @traces 1356-FR-008
  it.each(['before', 'after'])(
    'reads nothing more when the stream opens for the list shown on the way back %s its first page lands, and re-reads on a later re-open',
    async (when) => {
      await loaded();
      await scrolledToEnd();
      await reads[1]?.answer(
        pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
      );
      await harness.navigateByUrl('/ro/elsewhere');
      await settle();
      await harness.navigateByUrl(`/ro/garages?brand=bmw&near=${NEAR}`);
      await settle();
      pinsApi.mockClear();

      if (when === 'after') await reads[2]?.answer(first());
      resync.next();
      await settle();
      if (when === 'before') await reads[2]?.answer(first());
      await settle();

      expect(searches().slice(2)).toEqual([{ brand: 'bmw', near: NEAR }]);
      expect(pinsApi).not.toHaveBeenCalled();
      expect(names()).toHaveLength(40);

      // The stream lost and opened again: the cards and the counts are read.
      resync.next();
      await settle();
      await reads[3]?.answer(first());
      await settle();

      expect(pinsApi).toHaveBeenCalledTimes(1);
      expect(searches().slice(3)).toEqual([
        {
          brand: 'bmw',
          ids: Array.from({ length: 20 }, (_, i) => `g${i}`).join(','),
          near: NEAR,
        },
        { brand: 'bmw', near: NEAR },
      ]);
    },
  );

  // @traces 1356-FR-008
  it('reads nothing more on the way back for streams opened for another view before the one naming the list shown, and re-reads on a later re-open', async () => {
    await loaded();
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );
    await harness.navigateByUrl('/ro/elsewhere');
    await settle();
    await harness.navigateByUrl(`/ro/garages?brand=bmw&near=${NEAR}`);
    await settle();
    await reads[2]?.answer(first());
    await settle();
    pinsApi.mockClear();

    // The profile's stream, and one opened before the list was named.
    live.names.mockReturnValue(false);
    resync.next();
    await settle();
    resync.next();
    await settle();
    live.names.mockReturnValue(true);
    resync.next();
    await settle();

    expect(searches().slice(2)).toEqual([{ brand: 'bmw', near: NEAR }]);
    expect(pinsApi).not.toHaveBeenCalled();
    expect(live.names).toHaveBeenLastCalledWith({
      brand: 'b-bmw',
      garages: Array.from({ length: 20 }, (_, i) => `g${i}`),
    });

    resync.next();
    await settle();
    await reads[3]?.answer(first());
    await settle();

    expect(pinsApi).toHaveBeenCalledTimes(1);
    expect(searches()).toHaveLength(5);
  });

  // @traces 1356-FR-008
  it('starts another search from its first page, logged', async () => {
    await loaded();
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );
    await harness.navigateByUrl('/ro/elsewhere');
    await settle();
    await harness.navigateByUrl(`/ro/garages?brand=audi&near=${NEAR}`);
    await settle();

    expect(searches().at(-1)).toEqual({ brand: 'audi', log: '1', near: NEAR });
    expect(page().querySelectorAll('mf-result-card')).toHaveLength(0);
  });

  // @traces 1356-FR-008
  it("scrolls the phone's sheet back to where the list was on the way back, not the page", async () => {
    jest.spyOn(ResultsSheet.prototype, 'scrolled').mockReturnValue(640);
    const back = jest.spyOn(ResultsSheet.prototype, 'scrollBack');
    window.scrollTo = jest.fn();
    await loaded();
    await harness.navigateByUrl('/ro/elsewhere');
    await settle();
    await harness.navigateByUrl(`/ro/garages?brand=bmw&near=${NEAR}`);
    await settle();

    expect(back).toHaveBeenCalledWith(640);
    expect(window.scrollTo).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  // @traces 1356-FR-008
  it('scrolls the page back from a tablet up, where the sheet does not scroll', async () => {
    layout.set('tablet');
    const back = jest.spyOn(ResultsSheet.prototype, 'scrollBack');
    window.scrollTo = jest.fn();
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 900,
    });
    await loaded();
    await harness.navigateByUrl('/ro/elsewhere');
    await settle();
    await harness.navigateByUrl(`/ro/garages?brand=bmw&near=${NEAR}`);
    await settle();

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 900 });
    expect(back).not.toHaveBeenCalled();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    jest.restoreAllMocks();
  });

  // The page is torn down after the next screen is chosen: by then the list
  // is gone, the sheet no longer scrolls and the shorter page has clamped
  // its scroll to the top, so the place is read as the navigation starts.
  // @traces 1193-FR-003
  it.each([
    ['phone', 640],
    ['tablet', 900],
  ] as const)(
    'keeps where the list was as the navigation starts, not once the page is torn down, on a %s',
    async (size, y) => {
      layout.set(size);
      let gone = false;
      TestBed.inject(Router)
        .events.pipe(filter((event) => event instanceof GuardsCheckStart))
        .subscribe(() => {
          gone = true;
        });
      jest
        .spyOn(ResultsSheet.prototype, 'scrolled')
        .mockImplementation(() => (gone ? 0 : y));
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        get: () => (gone ? 0 : y),
      });
      const back = jest.spyOn(ResultsSheet.prototype, 'scrollBack');
      window.scrollTo = jest.fn();
      await loaded();
      gone = false;
      await harness.navigateByUrl('/ro/elsewhere');
      await settle();
      await harness.navigateByUrl(`/ro/garages?brand=bmw&near=${NEAR}`);
      await settle();

      if (size === 'phone') expect(back).toHaveBeenCalledWith(y);
      else expect(window.scrollTo).toHaveBeenCalledWith({ top: y });
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        value: 0,
      });
      jest.restoreAllMocks();
    },
  );

  // A row still to come under the list (the end line) clamps the first
  // scroll short of the place; it is set again until it lands.
  // @traces 1193-FR-003
  it.each([
    [
      'scrolls the sheet again when the list was still too short to reach the place',
      false,
      [[640], [640]],
    ],
    [
      'leaves the sheet where the driver scrolled it while the list settles',
      true,
      [[640]],
    ],
  ] as const)('%s', async (_, driverScrolls, calls) => {
    let top = 640;
    let tall = 600;
    jest
      .spyOn(ResultsSheet.prototype, 'scrolled')
      .mockImplementation(() => top);
    const scrolls = jest
      .spyOn(ResultsSheet.prototype, 'scrollBack')
      .mockImplementation((y) => {
        top = Math.min(y, tall);
        tall = 1000;
        if (driverScrolls)
          queueMicrotask(() => {
            window.dispatchEvent(new Event('wheel'));
            top = 300;
          });
      });
    await loaded();
    await harness.navigateByUrl('/ro/elsewhere');
    await settle();
    await harness.navigateByUrl(`/ro/garages?brand=bmw&near=${NEAR}`);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(scrolls.mock.calls).toEqual(calls);
    expect(top).toBe(driverScrolls ? 300 : 640);
    jest.restoreAllMocks();
  });

  // @traces 1356-FR-001
  it("asks for no page with the previous brand's cursor while another brand loads", async () => {
    Element.prototype.scrollTo = jest.fn();
    await loaded();

    page()
      .querySelectorAll<HTMLButtonElement>('mf-brand-chips button')[1]
      ?.click();
    await settle();
    await settle();
    await scrolledToEnd();
    await scrolledToEnd(1);

    expect(searches().at(-1)).toEqual({ brand: 'audi', log: '1', near: NEAR });
    expect(cursors()).toHaveLength(0);
    expect(button()).toBeNull();
  });

  // @traces 1356-FR-002 1356-FR-010
  it("asks for no page with the old list's cursor while the list starts again", async () => {
    await loaded();
    await scrolledToEnd();
    await reads[1]?.answer(
      pageOf({ items: garages(20, 20), nextCursor: 'c2' }),
    );
    await scrolledToEnd();
    await reads[2]?.fail(400, undefined, {
      code: 'invalid_cursor',
      message: 'cursor is not a page of this search',
    });
    await scrolledToEnd();
    await scrolledToEnd(1);

    expect(cursors().map((q) => q.cursor)).toEqual(['c1', 'c2']);
    expect(button()).toBeNull();
    await reads[3]?.answer(
      first({ items: garages(100, 20), nextCursor: 'n1' }),
    );
    await scrolledToEnd();

    expect(cursors().map((q) => q.cursor)).toEqual(['c1', 'c2', 'n1']);
  });

  // @traces 1356-FR-002 1356-FR-010
  it('asks for no page while a second start-again waits behind the first', async () => {
    await loaded();
    await scrolledToEnd();
    await reads[1]?.fail(400, undefined, {
      code: 'invalid_cursor',
      message: 'cursor is not a page of this search',
    });
    const results = harness.routeDebugElement?.componentInstance as
      | { reload(): void }
      | undefined;
    results?.reload();
    await settle();
    await reads[2]?.answer(
      first({ items: garages(100, 20), nextCursor: 'n1' }),
    );
    await scrolledToEnd();
    await scrolledToEnd(1);

    expect(cursors().map((q) => q.cursor)).toEqual(['c1']);
    await reads[3]?.answer(
      first({ items: garages(200, 20), nextCursor: 'n2' }),
    );
    await scrolledToEnd();

    expect(cursors().map((q) => q.cursor)).toEqual(['c1', 'n2']);
  });

  // @traces 1356-FR-008
  it('keeps nothing for the new brand when Results is left while it loads', async () => {
    Element.prototype.scrollTo = jest.fn();
    await loaded();
    page()
      .querySelectorAll<HTMLButtonElement>('mf-brand-chips button')[1]
      ?.click();
    await settle();
    await settle();
    await harness.navigateByUrl('/ro/elsewhere');
    await settle();
    await harness.navigateByUrl(`/ro/garages?brand=audi&near=${NEAR}`);
    await settle();

    expect(names()).toEqual([]);
    expect(searches().at(-1)).toEqual({ brand: 'audi', log: '1', near: NEAR });
  });

  it("draws the load-more button as the states' primary retry", async () => {
    await loaded();

    expect(button()?.classList).toContain('primary');
    const css = readFileSync(join(__dirname, 'results.css'), 'utf8');
    expect(css).toMatch(
      /\.more\.primary \{[^}]*background: var\(--mf-amber\);[^}]*color: var\(--mf-on-amber\);/,
    );
  });
});

// @traces 006-FR-008
describe('Results in the visit’s voice', () => {
  beforeEach(() => configure());

  afterEach(() => {
    delete document.documentElement.dataset['voice'];
  });

  it('titles the page with the voice’s list and the brand', async () => {
    document.documentElement.dataset['voice'] = '2';
    await open('/ro/garages?brand=bmw');
    await reads[0]?.answer();

    expect(said(page().querySelector('h1'))).toBe('Recomandați pentru BMW');
  });

  // @traces 006-FR-006
  it('keeps the voice in English', async () => {
    document.documentElement.dataset['voice'] = '4';
    await open('/en/garages?brand=bmw', { language: 'en' });
    await reads[0]?.answer();

    expect(said(page().querySelector('h1'))).toBe('They don’t frown at a BMW');
  });
});

// @traces 328-FR-009 328-FR-010 328-FR-011 328-FR-012 328-FR-013
describe('Results sorting', () => {
  beforeEach(async () => {
    await configure();
    Element.prototype.scrollTo = jest.fn();
    window.scrollTo = jest.fn();
  });

  afterEach(() => jest.restoreAllMocks());

  const control = () => page().querySelector('mf-sort-control');
  const buttons = () => [
    ...page().querySelectorAll<HTMLButtonElement>('mf-sort-control button'),
  ];
  const button = (name: string) => buttons().find((b) => said(b) === name);
  const pressed = () =>
    buttons()
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map(said);
  const pick = async (name: string) => {
    button(name)?.click();
    await settle();
    await settle();
  };
  const cardNames = () =>
    [...page().querySelectorAll('mf-result-card h2')].map(said);
  const PRICED = () =>
    pageOf({
      items: [
        garageOf('three', 'Atelier Trei'),
        garageOf('four', 'Service Patru'),
      ],
    });
  async function shown(url = `/ro/garages?brand=bmw&near=${NEAR}`) {
    await open(url);
    await reads[0]?.answer();
  }

  it('shows the three sorts in the row of brands, rating marked, named as a group', async () => {
    await shown();

    expect(
      page().querySelector('.brands mf-sort-control fieldset'),
    ).not.toBeNull();
    expect(
      control()?.querySelector('fieldset')?.getAttribute('aria-label'),
    ).toBe('Sortare');
    expect(buttons().map(said)).toEqual(['Notă', 'Distanță', 'Preț']);
    expect(buttons().every((b) => b.type === 'button')).toBe(true);
    expect(pressed()).toEqual(['Notă']);
  });

  it('speaks English', async () => {
    await open(`/en/garages?brand=bmw&near=${NEAR}`, { language: 'en' });
    await reads[0]?.answer();

    expect(buttons().map(said)).toEqual(['Rating', 'Distance', 'Price']);
    expect(
      control()?.querySelector('fieldset')?.getAttribute('aria-label'),
    ).toBe('Sort');
  });

  it('writes the sort into the bar as a new history entry and asks again, unlogged, from the first page', async () => {
    await shown();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

    await pick('Preț');

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { sort: 'price' },
        queryParamsHandling: 'merge',
      }),
    );
    expect(navigate.mock.calls.at(-1)?.[1]?.replaceUrl).toBeFalsy();
    expect(TestBed.inject(Router).url).toContain('sort=price');
    expect(searches().at(-1)).toEqual({
      brand: 'bmw',
      near: NEAR,
      sort: 'price',
    });
    expect(pressed()).toEqual(['Preț']);
  });

  it('writes no sort into the bar for the rating order', async () => {
    await shown(`/ro/garages?brand=bmw&near=${NEAR}&sort=price`);

    await pick('Notă');

    expect(TestBed.inject(Router).url).not.toContain('sort=');
    // Named on the request, so the change is counted as one, not a search.
    expect(searches().at(-1)).toEqual({
      brand: 'bmw',
      near: NEAR,
      sort: 'rating',
    });
  });

  it('reads the sort from the bar on the first search, logged', async () => {
    await shown(`/ro/garages?brand=bmw&near=${NEAR}&sort=distance`);

    expect(searches()).toEqual([
      { brand: 'bmw', log: '1', near: NEAR, sort: 'distance' },
    ]);
    expect(pressed()).toEqual(['Distanță']);
  });

  it('takes an unknown sort in the bar as the rating order', async () => {
    await shown(`/ro/garages?brand=bmw&near=${NEAR}&sort=newest`);

    expect(searches()).toEqual([{ brand: 'bmw', log: '1', near: NEAR }]);
    expect(pressed()).toEqual(['Notă']);
  });

  it('changes nothing for the sort already shown', async () => {
    await shown();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

    await pick('Notă');

    expect(navigate).not.toHaveBeenCalled();
    expect(searches()).toHaveLength(1);
  });

  it('keeps the old cards under the progress bar, then shows the new order with its first card selected, from the top', async () => {
    await shown();

    await pick('Preț');

    expect(cardNames()).toEqual(['Atelier Unu', 'Service Doi']);
    expect(page().querySelector('.cards.swapping')).not.toBeNull();

    await reads.at(-1)?.answer(PRICED());

    expect(page().querySelector('.cards.swapping')).toBeNull();
    expect(cardNames()).toEqual(['Atelier Trei', 'Service Patru']);
    expect(
      page()
        .querySelector('mf-result-card')
        ?.querySelector('article.card.selected'),
    ).not.toBeNull();
    expect(Element.prototype.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0 }),
    );
  });

  it('keeps the sort when the brand changes', async () => {
    await shown(`/ro/garages?brand=bmw&near=${NEAR}&sort=price`);

    page()
      .querySelectorAll<HTMLButtonElement>('mf-brand-chips button')[1]
      ?.click();
    await settle();
    await settle();

    expect(searches().at(-1)).toEqual({
      brand: 'audi',
      log: '1',
      near: NEAR,
      sort: 'price',
    });
    expect(pressed()).toEqual(['Preț']);
  });

  it('keeps the area the map was moved to', async () => {
    await shown();
    mapMoved({ bbox: '44.4,26,44.5,26.2' });
    await settle();
    await reads.at(-1)?.answer();

    await pick('Preț');

    expect(searches().at(-1)).toEqual({
      bbox: '44.4,26,44.5,26.2',
      brand: 'bmw',
      near: NEAR,
      sort: 'price',
    });
    await reads.at(-1)?.answer();

    await pick('Notă');

    expect(searches().at(-1)).toEqual({
      bbox: '44.4,26,44.5,26.2',
      brand: 'bmw',
      near: NEAR,
      sort: 'rating',
    });
  });

  it('changes a card in place on a live rating change, never re-ordering the sorted list', async () => {
    jest.useFakeTimers();
    jest.spyOn(TestBed.inject(LiveAnnouncer), 'announce').mockResolvedValue();
    await shown(`/ro/garages?brand=bmw&near=${NEAR}&sort=price`);
    const [first, second] = page().querySelectorAll('.cards > li');

    messages.next({
      at: '2026-10-11T12:00:00.000Z',
      id: 'review-9',
      kind: 'review.posted',
    });
    await jest.advanceTimersByTimeAsync(300);
    await settle();
    expect(reads).toHaveLength(2);
    expect(reads[1]?.params).toEqual(
      expect.objectContaining({ ids: 'one,two' }),
    );
    await reads[1]?.answer(
      pageOf({
        items: [
          { ...garageOf('two', 'Service Doi'), rating: 5 },
          garageOf('one', 'Atelier Unu'),
        ],
      }),
    );

    const now = page().querySelectorAll('.cards > li');
    expect(cardNames()).toEqual(['Atelier Unu', 'Service Doi']);
    expect(now[0]).toBe(first);
    expect(now[1]).toBe(second);
    expect(searches().filter((q) => !q.ids)).toHaveLength(1);
    jest.useRealTimers();
  });

  it('turns Distanță off, saying why, until a place is known, and shows the rating order meanwhile', async () => {
    // The browser is still asked for the place.
    asks = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocation,
    });
    await open('/ro/garages?brand=bmw&sort=distance', { placed: false });
    Reflect.deleteProperty(navigator, 'geolocation');

    const distance = button('Distanță');
    expect(distance?.disabled).toBe(true);
    const why = page().querySelector(
      `#${distance?.getAttribute('aria-describedby')}`,
    );
    expect(said(why)).toBe('Alege un loc');
    expect(pressed()).toEqual(['Notă']);
    expect(searches()).toEqual([]);
  });

  it('takes Notă back from a distance waiting for a place', async () => {
    asks = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocation,
    });
    await open('/ro/garages?brand=bmw&sort=distance', { placed: false });
    Reflect.deleteProperty(navigator, 'geolocation');

    await pick('Notă');

    expect(TestBed.inject(Router).url).not.toContain('sort=');
  });
});

// @traces 1398-FR-001 1398-FR-002 1398-FR-003 1398-FR-004 1398-FR-005 1398-FR-006 1398-FR-007 1398-FR-008 1398-FR-009 1398-FR-011 1398-FR-012 1398-FR-013 1398-FR-014 1398-FR-015
describe('Results filters', () => {
  beforeEach(async () => {
    brandsApi.popularBrandsControllerTiles.mockClear();
    await configure();
    Element.prototype.scrollTo = jest.fn();
    window.scrollTo = jest.fn();
  });

  afterEach(() => {
    pinsApi.mockImplementation((_params) => Promise.resolve(pinsAnswer));
    jest.restoreAllMocks();
  });

  type PanelData = {
    filters: () => Filters;
    change: (patch: Partial<Filters>) => void;
  };
  const opener = () =>
    page().querySelector<HTMLButtonElement>(
      '.brands .filters button.filters-open',
    );
  const chips = () => [
    ...page().querySelectorAll<HTMLButtonElement>(
      '.brands .filters button.chip.filter',
    ),
  ];
  const tally = () => said(page().querySelector('.summary .tally'));
  const pinsAsked = () => pinsApi.mock.calls.map(([q]) => q);
  const url = () => TestBed.inject(Router).url;
  const BOX = '44.4,26,44.5,26.2';
  async function shown(
    bar = `/ro/garages?brand=bmw&near=${NEAR}`,
    answer = pageOf(),
  ) {
    await open(bar);
    await reads[0]?.answer(answer);
  }
  async function panel(): Promise<PanelData> {
    opener()?.click();
    await settle();
    const options = (overlays.open.mock.calls.at(-1) as unknown[])[1] as {
      data: PanelData;
    };
    return options.data;
  }
  async function toggled(key: SwitchKey) {
    const data = await panel();
    data.change({ [key]: !data.filters()[key] });
    await settle();
    await settle();
    return data;
  }

  describe('the Filtre button and the panel', () => {
    it('sets the filters line between the brand search and the sorts', async () => {
      await shown();
      const order = [...(page().querySelector('.brands')?.children ?? [])].map(
        (el) =>
          el.tagName.toLowerCase() + (el.className ? `.${el.className}` : ''),
      );
      expect(order).toEqual([
        'mf-brand-chips',
        'mf-brand-search',
        'div.filters',
        'mf-sort-control',
      ]);
    });

    it('reads "Filtre" with none on and "Filtre · 2" with both, opening a dialog', async () => {
      await shown();
      expect(said(opener())).toBe('Filtre');
      expect(opener()?.getAttribute('aria-haspopup')).toBe('dialog');
      expect(opener()?.type).toBe('button');

      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&open_saturday=1`,
      );
      expect(said(opener())).toBe('Filtre · 2');
    });

    it('speaks English', async () => {
      await open(`/en/garages?brand=bmw&near=${NEAR}&open_now=1`, {
        language: 'en',
      });
      await reads[0]?.answer();

      expect(said(opener())).toBe('Filters · 1');
      expect(said(chips()[0])).toBe('Open now ×');
      expect(chips()[0]?.getAttribute('aria-label')).toBe(
        'Remove filter Open now',
      );
    });

    it('opens the panel, loaded on demand, as a dialog that asks nothing on close', async () => {
      await shown();

      await panel();

      expect(overlays.open).toHaveBeenCalledTimes(1);
      const [source, options] = overlays.open.mock.calls[0] as unknown as [
        () => Promise<unknown>,
        Record<string, unknown>,
      ];
      await expect(source()).resolves.toBe(FiltersPanel);
      expect(options).toEqual(
        expect.objectContaining({
          confirmDiscard: false,
          shape: 'dialog',
          title: 'public.results.filters.title',
        }),
      );
    });

    it('hands the panel the filters the bar holds', async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&open_saturday=1`);

      const data = await panel();

      expect(data.filters()).toEqual({
        card: false,
        open_now: false,
        open_saturday: true,
      });
    });

    it('gives the focus back to the Filtre button when the panel closes', async () => {
      await shown();
      await panel();

      dialog('cancelled');
      await settle();
      await settle();

      expect(document.activeElement).toBe(opener());
    });
  });

  describe('the address bar', () => {
    it('writes open_now=1 as a history step, keeping brand and place', async () => {
      await shown();
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

      await toggled('open_now');

      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: { brand: 'bmw', near: NEAR, open_now: '1' },
        }),
      );
      expect(navigate.mock.calls.at(-1)?.[1]?.replaceUrl).toBeFalsy();
      expect(url()).toBe(`/ro/garages?brand=bmw&near=${NEAR}&open_now=1`);
    });

    it("names the filters in the page's order, whichever went on first", async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&open_saturday=1`);

      await toggled('open_now');

      expect(url()).toBe(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&open_saturday=1`,
      );
    });

    it('drops the key when the filter goes off, never writing 0', async () => {
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&open_saturday=1`,
      );

      await toggled('open_now');

      expect(url()).toBe(`/ro/garages?brand=bmw&near=${NEAR}&open_saturday=1`);
      expect(url()).not.toContain('=0');
    });

    it('restores both filters from a link: chips, count and the first request', async () => {
      await open(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&open_saturday=1`,
      );

      expect(searches()[0]).toEqual({
        brand: 'bmw',
        log: '1',
        near: NEAR,
        open_now: '1',
        open_saturday: '1',
      });
      await reads[0]?.answer();
      expect(chips().map((c) => c.dataset['filter'])).toEqual([
        'open_now',
        'open_saturday',
      ]);
      expect(chips().map(said)).toEqual([
        'Deschis acum ×',
        'Deschis sâmbăta ×',
      ]);
    });

    it.each(['open_now=yes', 'open_now=', 'open_now=0'])(
      'reads %s as off, sends nothing and leaves the bar as it is',
      async (value) => {
        await shown(`/ro/garages?brand=bmw&near=${NEAR}&${value}`);

        expect(searches()[0]).not.toHaveProperty('open_now');
        expect(pinsAsked()[0]).not.toHaveProperty('open_now');
        expect(chips()).toHaveLength(0);
        expect(said(opener())).toBe('Filtre');
        expect(url()).toContain(value);
      },
    );

    // @traces 1399-FR-002
    // @traces 1399-FR-003
    // @traces 1399-FR-004
    it('restores the price, rating and card filters from a link: chips, count and the requests', async () => {
      await open(
        `/ro/garages?brand=bmw&near=${NEAR}&max_price=200&min_rating=4.5&card=1`,
      );

      expect(searches()[0]).toEqual({
        brand: 'bmw',
        card: '1',
        log: '1',
        max_price: 200,
        min_rating: '4.5',
        near: NEAR,
      });
      expect(pinsAsked()[0]).toEqual({
        brand: 'bmw',
        card: '1',
        max_price: 200,
        min_rating: '4.5',
        near: NEAR,
      });
      await reads[0]?.answer();
      expect(said(opener())).toBe('Filtre · 3');
      expect(chips().map((c) => c.dataset['filter'])).toEqual([
        'max_price',
        'min_rating',
        'card',
      ]);
      expect(chips().map(said)).toEqual([
        'Până la 200 lei/oră ×',
        'Notă 4,5+ ×',
        'Plată cu cardul ×',
      ]);
      expect(chips()[1]?.getAttribute('aria-label')).toBe(
        'Scoate filtrul Notă 4,5+',
      );
    });

    // @traces 1399-FR-003
    it('writes a choice in the page order, as a history step without logging', async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&card=1&open_now=1`);

      const data = await panel();
      data.change({ max_price: 250 });
      await settle();
      await settle();

      expect(url()).toBe(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&max_price=250&card=1`,
      );
      expect(searches().at(-1)).not.toHaveProperty('log');

      data.change({ max_price: undefined });
      await settle();
      await settle();
      expect(url()).toBe(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&card=1`,
      );
    });

    it.each(['max_price=175', 'min_rating=4', 'card=yes'])(
      'reads %s as off and sends nothing for it',
      async (value) => {
        await shown(`/ro/garages?brand=bmw&near=${NEAR}&${value}`);

        expect(searches()[0]).toEqual({ brand: 'bmw', log: '1', near: NEAR });
        expect(chips()).toHaveLength(0);
        expect(url()).toContain(value);
      },
    );

    it('lets the first value of a repeated key decide', async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&open_now=1&open_now=yes`);

      expect(searches()[0]).toEqual(expect.objectContaining({ open_now: '1' }));
    });

    it('keeps the filters and the chip across a brand change', async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&open_now=1`);
      await settle();
      const audi = [
        ...page().querySelectorAll<HTMLButtonElement>('mf-brand-chips button'),
      ].find((b) => said(b) === 'Audi');

      audi?.click();
      await settle();
      await settle();

      expect(url()).toBe(`/ro/garages?brand=audi&near=${NEAR}&open_now=1`);
      expect(searches().at(-1)).toEqual({
        brand: 'audi',
        log: '1',
        near: NEAR,
        open_now: '1',
      });
      expect(chips().map(said)).toEqual(['Deschis acum ×']);
    });

    it('keeps the filters across a place change, which still logs', async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&open_saturday=1`);
      page().querySelector<HTMLButtonElement>('.summary .change')?.click();
      await settle();

      dialog({ ...PLACE, lat: 46.7712, lng: 23.6236 });
      await settle();
      await settle();

      expect(url()).toContain('open_saturday=1');
      expect(searches().at(-1)).toEqual(
        expect.objectContaining({ log: '1', open_saturday: '1' }),
      );
    });

    it('keeps the map box on a filter change, as a sort change does', async () => {
      // The kept place, rounded as the bar names it.
      const KEPT = '44.447,26.117';
      keep(PLACE);
      await shown('/ro/garages?brand=bmw');
      mapMoved({ bbox: BOX });
      await settle();
      await reads[1]?.answer();

      await toggled('open_now');

      expect(searches().at(-1)).toEqual({
        bbox: BOX,
        brand: 'bmw',
        near: KEPT,
        open_now: '1',
      });
      expect(pinsAsked().at(-1)).toEqual({
        bbox: BOX,
        brand: 'bmw',
        near: KEPT,
        open_now: '1',
      });
    });
  });

  describe('the chips', () => {
    it('removes a filter from its chip, named "Scoate filtrul …"', async () => {
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&open_saturday=1`,
      );
      const [now] = chips();
      expect(now?.getAttribute('aria-label')).toBe(
        'Scoate filtrul Deschis acum',
      );
      expect(now?.querySelector('[aria-hidden="true"]')?.textContent).toBe('×');
      expect(now?.type).toBe('button');

      now?.click();
      await settle();
      await settle();

      expect(url()).toBe(`/ro/garages?brand=bmw&near=${NEAR}&open_saturday=1`);
      expect(chips().map((c) => c.dataset['filter'])).toEqual([
        'open_saturday',
      ]);
    });

    // @traces 1399-FR-002
    it('gives the focus to the Filtre button once a chip removes its filter', async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&max_price=150`);

      chips()[0]?.focus();
      chips()[0]?.click();
      await settle();
      await settle();

      expect(url()).toBe(`/ro/garages?brand=bmw&near=${NEAR}`);
      expect(chips()).toHaveLength(0);
      expect(document.activeElement).toBe(opener());
    });

    it('shows no chip with no filter on', async () => {
      await shown();
      expect(chips()).toHaveLength(0);
    });
  });

  describe('the requests', () => {
    it('asks the list and the pins with the filter on', async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&open_now=1`);

      expect(searches()[0]).toEqual({
        brand: 'bmw',
        log: '1',
        near: NEAR,
        open_now: '1',
      });
      expect(pinsAsked()[0]).toEqual({
        brand: 'bmw',
        near: NEAR,
        open_now: '1',
      });
    });

    // @traces 1399-FR-004
    it('asks the next page with the cursor and the filters', async () => {
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_saturday=1&max_price=250&min_rating=3.5&card=1`,
        pageOf({ nextCursor: 'c1' }),
      );

      page().querySelector<HTMLButtonElement>('button.more')?.click();
      await settle();

      expect(searches().at(-1)).toEqual({
        brand: 'bmw',
        card: '1',
        cursor: 'c1',
        max_price: 250,
        min_rating: '3.5',
        near: NEAR,
        open_saturday: '1',
      });
    });

    // @traces 1399-FR-004
    it('reads a pin outside the list by ids= with no filter', async () => {
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&max_price=150&min_rating=4.5&card=1`,
      );

      mapPicked('pin-3');
      await settle();

      expect(reads.at(-1)?.params).toEqual({
        brand: 'bmw',
        ids: 'pin-3',
        near: NEAR,
      });
    });

    it('logs no search and marks no sort change on a toggle', async () => {
      await shown();

      await toggled('open_saturday');

      expect(searches().at(-1)).toEqual({
        brand: 'bmw',
        near: NEAR,
        open_saturday: '1',
      });
    });

    it('sends nothing new with no filter on', async () => {
      await shown();
      expect(searches()[0]).toEqual({ brand: 'bmw', log: '1', near: NEAR });
      expect(pinsAsked()[0]).toEqual({ brand: 'bmw', near: NEAR });
    });
  });

  describe('the summary', () => {
    it('reads the found pins, the filtered total, then the two groups', async () => {
      pinsAnswer = pinsOf(5);
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1`,
        pageOf({ counts: { doesNotTake: 1, worksOn: 1 }, total: 2 }),
      );

      expect(tally()).toBe(
        '5 service‑uri găsite · 2 cu filtrele alese · 1 lucrează pe BMW · 1 nu o primește',
      );
    });

    it('starts at the filtered total while the pins have not answered', async () => {
      pinsApi.mockImplementation(() => new Promise(() => undefined));
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1`,
        pageOf({ counts: { doesNotTake: 1, worksOn: 1 }, total: 2 }),
      );

      expect(tally()).toBe(
        '2 cu filtrele alese · 1 lucrează pe BMW · 1 nu o primește',
      );
    });

    it('keeps the line when nothing has every filter chosen', async () => {
      pinsAnswer = pinsOf(3);
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1`,
        pageOf({ counts: { doesNotTake: 0, worksOn: 0 }, items: [], total: 0 }),
      );

      expect(tally()).toMatch(/^3 service‑uri găsite · 0 cu filtrele alese · /);
    });

    it('reads as today with no filter on', async () => {
      await shown();
      expect(tally()).toBe(
        '48 de service‑uri găsite · 31 lucrează pe BMW · 17 nu o primesc',
      );
    });
  });

  describe('when nothing has everything chosen', () => {
    const none = () =>
      pageOf({ counts: { doesNotTake: 0, worksOn: 0 }, items: [], total: 0 });
    const state = () => page().querySelector('section.state.filtered');

    it('says so and offers "Scoate filtrele" while the search found garages', async () => {
      pinsAnswer = pinsOf(3);
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&open_saturday=1`,
        none(),
      );

      expect(said(state()?.querySelector('h2'))).toBe(
        'Niciun service nu are tot ce ai ales',
      );
      expect(said(state()?.querySelector('button.primary'))).toBe(
        'Scoate filtrele',
      );
    });

    it('clears both filters in one write, without logging', async () => {
      pinsAnswer = pinsOf(3);
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&open_saturday=1`,
        none(),
      );
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

      state()?.querySelector<HTMLButtonElement>('button.primary')?.click();
      await settle();
      await settle();

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(url()).toBe(`/ro/garages?brand=bmw&near=${NEAR}`);
      expect(searches().at(-1)).toEqual({ brand: 'bmw', near: NEAR });
    });

    // @traces 1399-FR-007
    it('clears all five filters in one write, without logging', async () => {
      pinsAnswer = pinsOf(3);
      await shown(
        `/ro/garages?brand=bmw&near=${NEAR}&open_now=1&open_saturday=1&max_price=150&min_rating=3.5&card=1`,
        none(),
      );

      state()?.querySelector<HTMLButtonElement>('button.primary')?.click();
      await settle();
      await settle();

      expect(url()).toBe(`/ro/garages?brand=bmw&near=${NEAR}`);
      expect(searches().at(-1)).toEqual({ brand: 'bmw', near: NEAR });
    });

    it('shows the state while the pins have not answered', async () => {
      pinsApi.mockImplementation(() => new Promise(() => undefined));
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&open_now=1`, none());

      expect(state()).not.toBeNull();
    });

    it("shows today's nothing-near state when the pins found nothing", async () => {
      pinsAnswer = pinsOf(0);
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&open_now=1`, none());

      expect(state()).toBeNull();
      expect(said(page().querySelector('section.state h2'))).toBe(
        'Niciun service în 25 km',
      );
    });

    it("shows today's nothing-near state with no filter on", async () => {
      pinsAnswer = pinsOf(3);
      await shown(`/ro/garages?brand=bmw&near=${NEAR}`, none());

      expect(state()).toBeNull();
      expect(said(page().querySelector('section.state h2'))).toBe(
        'Niciun service în 25 km',
      );
    });
  });

  describe('while a filter change loads', () => {
    it('dims the previous cards under a "Se filtrează…" bar, with no skeletons', async () => {
      await shown();

      await toggled('open_now');

      expect(page().querySelector('.cards.swapping[inert]')).not.toBeNull();
      expect(
        page()
          .querySelector('.progress[role="progressbar"]')
          ?.getAttribute('aria-label'),
      ).toBe('Se filtrează…');
      expect(page().querySelector('.card.skeleton')).toBeNull();
      expect(opener()?.disabled).toBeFalsy();
      expect(chips().map(said)).toEqual(['Deschis acum ×']);
    });

    it('selects the first card of the filtered answer', async () => {
      await shown();
      await toggled('open_now');

      await reads
        .at(-1)
        ?.answer(pageOf({ items: [garageOf('two', 'Service Doi')], total: 1 }));

      expect(page().querySelector('.cards.swapping')).toBeNull();
      const selected = [...page().querySelectorAll('mf-result-card')].filter(
        (card) => card.querySelector('article.card.selected'),
      );
      expect(selected.map((card) => said(card.querySelector('h2')))).toEqual([
        'Service Doi',
      ]);
    });
  });

  describe('the warm of "Deschis acum"', () => {
    it('warms once after the unfiltered first page lands', async () => {
      await open(`/ro/garages?brand=bmw&near=${NEAR}`);
      expect(warmer.warm).not.toHaveBeenCalled();

      await reads[0]?.answer();
      await settle();

      expect(warmer.warm).toHaveBeenCalledTimes(1);
      expect(warmer.warm).toHaveBeenCalledWith({ brand: 'bmw', near: NEAR });
    });

    it('warms nothing with a filter on', async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&open_saturday=1`);
      await settle();
      expect(warmer.warm).not.toHaveBeenCalled();
    });

    it('warms nothing for a map box', async () => {
      keep(PLACE);
      await shown('/ro/garages?brand=bmw');
      warmer.warm.mockClear();

      mapMoved({ bbox: BOX });
      await settle();
      await reads[1]?.answer();
      await settle();

      expect(warmer.warm).not.toHaveBeenCalled();
    });

    it('judges the warm when the next state is "Deschis acum" alone', async () => {
      await shown();

      await toggled('open_now');

      expect(warmer.judge).toHaveBeenCalledTimes(1);
      expect(warmer.judge).toHaveBeenCalledWith({ brand: 'bmw', near: NEAR });
    });

    // @traces 1399-FR-006
    it('judges nothing when "Deschis acum" joins another filter, and warms nothing with one on', async () => {
      await shown(`/ro/garages?brand=bmw&near=${NEAR}&card=1`);
      await settle();
      expect(warmer.warm).not.toHaveBeenCalled();

      await toggled('open_now');

      expect(warmer.judge).not.toHaveBeenCalled();
    });

    it('judges nothing for "Deschis sâmbăta"', async () => {
      await shown();

      await toggled('open_saturday');

      expect(warmer.judge).not.toHaveBeenCalled();
    });
  });
});

describe('the pill buttons on the 4 px grid', () => {
  // The Jest transform drops component styles, so they are read from the source.
  const css = readFileSync(join(__dirname, 'results.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
  const rule = (selector: string) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, sel]) => sel.trim() === selector,
    )?.[2] ?? '';

  // A button keeps the browser's 1px block padding unless the rule sets it:
  // QA measured "Filtre · 3", the filter chips and "Scoate filtrele" at 1px 16px.
  it.each(['.filters-open', '.chip', '.actions > *, .more'])(
    'sets the block padding of %s to zero beside its 16px sides',
    (selector) => {
      expect(rule(selector)).toMatch(/padding: 0 var\(--mf-space-4\);/);
      expect(rule(selector)).not.toMatch(/padding-inline:/);
    },
  );
});

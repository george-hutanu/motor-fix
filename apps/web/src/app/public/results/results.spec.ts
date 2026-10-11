import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Route, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  type GarageSearchControllerForBrand$Params,
  type GarageSearchPageDto,
  type ListedGarageDto,
  SearchService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { Results } from './results';
import { routes } from '../../app.routes';
import { PlaceDialog } from '../../home/place/place-dialog/place-dialog';
import type { Place } from '../../home/place/place-store';
import { PublicFrame } from '../frame/frame';

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
};
let reads: Read[];
const searchApi = {
  garageSearchControllerForBrand: jest.fn(
    (params: GarageSearchControllerForBrand$Params) =>
      new Promise<GarageSearchPageDto>((resolve) => {
        reads.push({
          answer: async (page = pageOf()) => {
            resolve(page);
            await settle();
          },
          params,
        });
      }),
  ),
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

let harness: RouterTestingHarness;

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  harness.detectChanges();
}

async function configure(platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ component: Results, path: ':lang/garages' }]),
      { provide: SearchService, useValue: searchApi },
      { provide: Overlays, useValue: overlays },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  harness = await RouterTestingHarness.create();
}

beforeEach(() => {
  reads = [];
  localStorage.clear();
  searchApi.garageSearchControllerForBrand.mockClear();
  overlays.open.mockClear();
});

async function open(url: string, { language = 'ro' as 'ro' | 'en' } = {}) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  await harness.navigateByUrl(url);
  await settle();
}

const page = () => harness.routeNativeElement as HTMLElement;
const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const searches = () =>
  searchApi.garageSearchControllerForBrand.mock.calls.map(([q]) => q);
const keep = (place: Place) =>
  localStorage.setItem('mf-place', JSON.stringify(place));

describe('Results', () => {
  describe('in the browser', () => {
    beforeEach(() => configure());

    // @traces 267-brand-results-FR-012
    it('reads the brand from the address bar and runs one logged search, with no place', async () => {
      await open('/ro/garages?brand=bmw');

      expect(searches()).toEqual([{ brand: 'bmw', log: '1' }]);
    });

    // @traces 267-brand-results-FR-012
    it('asks by id when the bar names the brand by its id', async () => {
      await open('/ro/garages?brand=6f1c0a52-3b7e-4c1d-9a2f-0e8b7d6c5a41');

      expect(searches()).toEqual([
        { brandId: '6f1c0a52-3b7e-4c1d-9a2f-0e8b7d6c5a41', log: '1' },
      ]);
    });

    // @traces 267-brand-results-FR-012
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

    // @traces 267-brand-results-FR-012
    it('takes the place in the bar over the kept one, and the wider radius with it', async () => {
      keep(PLACE);

      await open('/ro/garages?brand=bmw&near=46.77,23.59&radius=50');

      expect(searches()).toEqual([
        { brand: 'bmw', log: '1', near: '46.77,23.59', radius: 50 },
      ]);
    });

    // @traces 267-brand-results-FR-012
    it('leaves the radius out without a place', async () => {
      await open('/ro/garages?brand=bmw&radius=50');

      expect(searches()).toEqual([{ brand: 'bmw', log: '1' }]);
    });

    // @traces 267-brand-results-FR-016
    it('shows six skeleton cards while the search runs', async () => {
      await open('/ro/garages?brand=bmw');

      expect(page().querySelectorAll('.card.skeleton')).toHaveLength(6);
      expect(page().querySelector('mf-result-card')).toBeNull();
    });

    // @traces 267-brand-results-FR-013
    it('titles the page with the brand and sums up the two groups', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();

      expect(said(page().querySelector('h1'))).toBe('Service‑uri pentru BMW');
      expect(said(page().querySelector('.summary .tally'))).toBe(
        '48 de service‑uri găsite · 31 lucrează pe BMW · 17 nu o primesc',
      );
    });

    // @traces 267-brand-results-FR-013
    it('follows the Romanian plural rules in the summary', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer(
        pageOf({ counts: { doesNotTake: 1, worksOn: 2 }, total: 3 }),
      );

      expect(said(page().querySelector('.summary .tally'))).toBe(
        '3 service‑uri găsite · 2 lucrează pe BMW · 1 nu o primește',
      );
    });

    // @traces 267-brand-results-FR-013
    it('names the area of the kept place, at 25 km by default', async () => {
      keep(PLACE);
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();

      expect(said(page().querySelector('.summary .area'))).toBe(
        'în 25 km de Strada Lizeanu 2, București',
      );
    });

    // @traces 267-brand-results-FR-013
    it('says no area without a place', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();

      expect(page().querySelector('.summary .tally')).not.toBeNull();
      expect(page().querySelector('.summary .area')).toBeNull();
    });

    // @traces 267-brand-results-FR-013
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

    // @traces 267-brand-results-FR-014
    it('shows one card per garage, in the order the search gave', async () => {
      await open('/ro/garages?brand=bmw');
      await reads[0]?.answer();

      const cards = [...page().querySelectorAll('mf-result-card')];
      expect(cards.map((card) => said(card.querySelector('h3')))).toEqual([
        'Atelier Unu',
        'Service Doi',
      ]);
      expect(page().querySelector('.card.skeleton')).toBeNull();
    });

    // @traces 267-brand-results-FR-013
    it('speaks English', async () => {
      await open('/en/garages?brand=bmw', { language: 'en' });
      await reads[0]?.answer(
        pageOf({ counts: { doesNotTake: 1, worksOn: 31 }, total: 32 }),
      );

      expect(said(page().querySelector('h1'))).toBe('Garages for BMW');
      expect(said(page().querySelector('.summary .tally'))).toBe(
        "32 garages found · 31 work on BMW · 1 doesn't take it",
      );
    });
  });

  describe('on the server', () => {
    beforeEach(() => configure('server'));

    // @traces 267-brand-results-FR-016
    it('renders six skeleton cards and never searches', async () => {
      await open('/ro/garages?brand=bmw');

      expect(searches()).toEqual([]);
      expect(page().querySelectorAll('.card.skeleton')).toHaveLength(6);
    });
  });

  // @traces 267-brand-results-FR-012
  // @traces 267-brand-results-FR-015
  it('is served at /:lang/garages inside the public frame, in place of the placeholder', async () => {
    const lang = routes.find((route) => route.path === ':lang') as Route;
    const garages = lang.children?.find((route) => route.path === 'garages');

    expect(garages?.component).toBeUndefined();
    expect(await garages?.loadComponent?.()).toBe(Results);
    expect(await lang.loadComponent?.()).toBe(PublicFrame);
  });
});

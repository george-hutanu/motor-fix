import { LiveAnnouncer } from '@angular/cdk/a11y';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Route, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type GarageSearchControllerForBrand$Params,
  type GarageSearchPageDto,
  type ListedGarageDto,
  SearchService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { Results } from './results';
import { routes } from '../../app.routes';
import { PlaceDialog } from '../../home/place/place-dialog/place-dialog';
import type { Place } from '../../home/place/place-store';
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

const messages = new Subject<LiveMessage>();
const resync = new Subject<void>();
const live = {
  on: (kinds: readonly EventKind[]) =>
    messages.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  register: jest.fn((_view: unknown) => () => undefined),
  resync,
};
const reduced = signal(false);

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
      { provide: PublicLive, useValue: live },
      { provide: REDUCED_MOTION, useValue: reduced },
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
  live.register.mockClear();
  reduced.set(false);
});

afterEach(() => jest.useRealTimers());

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
    const names = () => cards().map((card) => said(card.querySelector('h3')));
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

    // @traces 267-brand-results-FR-018
    it('opens the stream with every loaded garage and the brand', async () => {
      await loaded();

      expect(live.register).toHaveBeenLastCalledWith({
        brand: 'b-bmw',
        garages: ['one', 'two'],
      });
    });

    // @traces 267-brand-results-FR-019
    // @traces 267-brand-results-FR-021
    it('re-reads the loaded cards through ids= on a review kind and changes them in place, highlighted and announced', async () => {
      const announce = quietly();
      await loaded();
      const [first, second] = cards();
      const focused = document.activeElement;

      send('review.posted', 'review-9');
      send('review.edited', 'review-9');
      await coalesce();

      expect(reads).toHaveLength(2);
      expect(reads[1]?.params).toEqual({ brand: 'bmw', ids: 'one,two' });
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

    // @traces 267-brand-results-FR-019
    it('re-reads only the loaded garages an update or a restoration names, in one read for a burst', async () => {
      await loaded();

      send('garage.updated', 'two');
      send('garage.restored', 'one');
      await coalesce();

      expect(reads).toHaveLength(2);
      expect(reads[1]?.params.ids?.split(',').sort()).toEqual(['one', 'two']);
      expect(reads[1]?.params).not.toHaveProperty('log');
    });

    // @traces 267-brand-results-FR-019
    it('keeps the order of the list when a re-read gives the cards in another order', async () => {
      await loaded();

      send('garage.updated', 'one');
      await coalesce();
      expect(reads[1]?.params).toEqual({ brand: 'bmw', ids: 'one' });
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

    // @traces 267-brand-results-FR-019
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
      expect(reads[2]?.params).toEqual({ brand: 'bmw', ids: 'two' });
    });

    // @traces 267-brand-results-FR-021
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

    // @traces 267-brand-results-FR-019
    it('fades a suspended card out over 300 ms, then removes it and lowers the counts by one', async () => {
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
      expect(tally()).toBe(
        '47 de service‑uri găsite · 30 lucrează pe BMW · 17 nu o primesc',
      );
      expect(announce).toHaveBeenCalledWith(
        'Atelier Unu nu mai apare în listă',
        'polite',
      );
      expect(reads).toHaveLength(1);
    });

    // @traces 267-brand-results-FR-019
    it('removes a suspended card at once under reduced motion', async () => {
      reduced.set(true);
      await loaded();

      send('garage.suspended', 'two');
      await settle();

      expect(names()).toEqual(['Atelier Unu']);
    });

    // @traces 267-brand-results-FR-020
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
        expect(reads[1]?.params).toEqual({ brand: 'bmw' });
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

    // @traces 267-brand-results-FR-020
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

    // @traces 267-brand-results-FR-020
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
      expect(reads[2]?.params).toEqual({ brand: 'bmw' });
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
      expect(router.url).toBe('/ro/garages?brand=bmw');
    });

    // @traces 267-brand-results-FR-018
    // @traces 267-brand-results-FR-019
    // @traces 267-brand-results-FR-020
    it('re-reads the cards and the counts on each re-open of the stream', async () => {
      await loaded();

      resync.next();
      await settle();
      await reads[1]?.answer();
      await settle();

      expect(reads.slice(1).map((read) => read.params)).toEqual(
        expect.arrayContaining([
          { brand: 'bmw', ids: 'one,two' },
          { brand: 'bmw' },
        ]),
      );
      expect(reads).toHaveLength(3);
    });

    // @traces 267-brand-results-FR-021
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

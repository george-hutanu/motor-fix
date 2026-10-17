import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type GaragePinsDto,
  type GarageSearchControllerForBrand$Params,
  type GarageSearchControllerPins$Params,
  type GarageSearchPageDto,
  type ListedGarageDto,
  SearchService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { Results } from './results';
import type { MapEvents, MapMove } from './results-map/pins-map';
import { RESULTS_MAP, type ResultsMapView } from './results-map/results-map';
import type { Place } from '../../home/place/place-store';
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
  fail: (status?: number) => Promise<void>;
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
          fail: async (status = 500) => {
            reject(new HttpErrorResponse({ status }));
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
let _dialog: (value: OverlayResult<Place>) => void;
const overlays = {
  open: jest.fn(
    () =>
      new Promise<OverlayResult<Place>>((resolve) => {
        _dialog = resolve;
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
      { provide: RESULTS_MAP, useValue: openMap },
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
  openMap.mockClear();
  mapView.show.mockClear();
  mapView.fit.mockClear();
  mapView.light.mockClear();
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
const _searches = () =>
  searchApi.garageSearchControllerForBrand.mock.calls.map(([q]) => q);
const keep = (place: Place) =>
  localStorage.setItem('mf-place', JSON.stringify(place));

// @traces 270-card-pin-link-FR-001 270-card-pin-link-FR-004 270-card-pin-link-FR-005 270-card-pin-link-FR-006 270-card-pin-link-FR-009 270-card-pin-link-FR-010
describe('Results, a card and its pin, under attack', () => {
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
  async function point(name: string, type: string) {
    host(name)?.dispatchEvent(pointer(type));
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

  it('lights the card entered last when the pointer enters one card before leaving the other', async () => {
    await loaded();

    await point('Atelier Unu', 'pointerenter');
    await point('Service Doi', 'pointerenter');
    await point('Atelier Unu', 'pointerleave');

    expect(lit()).toBe('two');
  });

  it('scrolls to the card of a tapped pin even when that garage is already selected', async () => {
    await loaded();
    await picked('one');
    scroll.mockClear();

    await picked('one');

    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('keeps the small card garage selected when another card fades out', async () => {
    await loaded();
    await picked('pin-3');

    send('garage.suspended', 'one');
    await jest.advanceTimersByTimeAsync(300);
    await settle();

    expect(lit()).toBe('pin-3');
    expect(amber()).toEqual([]);
  });

  it('keeps the small card pin lit once the pointer has passed over a card and left', async () => {
    await loaded();
    await picked('pin-3');

    await point('Service Doi', 'pointerenter');
    await point('Service Doi', 'pointerleave');

    expect(lit()).toBe('pin-3');
    expect(small()).not.toBeNull();
  });

  it('closes the small card for a pin tapped twice only when something else is chosen, asking once', async () => {
    await loaded();

    await picked('pin-3');
    await picked('pin-3');

    expect(small()).not.toBeNull();
    expect(
      reads.filter((r) => r.params.ids === 'pin-3').length,
    ).toBeLessThanOrEqual(2);
    expect(amber()).toEqual([]);
  });

  it('does not reopen the small card when its read answers after a card was tapped', async () => {
    await loaded();
    await picked('pin-3');
    await tap('Service Doi');

    await reads[1]?.answer(
      pageOf({ items: [garageOf('pin-3', 'Service Trei')] }),
    );

    expect(small()).toBeNull();
    expect(amber()).toEqual(['Service Doi']);
    expect(lit()).toBe('two');
  });

  it('closes the small card when the list is replaced by the same brand again', async () => {
    keep(PLACE);
    await loaded();
    await picked('pin-3');

    mapMoved({ bbox: '44.4,26,44.5,26.2' });
    await settle();
    await reads[2]?.answer();

    expect(small()).toBeNull();
    expect(amber()).toEqual(['Atelier Unu']);
  });

  it('passes the selection on when a card faded out was both pointed and selected', async () => {
    await loaded();
    await point('Atelier Unu', 'pointerenter');

    send('garage.suspended', 'one');
    await jest.advanceTimersByTimeAsync(300);
    await settle();

    expect(amber()).toEqual(['Service Doi']);
    expect(lit()).toBe('two');
  });

  it('keeps one amber card after a card was tapped in the middle of a failing re-read', async () => {
    await loaded();
    await tap('Service Doi');

    send('garage.updated', 'two');
    await jest.advanceTimersByTimeAsync(300);
    await settle();
    await reads[1]?.fail();

    expect(amber()).toEqual(['Service Doi']);
    expect(lit()).toBe('two');
  });

  it('selects nothing and lights nothing when the first list fails', async () => {
    await open('/ro/garages?brand=bmw');
    await reads[0]?.fail();

    expect(amber()).toEqual([]);
    expect(lit()).toBeUndefined();
  });

  it('lights nothing on the server', async () => {
    TestBed.resetTestingModule();
    await configure('server');
    await open('/ro/garages?brand=bmw');
    await reads[0]?.answer();

    expect(amber()).toEqual([]);
    expect(openMap).not.toHaveBeenCalled();
  });

  it('handles a hostile pin id without touching the list selection', async () => {
    await loaded();

    await picked('__proto__');

    expect(amber()).toEqual([]);
    expect(page().querySelector('[role="alert"]')).toBeNull();
  });

  it('selects the first card of a one-garage list, and nothing once it is gone from a refresh to none', async () => {
    await loaded(
      '/ro/garages?brand=bmw',
      pageOf({ items: [garageOf('one', 'Atelier Unu')] }),
    );

    expect(amber()).toEqual(['Atelier Unu']);

    await open('/ro/garages?brand=audi');
    await reads[1]?.answer(
      pageOf({ counts: { doesNotTake: 0, worksOn: 0 }, items: [], total: 0 }),
    );

    expect(amber()).toEqual([]);
    expect(lit()).toBeUndefined();
  });
});

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { type Place, PlaceStore, parsePlace } from './place-store';

const KEY = 'mf-place';
const CLUJ: Place = {
  label: 'Strada Exemplu 2, Cluj-Napoca',
  lat: 46.771,
  lng: 23.624,
  origin: 'address',
};

function store(platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  return TestBed.inject(PlaceStore);
}

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

describe('parsePlace', () => {
  it('reads a place chosen from an address and one from the location', () => {
    expect(parsePlace(CLUJ)).toEqual(CLUJ);
    const here = { label: null, lat: 44.427, lng: 26.103, origin: 'location' };
    expect(parsePlace(here)).toEqual(here);
  });

  it.each([
    ['nothing', null],
    ['a string', 'Cluj'],
    ['no latitude', { ...CLUJ, lat: undefined }],
    ['a latitude in text', { ...CLUJ, lat: '46.771' }],
    ['an infinite longitude', { ...CLUJ, lng: Number.POSITIVE_INFINITY }],
    ['no origin', { ...CLUJ, origin: undefined }],
    ['an unknown origin', { ...CLUJ, origin: 'city' }],
    ['a label of 201 characters', { ...CLUJ, label: 'a'.repeat(201) }],
    ['a label that is a number', { ...CLUJ, label: 5 }],
    ['a point in Budapest', { ...CLUJ, lat: 47.498, lng: 19.04 }],
    ['a point at sea', { ...CLUJ, lat: 0, lng: 0 }],
  ])('drops %s', (_, value) => {
    expect(parsePlace(value)).toBeNull();
  });

  it('keeps a label of 200 characters', () => {
    const label = 'a'.repeat(200);
    expect(parsePlace({ ...CLUJ, label })?.label).toBe(label);
  });
});

describe('PlaceStore', () => {
  it('starts with no place on a first visit', () => {
    expect(store().place()).toBeNull();
  });

  it('rounds a chosen place to three decimals', () => {
    const places = store();

    places.set({ ...CLUJ, lat: 46.7712, lng: 23.6236 });

    expect(places.place()).toEqual(CLUJ);
  });

  it('keeps the city from Setări on screen without storing it', () => {
    const places = store();

    places.use({ ...CLUJ, label: 'Cluj-Napoca' });

    expect(places.place()?.label).toBe('Cluj-Napoca');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('has the stored place in hand the moment it is made', () => {
    localStorage.setItem(KEY, JSON.stringify(CLUJ));

    expect(store().place()).toEqual(CLUJ);
  });

  it('stores a chosen place for the next visit', () => {
    store().set(CLUJ);
    TestBed.resetTestingModule();

    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(CLUJ);
    expect(store().place()).toEqual(CLUJ);
  });

  it.each([
    ['text that is not JSON', '{lat:'],
    ['a point outside Romania', JSON.stringify({ ...CLUJ, lat: 50 })],
    ['a place with no origin', JSON.stringify({ ...CLUJ, origin: null })],
  ])('drops and forgets %s', (_, stored) => {
    localStorage.setItem(KEY, stored);

    expect(store().place()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('works with no place when storage refuses to be read or written', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const places = store();
    expect(places.place()).toBeNull();
    places.set(CLUJ);

    expect(places.place()).toEqual(CLUJ);
  });

  it('reads nothing on the server', () => {
    localStorage.setItem(KEY, JSON.stringify(CLUJ));

    expect(store('server').place()).toBeNull();
  });
});

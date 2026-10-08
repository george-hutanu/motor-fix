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

describe('parsePlace against hostile values', () => {
  it.each([
    ['an array', [46.771, 23.624]],
    ['an empty object', {}],
    ['a number', 5],
    ['undefined', undefined],
    ['a latitude of NaN', { ...CLUJ, lat: Number.NaN }],
    ['a latitude just south of Romania', { ...CLUJ, lat: 43.499 }],
    ['a longitude just east of Romania', { ...CLUJ, lng: 29.801 }],
    ['an undefined label', { ...CLUJ, label: undefined }],
    ['a label that is an object', { ...CLUJ, label: {} }],
    ['an origin in upper case', { ...CLUJ, origin: 'ADDRESS' }],
  ])('drops a place with %s', (_, value) => {
    expect(parsePlace(value)).toBeNull();
  });

  it('keeps a label of exactly 200 characters and drops 201', () => {
    expect(parsePlace({ ...CLUJ, label: 'a'.repeat(200) })).not.toBeNull();
    expect(parsePlace({ ...CLUJ, label: 'a'.repeat(201) })).toBeNull();
  });

  it('keeps a place exactly on each edge of Romania', () => {
    for (const [lat, lng] of [
      [43.5, 20.2],
      [48.4, 29.8],
    ]) {
      expect(parsePlace({ ...CLUJ, lat, lng })).toEqual({ ...CLUJ, lat, lng });
    }
  });

  it('does not carry an extra field into the place', () => {
    expect(parsePlace({ ...CLUJ, token: 'secret' })).toEqual(CLUJ);
  });

  it('keeps a Romanian label with diacritics and emoji', () => {
    const label = 'Șoseaua Ștefan cel Mare 🚗, Iași';
    expect(parsePlace({ ...CLUJ, label })).toEqual({ ...CLUJ, label });
  });
});

describe('PlaceStore reading local storage', () => {
  it.each([
    ['invalid JSON', '{not json'],
    ['the text null', 'null'],
    ['an array', '[]'],
    [
      'a place outside Romania',
      JSON.stringify({ ...CLUJ, lat: 47.5, lng: 19 }),
    ],
    ['an empty string', ''],
  ])('starts with no place and removes %s', (_, stored) => {
    localStorage.setItem(KEY, stored);
    expect(store().place()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reads a good stored place on the first read', () => {
    localStorage.setItem(KEY, JSON.stringify(CLUJ));
    expect(store().place()).toEqual(CLUJ);
  });

  it('reads nothing on the server even when the key is set', () => {
    localStorage.setItem(KEY, JSON.stringify(CLUJ));
    expect(store('server').place()).toBeNull();
  });

  it('starts with no place when reading storage throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(store().place()).toBeNull();
  });

  it('keeps the place for the visit when storage refuses the write', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const s = store();
    s.set(CLUJ);
    expect(s.place()).toEqual(CLUJ);
  });

  it('rounds a place to three decimals in memory and in storage', () => {
    const s = store();
    s.set({ ...CLUJ, lat: 46.7712345, lng: 23.6236789 });
    expect(s.place()).toMatchObject({ lat: 46.771, lng: 23.624 });
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toMatchObject({
      lat: 46.771,
      lng: 23.624,
    });
  });

  it('shows a used place without writing it to storage', () => {
    const s = store();
    s.use(CLUJ);
    expect(s.place()).toEqual(CLUJ);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reads back after an edit with a second store instance', () => {
    store().set(CLUJ);
    TestBed.resetTestingModule();
    expect(store().place()).toEqual(CLUJ);
  });
});

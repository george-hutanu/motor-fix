import { isListingDraftData } from './listing-drafts.dto';
import {
  inRomania,
  isPlaceSection,
  placeComplete,
  ROMANIA_BOUNDS,
  radiusAllowed,
} from './place-section';

const draftWith = (place: unknown) => ({ steps: { '5': { place } } });

describe('the place guard against hostile input', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'Strada Exemplu 1'],
    ['a number', 7],
    ['undefined', undefined],
  ])('refuses %s as a section', (_, value) => {
    expect(isPlaceSection(value)).toBe(false);
  });

  it.each([
    ['null address', { address: null }],
    ['numeric address', { address: 12 }],
    ['array address', { address: ['a'] }],
    ['null latitude with null longitude', { lat: null, lng: null }],
    ['string coordinates', { lat: '44.4', lng: '26.1' }],
    ['NaN latitude', { lat: Number.NaN, lng: 26.1 }],
    ['infinite longitude', { lat: 44.4, lng: Number.POSITIVE_INFINITY }],
    ['undefined latitude beside a longitude', { lat: undefined, lng: 26.1 }],
    ['string radius', { radiusKm: '20' }],
    ['null radius', { radiusKm: null }],
    ['NaN radius', { radiusKm: Number.NaN }],
    ['infinite radius', { radiusKm: Number.POSITIVE_INFINITY }],
    ['negative radius', { radiusKm: -5 }],
    ['zero radius', { radiusKm: 0 }],
    ['radius 100.0000001', { radiusKm: 100.0000001 }],
    ['boolean radius', { radiusKm: true }],
    ['extra key', { address: 'x', note: 'y' }],
    ['upper-cased key', { Address: 'x' }],
  ])('refuses %s', (_, section) => {
    expect(isPlaceSection(section)).toBe(false);
  });

  it('refuses a section carrying an own __proto__ key', () => {
    expect(isPlaceSection(JSON.parse('{"__proto__":{"address":"x"}}'))).toBe(
      false,
    );
  });

  it('counts the address length in characters of the string, 200 in and 201 out', () => {
    expect(isPlaceSection({ address: 'ș'.repeat(200) })).toBe(true);
    expect(isPlaceSection({ address: 'ș'.repeat(201) })).toBe(false);
  });

  it('keeps a position at the equator and the meridian as a position', () => {
    expect(isPlaceSection({ lat: 0, lng: 0 })).toBe(true);
    expect(placeComplete({ address: 'x', lat: 0, lng: 0 })).toBe(false);
  });

  it('accepts a section parsed from JSON text', () => {
    expect(
      isPlaceSection(
        JSON.parse('{"address":"Str. Ștefan 1","lat":44.4,"lng":26.1}'),
      ),
    ).toBe(true);
  });
});

describe('the radius rule', () => {
  it.each([1, 2, 99, 100])('allows %d', (value) => {
    expect(radiusAllowed(value)).toBe(true);
  });
  it.each([0, 101, 1.5, -1, -0, Number.NaN, '5', null, undefined, 1e3])(
    'refuses %p',
    (value) => {
      expect(radiusAllowed(value)).toBe(false);
    },
  );
});

describe('the Romania box', () => {
  const { latMax, latMin, lngMax, lngMin } = ROMANIA_BOUNDS;

  it.each([
    [latMin, lngMin],
    [latMax, lngMax],
    [latMin, lngMax],
    [latMax, lngMin],
  ])('holds the corner %d,%d', (lat, lng) => {
    expect(inRomania(lat, lng)).toBe(true);
  });

  it.each([
    [latMin - 0.0001, 25],
    [latMax + 0.0001, 25],
    [45, lngMin - 0.0001],
    [45, lngMax + 0.0001],
    [Number.NaN, 25],
    [45, Number.NaN],
    [Number.POSITIVE_INFINITY, 25],
    [26.1025, 44.4268],
  ])('refuses %d,%d', (lat, lng) => {
    expect(inRomania(lat, lng)).toBe(false);
  });
});

describe('completeness', () => {
  it.each([
    ['a tab-only address', { address: '\t\n ', lat: 44.4, lng: 26.1 }],
    ['a non-breaking-space address', { address: ' ', lat: 44.4, lng: 26.1 }],
    ['no position', { address: 'x' }],
    ['a position outside the country', { address: 'x', lat: 48.2, lng: 16.4 }],
    ['an empty section', {}],
  ])('is incomplete with %s', (_, section) => {
    expect(placeComplete(section)).toBe(false);
  });

  it('is complete for a mobile section with a bad radius left out of the reckoning', () => {
    expect(placeComplete({ address: 'x', lat: 44.4, lng: 26.1 })).toBe(true);
  });
});

describe('the draft step 5 guard for place', () => {
  it('accepts a draft whose step 5 has no place', () => {
    expect(isListingDraftData({ steps: { '5': {} } })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['a long address', { address: 'x'.repeat(201) }],
    ['one coordinate', { lat: 44.4 }],
    ['an unknown key', { address: 'x', seat: 'y' }],
    ['a radius of 101', { radiusKm: 101 }],
    ['a fractional radius', { radiusKm: 12.5 }],
  ])('refuses a place of %s', (_, place) => {
    expect(isListingDraftData(draftWith(place))).toBe(false);
  });

  it('accepts a place with a hand-placed pin and no address', () => {
    expect(isListingDraftData(draftWith({ lat: 44.4, lng: 26.1 }))).toBe(true);
  });

  it('accepts a pin outside Romania as a draft value, the refusal being the form and the write', () => {
    expect(isListingDraftData(draftWith({ lat: 10, lng: 10 }))).toBe(true);
  });

  it('refuses a place put beside the other steps instead of in step 5', () => {
    expect(
      isListingDraftData({ steps: { '3': { place: { address: 'x' } } } }),
    ).toBe(false);
  });

  it('refuses a place at the top of the draft', () => {
    expect(isListingDraftData({ place: { address: 'x' } })).toBe(false);
  });
});

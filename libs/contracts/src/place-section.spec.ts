import {
  ADDRESS_MAX,
  inRomania,
  isPlaceSection,
  LOCALITY_MAX,
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  PLACE_SEARCH_MIN,
  PLACE_ZOOM,
  placeComplete,
  RADIUS_KM,
  ROMANIA_BOUNDS,
} from './place-section';

const BUCHAREST = { lat: 44.4268, lng: 26.1025 };

// @traces 163-FR-005
describe('the place section guard', () => {
  it.each([
    {},
    { address: '' },
    { address: 'Strada Exemplu 1, București' },
    { ...BUCHAREST },
    { address: 'Str. Ștefan cel Mare 12', ...BUCHAREST, radiusKm: 20 },
    { address: 'x'.repeat(ADDRESS_MAX) },
    { radiusKm: 1 },
    { radiusKm: 100 },
    { lat: 60, lng: 10 },
    { address: 'Strada Exemplu 2', ...BUCHAREST, locality: 'Cluj-Napoca' },
    { locality: 'x'.repeat(LOCALITY_MAX) },
  ])('keeps %j', (section) => {
    expect(isPlaceSection(section)).toBe(true);
  });

  it.each([
    ['not a record', 'Strada'],
    ['null', null],
    ['an array', []],
    ['an unknown key', { address: 'a', seat: 'b' }],
    ['an address too long', { address: 'x'.repeat(ADDRESS_MAX + 1) }],
    ['an address that is not text', { address: 12 }],
    ['a latitude alone', { lat: 44.4 }],
    ['a longitude alone', { lng: 26.1 }],
    ['a latitude as text', { lat: '44.4', lng: 26.1 }],
    ['an infinite longitude', { lat: 44.4, lng: Number.POSITIVE_INFINITY }],
    ['a not-a-number latitude', { lat: Number.NaN, lng: 26.1 }],
    ['a radius of 0', { radiusKm: 0 }],
    ['a radius of 101', { radiusKm: 101 }],
    ['a radius with a fraction', { radiusKm: 12.5 }],
    ['a radius as text', { radiusKm: '20' }],
    ['a locality too long', { locality: 'x'.repeat(LOCALITY_MAX + 1) }],
    ['a locality that is not text', { locality: 7 }],
  ])('refuses %s', (_, section) => {
    expect(isPlaceSection(section)).toBe(false);
  });
});

describe('whether the place is complete', () => {
  it('needs an address and a position inside Romania', () => {
    expect(placeComplete({ address: 'Strada Exemplu 1', ...BUCHAREST })).toBe(
      true,
    );
  });

  it.each([
    ['no address', { ...BUCHAREST }],
    ['a blank address', { address: '   ', ...BUCHAREST }],
    ['no position', { address: 'Strada Exemplu 1' }],
    ['a position outside Romania', { address: 'Wien', lat: 48.2, lng: 16.37 }],
  ])('is not complete with %s', (_, section) => {
    expect(placeComplete(section)).toBe(false);
  });

  it('never waits for a radius, as 20 stands in for a mobile mechanic', () => {
    expect(placeComplete({ address: 'Strada Exemplu 1', ...BUCHAREST })).toBe(
      true,
    );
  });
});

describe('the Romania bounds', () => {
  const { latMax, latMin, lngMax, lngMin } = ROMANIA_BOUNDS;

  it.each([
    [latMin, lngMin],
    [latMax, lngMax],
    [latMin, lngMax],
    [latMax, lngMin],
    [BUCHAREST.lat, BUCHAREST.lng],
  ])('holds %f, %f', (lat, lng) => {
    expect(inRomania(lat, lng)).toBe(true);
  });

  it.each([
    [latMin - 0.01, 25],
    [latMax + 0.01, 25],
    [45, lngMin - 0.01],
    [45, lngMax + 0.01],
  ])('leaves out %f, %f', (lat, lng) => {
    expect(inRomania(lat, lng)).toBe(false);
  });

  it('spans the country', () => {
    expect(ROMANIA_BOUNDS).toEqual({
      latMax: 48.4,
      latMin: 43.5,
      lngMax: 29.8,
      lngMin: 20.2,
    });
  });
});

describe('the place constants', () => {
  it('places the map at street zoom and starts a mobile mechanic at 20 km', () => {
    expect(PLACE_ZOOM).toBe(16);
    expect(RADIUS_KM).toEqual({ default: 20, max: 100, min: 1 });
    expect(MOBILE_SERVICE_RADIUS_DEFAULT_KM).toBe(RADIUS_KM.default);
    expect(PLACE_SEARCH_MIN).toBe(3);
    expect(ADDRESS_MAX).toBe(200);
  });
});

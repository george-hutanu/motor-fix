import { ROMANIA_BOUNDS } from './place-section';
import {
  bboxOf,
  bboxSideKm,
  clampBbox,
  filtersKey,
  filtersOf,
  nearOf,
  parseBbox,
  parseNear,
  roundCoordinate,
} from './search-place';

describe('the search place', () => {
  it.each([
    [44.426812, 44.427],
    [26.102538, 26.103],
    [23.6236, 23.624],
    [46.7712, 46.771],
  ])('rounds %d to %d', (value, rounded) => {
    expect(roundCoordinate(value)).toBe(rounded);
  });

  it('writes a point as "lat,lng" at three decimals', () => {
    expect(nearOf({ lat: 46.7712, lng: 23.6236 })).toBe('46.771,23.624');
    expect(nearOf({ lat: 44.43, lng: 26.1 })).toBe('44.43,26.1');
  });

  it('reads six decimals and three decimals of one spot as one point', () => {
    expect(parseNear('44.426812,26.102538')).toEqual({
      lat: 44.427,
      lng: 26.103,
    });
    expect(parseNear('44.427,26.103')).toEqual({ lat: 44.427, lng: 26.103 });
  });

  it('reads no point when none is given', () => {
    expect(parseNear(undefined)).toBeUndefined();
  });
});

// @traces 269-FR-005 269-FR-007
describe('the visible area of the map', () => {
  const BUCHAREST = { east: 26.25, north: 44.5, south: 44.35, west: 26.0 };

  it('reads four decimal numbers as south, west, north and east, rounded to three decimals', () => {
    expect(parseBbox('44.350412,26.000499,44.4996,26.2504')).toEqual({
      east: 26.25,
      north: 44.5,
      south: 44.35,
      west: 26.0,
    });
  });

  it.each([
    '',
    '44.35,26,44.5',
    '44.35,26,44.5,26.25,27',
    '44.35,,44.5,26.25',
    'a,26,44.5,26.25',
    '0x2c,26,44.5,26.25',
    '44.35,26,44.5,Infinity',
    '1e1,26,44.5,26.25',
  ])('reads no box from %p', (text) => {
    expect(parseBbox(text)).toBeUndefined();
  });

  it('writes a box as its canonical south,west,north,east text at three decimals', () => {
    expect(
      bboxOf({ east: 26.25041, north: 44.49962, south: 44.3504, west: 26 }),
    ).toBe('44.35,26,44.5,26.25');
  });

  it('measures the width along the southern edge and the height along a meridian', () => {
    // A degree of longitude is about 79.4 km at 44.35° N, a degree of latitude 111.32 km.
    const wide = { east: 27, north: 44.5, south: 44.35, west: 26 };
    const tall = { east: 26.1, north: 45.25, south: 44.35, west: 26 };

    expect(bboxSideKm(wide)).toBeCloseTo(79.5, 0);
    expect(bboxSideKm(tall)).toBeCloseTo(0.9 * 111.32, 1);
    expect(bboxSideKm(BUCHAREST)).toBeCloseTo(0.25 * 79.5, 0);
  });

  it('keeps a box inside the bounds as it is', () => {
    expect(clampBbox(BUCHAREST, ROMANIA_BOUNDS)).toEqual(BUCHAREST);
  });

  it('cuts a box at the bounds it crosses', () => {
    expect(
      clampBbox({ east: 31, north: 49, south: 45, west: 28 }, ROMANIA_BOUNDS),
    ).toEqual({ east: 29.8, north: 48.4, south: 45, west: 28 });
  });

  it('gives no box for one wholly outside the bounds', () => {
    expect(
      clampBbox({ east: 33, north: 47, south: 46, west: 30 }, ROMANIA_BOUNDS),
    ).toBeUndefined();
  });
});

const TUESDAY = new Date('2027-11-02T10:15:00+02:00');

// @traces 1260-FR-003 1260-FR-008 1260-FR-009
describe('the filters of a search', () => {
  it('reads no filters when neither is set', () => {
    expect(filtersOf({}, TUESDAY)).toBeUndefined();
  });

  it('reads open now as the Bucharest day, time and weekday of the instant', () => {
    expect(filtersOf({ open_now: '1' }, TUESDAY)).toEqual({
      openNow: { day: '2027-11-02', time: '10:15', weekday: 'tue' },
    });
  });

  it('reads open on Saturday without the instant', () => {
    expect(filtersOf({ open_saturday: '1' }, TUESDAY)).toEqual({
      saturday: true,
    });
  });

  it('reads both filters together', () => {
    expect(filtersOf({ open_now: '1', open_saturday: '1' }, TUESDAY)).toEqual({
      openNow: { day: '2027-11-02', time: '10:15', weekday: 'tue' },
      saturday: true,
    });
  });

  it('keys each combination apart and no filter not at all', () => {
    const key = (query: { open_now?: string; open_saturday?: string }) =>
      filtersKey(filtersOf(query, TUESDAY));

    expect(key({})).toBeUndefined();
    expect(key({ open_now: '1' })).toBe('1,');
    expect(key({ open_saturday: '1' })).toBe(',1');
    expect(key({ open_now: '1', open_saturday: '1' })).toBe('1,1');
  });

  it('keys open now the same at any instant', () => {
    const later = new Date('2027-11-06T23:59:00+02:00');

    expect(filtersKey(filtersOf({ open_now: '1' }, later))).toBe(
      filtersKey(filtersOf({ open_now: '1' }, TUESDAY)),
    );
  });
});

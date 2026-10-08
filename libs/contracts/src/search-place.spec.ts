import { nearOf, parseNear, roundCoordinate } from './search-place';

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

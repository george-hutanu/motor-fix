import { geohash5 } from './geohash';

describe('geohash5 at the edges', () => {
  it.each([
    [{ lat: 57.64911, lng: 10.40744 }, 'u4pru'],
    [{ lat: 42.6, lng: -5.6 }, 'ezs42'],
    [{ lat: 0, lng: 0 }, 's0000'],
    [{ lat: -90, lng: -180 }, '00000'],
    [{ lat: 90, lng: 180 }, 'zzzzz'],
  ])('hashes %j to %s', (point, cell) => {
    expect(geohash5(point)).toBe(cell);
  });

  it('always gives 5 characters of the geohash alphabet', () => {
    for (const lat of [-90, -45.5, 0, 44.4268, 90]) {
      for (const lng of [-180, -0.0001, 0, 26.1025, 180]) {
        expect(geohash5({ lat, lng })).toMatch(/^[0-9b-hjkmnp-z]{5}$/);
      }
    }
  });

  it('gives the same cell for points a metre apart and another for points a degree apart', () => {
    expect(geohash5({ lat: 44.4268, lng: 26.1025 })).toBe(
      geohash5({ lat: 44.42681, lng: 26.10251 }),
    );
    expect(geohash5({ lat: 44.4268, lng: 26.1025 })).not.toBe(
      geohash5({ lat: 45.4268, lng: 27.1025 }),
    );
  });

  it('gives the same answer when called twice', () => {
    const point = { lat: 46.771, lng: 23.624 };
    expect(geohash5(point)).toBe(geohash5(point));
  });

  it('does not change the point it is given', () => {
    const point = { lat: 46.771, lng: 23.624 };
    geohash5(point);
    expect(point).toEqual({ lat: 46.771, lng: 23.624 });
  });
});

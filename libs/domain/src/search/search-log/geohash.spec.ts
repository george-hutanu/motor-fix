import { geohash5 } from './geohash';

// @traces 267-FR-007
describe('geohash5', () => {
  it.each([
    [{ lat: 42.6, lng: -5.6 }, 'ezs42'],
    [{ lat: 57.649, lng: 10.407 }, 'u4pru'],
    [{ lat: 44.427, lng: 26.103 }, 'sxfs9'],
    [{ lat: 46.77, lng: 23.59 }, 'u82f0'],
    [{ lat: -33.857, lng: 151.215 }, 'r3gx2'],
    [{ lat: 0, lng: 0 }, 's0000'],
  ])('gives the 5-character cell of %p', (point, cell) => {
    expect(geohash5(point)).toBe(cell);
  });

  it('puts two points across a cell edge in neighbouring cells', () => {
    expect(geohash5({ lat: 44.427, lng: 26.103 })).toBe('sxfs9');
    expect(geohash5({ lat: 44.428, lng: 26.104 })).toBe('sxfsd');
  });
});

import {
  bucketFor,
  project,
  STATIC_MAP_SIZES,
  snapCentre,
  staticMapPath,
  unproject,
  worldSize,
} from './map-view';

// MapLibre's own MercatorCoordinate.fromLngLat, scaled to its 512-px world:
// maplibre-gl needs a browser to load, so its two formulas are copied here.
const maplibre = (lat: number, lng: number, z: number) => ({
  x: ((180 + lng) / 360) * 512 * 2 ** z,
  y:
    ((180 -
      (180 / Math.PI) *
        Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) /
      360) *
    512 *
    2 ** z,
});

const BUCHAREST = { lat: 44.4268, lng: 26.1025 };

// @traces 1196-FR-002 1196-FR-003 1196-FR-011
describe('the map view maths', () => {
  it('has a world of 512 pixels at zoom 0, doubling per zoom', () => {
    expect(worldSize(0)).toBe(512);
    expect(worldSize(13)).toBe(512 * 8192);
  });

  it.each([5, 13, 16])('projects as MapLibre does at zoom %i', (z) => {
    const ours = project(BUCHAREST, z);
    const theirs = maplibre(BUCHAREST.lat, BUCHAREST.lng, z);

    expect(ours.x).toBeCloseTo(theirs.x, 6);
    expect(ours.y).toBeCloseTo(theirs.y, 6);
  });

  it('comes back to the same place after projecting and unprojecting', () => {
    for (const point of [
      BUCHAREST,
      { lat: 47.16, lng: 27.59 },
      { lat: 43.6, lng: 20.3 },
    ]) {
      const back = unproject(project(point, 14), 14);

      expect(back.lat).toBeCloseTo(point.lat, 9);
      expect(back.lng).toBeCloseTo(point.lng, 9);
    }
  });

  it('snaps a centre to a grid one eighth of the image wide', () => {
    const snapped = snapCentre(BUCHAREST, 13, 640);
    const p = project(snapped, 13);

    // Within the rounding to five decimals, about half a pixel at zoom 16.
    expect(Math.abs(p.x / 80 - Math.round(p.x / 80))).toBeLessThan(0.01);
    expect(Math.abs(p.y / 80 - Math.round(p.y / 80))).toBeLessThan(0.01);
    expect(snapped.lat.toString()).toMatch(/^\d+(\.\d{1,5})?$/);
    expect(snapped.lng.toString()).toMatch(/^\d+(\.\d{1,5})?$/);
  });

  it('gives two centres in one grid cell the same snapped centre and path', () => {
    const z = 13;
    const step = 640 / 8;
    const cell = project(snapCentre(BUCHAREST, z, 640), z);
    const near = unproject(
      { x: cell.x + step * 0.3, y: cell.y - step * 0.3 },
      z,
    );
    const other = unproject(
      { x: cell.x - step * 0.2, y: cell.y + step * 0.4 },
      z,
    );
    const view = (c: { lat: number; lng: number }) => ({
      ...snapCentre(c, z, 640),
      h: 480,
      theme: 'light' as const,
      w: 640,
      z,
    });

    expect(snapCentre(near, z, 640)).toEqual(snapCentre(other, z, 640));
    expect(staticMapPath(view(near))).toBe(staticMapPath(view(other)));
  });

  it('moves to the next cell a centre past half a step', () => {
    const z = 13;
    const cell = project(snapCentre(BUCHAREST, z, 640), z);
    const past = unproject({ x: cell.x + 80 * 0.6, y: cell.y }, z);

    expect(snapCentre(past, z, 640)).not.toEqual(snapCentre(BUCHAREST, z, 640));
  });

  it('keeps a snapped centre where it is when snapped again', () => {
    for (const z of [5, 10, 13, 16]) {
      for (const w of STATIC_MAP_SIZES) {
        const once = snapCentre(BUCHAREST, z, w);

        expect(snapCentre(once, z, w)).toEqual(once);
      }
    }
  });

  it.each([
    [1, 320],
    [320, 320],
    [321, 390],
    [390, 390],
    [391, 480],
    [700, 768],
    [1000, 1024],
    [1025, 1280],
    [5000, 1280],
  ])('takes the smallest width bucket at or above %i: %i', (px, bucket) => {
    expect(bucketFor(px)).toBe(bucket);
  });

  it('caps a height at 1024', () => {
    expect(bucketFor(1000, 'h')).toBe(1024);
    expect(bucketFor(1100, 'h')).toBe(1024);
    expect(bucketFor(400, 'h')).toBe(480);
  });

  it('writes one view as one address, its parameters in a fixed order', () => {
    expect(
      staticMapPath({
        h: 480,
        lat: 44.42681,
        lng: 26.10254,
        theme: 'dark',
        w: 390,
        z: 13,
      }),
    ).toBe(
      '/api/v1/maps/static?theme=dark&z=13&lat=44.42681&lng=26.10254&w=390&h=480',
    );
  });
});

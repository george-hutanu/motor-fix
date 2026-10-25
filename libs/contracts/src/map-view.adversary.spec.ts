import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  bucketFor,
  project,
  STATIC_MAP_SIZES,
  snapCentre,
  staticMapPath,
  unproject,
  worldSize,
} from './map-view';
import { StaticMapQueryDto } from './static-map.dto';

const refusedFields = (query: Record<string, unknown>) =>
  validateSync(plainToInstance(StaticMapQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);

const asQuery = (path: string) =>
  Object.fromEntries(new URL(path, 'http://x').searchParams);

// @traces 1196-FR-002
describe('project and unproject, hostile inputs', () => {
  it('round-trips every corner of Romania at every served zoom within a millionth of a degree', () => {
    for (const lat of [43.5, 45.9, 48.4]) {
      for (const lng of [20.2, 25, 29.8]) {
        for (let z = 5; z <= 16; z++) {
          const back = unproject(project({ lat, lng }, z), z);
          expect(back.lat).toBeCloseTo(lat, 6);
          expect(back.lng).toBeCloseTo(lng, 6);
        }
      }
    }
  });

  it('puts the world at 512 pixels wide at zoom 0 with the equator and the antimeridian centred', () => {
    expect(worldSize(0)).toBe(512);
    expect(project({ lat: 0, lng: 0 }, 0)).toEqual({ x: 256, y: 256 });
    expect(project({ lat: 0, lng: -180 }, 3).x).toBe(0);
    expect(project({ lat: 0, lng: 180 }, 3).x).toBe(worldSize(3));
  });

  it('grows y southwards: a more northern point has a smaller y', () => {
    expect(project({ lat: 48, lng: 25 }, 10).y).toBeLessThan(
      project({ lat: 44, lng: 25 }, 10).y,
    );
  });
});

// @traces 1196-FR-002
describe('snapCentre, hostile inputs', () => {
  it('is idempotent: a snapped centre snaps to itself for every bucket and zoom', () => {
    const c = { lat: 45.7489, lng: 24.9231 };
    for (const w of STATIC_MAP_SIZES) {
      for (const z of [5, 9, 13, 16]) {
        const once = snapCentre(c, z, w);
        expect(snapCentre(once, z, w)).toEqual(once);
      }
    }
  });

  it('gives two centres a few hundred metres apart the same snapped centre at a city zoom, in the same cell', () => {
    const a = snapCentre({ lat: 44.43, lng: 26.1 }, 13, 640);
    const b = snapCentre({ lat: a.lat + 0.0003, lng: a.lng + 0.0004 }, 13, 640);
    const c = snapCentre({ lat: a.lat - 0.0003, lng: a.lng - 0.0004 }, 13, 640);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('moves a centre by at most half a grid step on each axis', () => {
    const c = { lat: 46.1234, lng: 23.4321 };
    const z = 12;
    const w = 480;
    const before = project(c, z);
    const after = project(snapCentre(c, z, w), z);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(w / 16 + 0.01);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(w / 16 + 0.01);
  });

  it('rounds the snapped centre to at most five decimals', () => {
    const { lat, lng } = snapCentre(
      { lat: 44.123456789, lng: 26.987654321 },
      14,
      390,
    );
    expect(Number(lat.toFixed(5))).toBe(lat);
    expect(Number(lng.toFixed(5))).toBe(lng);
  });

  it('writes the snapped centre in plain decimal form that the query check accepts, for centres across and on the edge of Romania', () => {
    for (let lat = 43.5; lat <= 48.4; lat += 0.7) {
      for (let lng = 20.2; lng <= 29.8; lng += 1.3) {
        for (const z of [5, 8, 16]) {
          const snapped = snapCentre({ lat, lng }, z, 1280);
          const path = staticMapPath({
            ...snapped,
            h: 320,
            theme: 'dark',
            w: 1280,
            z,
          });
          expect(path).not.toMatch(/e[+-]?\d/);
        }
      }
    }
  });
});

// @traces 1196-FR-003
describe('bucketFor, boundaries', () => {
  it.each([
    [0, 320],
    [-5, 320],
    [1, 320],
    [320, 320],
    [320.5, 390],
    [321, 390],
    [390, 390],
    [391, 480],
    [1024, 1024],
    [1025, 1280],
    [1280, 1280],
    [1281, 1280],
    [100000, 1280],
  ])('maps %p wide to the %p bucket', (px, bucket) => {
    expect(bucketFor(px)).toBe(bucket);
  });

  it.each([
    [1024, 1024],
    [1025, 1024],
    [1280, 1024],
    [5000, 1024],
    [321, 390],
  ])('maps %p tall to the %p bucket, never past 1024', (px, bucket) => {
    expect(bucketFor(px, 'h')).toBe(bucket);
  });

  it('answers a bucket the API accepts for a NaN or infinite measure', () => {
    for (const px of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(STATIC_MAP_SIZES).toContain(bucketFor(px));
      expect(STATIC_MAP_SIZES).toContain(bucketFor(px, 'h'));
    }
  });

  it('never pairs a width and a height the API refuses, for any measured box', () => {
    for (const w of [1, 300, 700, 1100, 1281, 4000]) {
      for (const h of [1, 300, 700, 1100, 1281, 4000]) {
        const query = asQuery(
          staticMapPath({
            h: bucketFor(h, 'h'),
            lat: 44.4,
            lng: 26.1,
            theme: 'light',
            w: bucketFor(w),
            z: 12,
          }),
        );
        expect(refusedFields(query)).toEqual([]);
      }
    }
  });
});

// @traces 1196-FR-001
describe('staticMapPath', () => {
  it('builds the same string for the same view and keeps the parameters in a fixed order', () => {
    const view = {
      h: 480,
      lat: 44.43,
      lng: 26.1,
      theme: 'dark' as const,
      w: 640,
      z: 13,
    };
    expect(staticMapPath(view)).toBe(
      '/api/v1/maps/static?theme=dark&z=13&lat=44.43&lng=26.1&w=640&h=480',
    );
    expect(staticMapPath({ ...view })).toBe(staticMapPath(view));
  });
});

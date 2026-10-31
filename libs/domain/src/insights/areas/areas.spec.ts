// @traces 106-FR-001
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AREAS, readAreas } from './areas';

const FILE = JSON.parse(
  readFileSync(join(__dirname, 'areas.json'), 'utf8'),
) as { features: { properties: Record<string, unknown>; geometry: unknown }[] };

// The shipped file with `change` applied to a deep copy.
function changed(change: (file: typeof FILE) => void) {
  const copy = structuredClone(FILE);
  change(copy);
  return copy;
}

describe('the areas file', () => {
  it('holds the six București sectors and the 41 county seats', () => {
    expect(AREAS).toHaveLength(47);
    expect(AREAS.filter((a) => a.kind === 'sector').map((a) => a.code)).toEqual(
      ['sector-1', 'sector-2', 'sector-3', 'sector-4', 'sector-5', 'sector-6'],
    );
    expect(AREAS.filter((a) => a.kind === 'city')).toHaveLength(41);
    expect(AREAS.find((a) => a.code === 'cluj-napoca')).toMatchObject({
      kind: 'city',
      name: 'Cluj-Napoca',
    });
    expect(AREAS.find((a) => a.code === 'sector-3')?.name).toBe('Sector 3');
  });

  it('reads the shipped file as it is', () => {
    expect(readAreas(FILE)).toEqual(AREAS);
  });

  it.each([
    [
      'a code twice',
      (f: typeof FILE) => {
        f.features[1].properties['code'] = f.features[0].properties['code'];
      },
    ],
    [
      'a sector outside 1 to 6',
      (f: typeof FILE) => {
        const sector = f.features.find(
          (x) => x.properties['kind'] === 'sector',
        );
        if (sector) sector.properties['code'] = 'sector-7';
      },
    ],
    [
      'a code that is no slug',
      (f: typeof FILE) => {
        f.features[0].properties['code'] = 'Alba Iulia';
      },
    ],
    [
      'a kind outside city and sector',
      (f: typeof FILE) => {
        f.features[0].properties['kind'] = 'county';
      },
    ],
    [
      'an empty name',
      (f: typeof FILE) => {
        f.features[0].properties['name'] = '';
      },
    ],
    [
      'a point for an outline',
      (f: typeof FILE) => {
        f.features[0].geometry = { coordinates: [23.5, 46], type: 'Point' };
      },
    ],
    [
      'an outline without coordinates',
      (f: typeof FILE) => {
        f.features[0].geometry = { coordinates: [], type: 'Polygon' };
      },
    ],
    [
      'no licence',
      (f: typeof FILE) => {
        delete (f as Record<string, unknown>)['licence'];
      },
    ],
    [
      'no source',
      (f: typeof FILE) => {
        delete (f as Record<string, unknown>)['source'];
      },
    ],
    [
      'no features',
      (f: typeof FILE) => {
        delete (f as Record<string, unknown>)['features'];
      },
    ],
    [
      'a ring of one point',
      (f: typeof FILE) => {
        f.features[0].geometry = { coordinates: [[[26, 44]]], type: 'Polygon' };
      },
    ],
    [
      'a ring that is not closed',
      (f: typeof FILE) => {
        f.features[0].geometry = {
          coordinates: [
            [
              [26, 44],
              [26.1, 44],
              [26.1, 44.1],
              [26, 44.1],
            ],
          ],
          type: 'Polygon',
        };
      },
    ],
  ])('refuses a file with %s', (_, change) => {
    expect(() => readAreas(changed(change))).toThrow(/areas file/);
  });
});

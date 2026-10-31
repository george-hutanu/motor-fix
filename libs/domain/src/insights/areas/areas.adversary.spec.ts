// @traces 106-FR-001
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AREAS, readAreas } from './areas';

type Feature = { properties: Record<string, unknown>; geometry: unknown };
type File = Record<string, unknown> & { features: Feature[] };

const FILE = JSON.parse(
  readFileSync(join(__dirname, 'areas.json'), 'utf8'),
) as File;

function changed(change: (file: File) => void) {
  const copy = structuredClone(FILE);
  change(copy);
  return copy;
}

const square = {
  coordinates: [
    [
      [23, 46],
      [24, 46],
      [24, 47],
      [23, 47],
      [23, 46],
    ],
  ],
  type: 'Polygon',
};

describe('a malformed areas file', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '{"features":[]}'],
    ['a number', 47],
    ['an array', [FILE]],
  ])('is refused when it is %s', (_, source) => {
    expect(() => readAreas(source)).toThrow(/areas file/);
  });

  it.each([
    ['a feature that is null', null],
    ['a feature that is a string', 'sector-1'],
    ['a feature that is an empty object', {}],
    ['a feature with null properties', { geometry: square, properties: null }],
    [
      'a feature with null geometry',
      { geometry: null, properties: { code: 'x', kind: 'city', name: 'X' } },
    ],
  ])('is refused with %s', (_, feature) => {
    expect(() =>
      readAreas(changed((f) => f.features.push(feature as Feature))),
    ).toThrow(/areas file/);
  });

  it.each([
    ['features as an object', { 0: {} }],
    ['features as a string', 'many'],
    ['features as null', null],
    ['an empty features list', []],
  ])('is refused with %s', (_, features) => {
    expect(() => readAreas({ ...FILE, features })).toThrow(/areas file/);
  });

  it.each([
    ['a blank licence', { licence: '   ' }],
    ['a numeric licence', { licence: 7 }],
    ['a blank source', { source: '\t\n' }],
    ['a null source', { source: null }],
  ])('is refused with %s', (_, patch) => {
    expect(() => readAreas({ ...FILE, ...patch })).toThrow(/areas file/);
  });

  it.each([
    ['sector-0', 'sector'],
    ['sector-01', 'sector'],
    ['sector-10', 'sector'],
    ['Sector-1', 'sector'],
    ['sector-1 ', 'sector'],
    ['sector-1\n', 'sector'],
    ['sector-3', 'city'],
    ['', 'city'],
    ['Cluj', 'city'],
    ['cluj--napoca', 'city'],
    ['-cluj', 'city'],
    ['cluj-', 'city'],
    ['cluj napoca', 'city'],
    ['iași', 'city'],
  ])('is refused with the code %j of kind %s', (code, kind) => {
    const file = changed((f) => {
      f.features[0].properties['code'] = code;
      f.features[0].properties['kind'] = kind;
    });
    expect(() => readAreas(file)).toThrow(/areas file/);
  });

  it.each([
    ['a name that is a number', 12],
    ['a name that is null', null],
    ['a blank name', ' \t '],
    ['a name of 81 characters', 'N'.repeat(81)],
  ])('is refused with %s', (_, name) => {
    const file = changed((f) => {
      f.features[0].properties['name'] = name;
    });
    expect(() => readAreas(file)).toThrow(/areas file/);
  });

  it.each([
    ['a LineString', { coordinates: [[23, 46]], type: 'LineString' }],
    [
      'a GeometryCollection',
      { geometries: [square], type: 'GeometryCollection' },
    ],
    ['a missing type', { coordinates: square.coordinates }],
    ['coordinates that are a string', { coordinates: 'x', type: 'Polygon' }],
    ['a null ring', { coordinates: [null], type: 'Polygon' }],
    ['an empty ring', { coordinates: [[]], type: 'Polygon' }],
    [
      'no coordinates on a MultiPolygon',
      { coordinates: [], type: 'MultiPolygon' },
    ],
  ])('is refused with %s', (_, geometry) => {
    const file = changed((f) => {
      f.features[0].geometry = geometry;
    });
    expect(() => readAreas(file)).toThrow(/areas file/);
  });

  it('is refused when two areas share a code whatever the order', () => {
    const file = changed((f) => {
      const last = f.features.length - 1;
      f.features[last].properties['code'] = f.features[0].properties['code'];
      f.features[last].properties['kind'] = f.features[0].properties['kind'];
    });
    expect(() => readAreas(file)).toThrow(/twice/);
  });
});

describe('a well-formed areas file', () => {
  it('reads a MultiPolygon outline and a single-feature file', () => {
    const multi = {
      coordinates: [square.coordinates],
      type: 'MultiPolygon',
    };
    const file = {
      features: [
        {
          geometry: multi,
          properties: { code: 'alba-iulia', kind: 'city', name: 'Alba Iulia' },
        },
      ],
      licence: 'ODbL',
      source: 'OSM',
    };
    expect(readAreas(file)).toEqual([
      { code: 'alba-iulia', geometry: multi, kind: 'city', name: 'Alba Iulia' },
    ]);
  });

  it('accepts a name of exactly 80 characters with diacritics', () => {
    const name = 'Ș'.repeat(80);
    const file = changed((f) => {
      f.features[0].properties['name'] = name;
    });
    expect(readAreas(file)[0].name).toBe(name);
  });

  it('ignores a property it does not know and keeps the other areas intact', () => {
    const file = changed((f) => {
      f.features[0].properties['population'] = 1;
    });
    expect(readAreas(file)).toEqual(AREAS);
  });

  it('does not change the object it reads', () => {
    const before = JSON.stringify(FILE);
    readAreas(FILE);
    expect(JSON.stringify(FILE)).toBe(before);
  });
});

const ringsOf = ({ geometry }: (typeof AREAS)[number]) =>
  (geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : (geometry.coordinates as unknown[][])
  ).flat() as number[][][];

const outside = ([lng, lat]: number[]) =>
  lng < 20 || lng > 30 || lat < 43 || lat > 49;

function ringProblems(area: (typeof AREAS)[number]) {
  const found: string[] = [];
  for (const ring of ringsOf(area)) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length < 4 || first[0] !== last[0] || first[1] !== last[1])
      found.push(`${area.code} ring not closed`);
    found.push(...ring.filter(outside).map((p) => `${area.code} at ${p}`));
  }
  return found;
}

describe('the shipped areas', () => {
  it('sit inside Romania with closed rings of valid coordinates', () => {
    expect(AREAS.flatMap(ringProblems)).toEqual([]);
  });

  it('are listed in no order that hides a duplicate name within a kind', () => {
    const names = AREAS.map((a) => `${a.kind}:${a.name}`);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('give each county seat a distinct slug that is no sector code', () => {
    const cities = AREAS.filter((a) => a.kind === 'city').map((a) => a.code);
    expect(new Set(cities).size).toBe(41);
    expect(cities.filter((c) => c.startsWith('sector-'))).toEqual([]);
    expect(cities).not.toContain('unknown');
  });
});

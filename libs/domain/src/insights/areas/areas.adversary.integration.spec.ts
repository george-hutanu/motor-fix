// @traces 106-FR-001 106-FR-002
import {
  AREAS,
  AreaLoader,
  type AreaRecord,
  areaOf,
  cellCentre,
} from './areas';
import { serialDatabase } from '../../auth/serial-db.testing';
import { Prisma } from '../../generated/prisma/client';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const loader = new AreaLoader(prisma);

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE area'));

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE area');
  await new AreaLoader(prisma).load(AREAS);
  await prisma.$disconnect();
});

const at = (lat: number, lng: number) =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

async function placed(point: Prisma.Sql) {
  const [row] = await prisma.$queryRaw<{ code: string }[]>(
    Prisma.sql`SELECT ${areaOf(point)} AS code`,
  );
  return row.code;
}

const ring = (lat: number, lng: number, size: number) => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
  [lng, lat],
];

const square = (
  code: string,
  lat: number,
  lng: number,
  size = 1,
  kind: AreaRecord['kind'] = 'city',
): AreaRecord => ({
  code,
  geometry: { coordinates: [ring(lat, lng, size)], type: 'Polygon' },
  kind,
  name: code.toUpperCase(),
});

const stored = () =>
  prisma.$queryRaw<{ code: string; name: string; kind: string }[]>`
    SELECT code, name, kind FROM area ORDER BY code`;

describe('loading the areas under stress', () => {
  it('loads an empty list as nothing changed and deletes nothing', async () => {
    await loader.load([square('a', 10, 10)]);

    expect(await loader.load([])).toEqual({ changed: 0 });
    expect((await stored()).map((a) => a.code)).toEqual(['a']);
  });

  it('answers two loads at once without an error and without duplicates', async () => {
    const results = await Promise.all([
      loader.load(AREAS),
      loader.load(AREAS),
      loader.load(AREAS),
    ]);

    expect(results.map((r) => r.changed).sort((x, y) => x - y)).toEqual([
      0, 0, 47,
    ]);
    expect(await stored()).toHaveLength(47);
  });

  it('stores nothing of a load that fails halfway', async () => {
    const broken: AreaRecord = {
      code: 'broken',
      geometry: { coordinates: [[[0, 0]]], type: 'Polygon' },
      kind: 'city',
      name: 'Broken',
    };

    await expect(
      loader.load([square('good', 10, 10), broken]),
    ).rejects.toThrow();

    expect(await stored()).toEqual([]);
  });

  it('changes one area alone when only its kind changes', async () => {
    await loader.load([square('a', 10, 10), square('b', 20, 20)]);

    expect(
      await loader.load([
        square('a', 10, 10),
        square('b', 20, 20, 1, 'sector'),
      ]),
    ).toEqual({ changed: 1 });
  });

  it('keeps the name of a name with quotes and unicode as given', async () => {
    const odd = { ...square('odd', 10, 10), name: 'Iași \' " \\ %_ 🚗' };

    await loader.load([odd]);

    expect((await stored())[0].name).toBe(odd.name);
  });

  it('loads a MultiPolygon and places a point in either of its parts', async () => {
    await loader.load([
      {
        code: 'islands',
        geometry: {
          coordinates: [[ring(10, 10, 1)], [ring(30, 30, 1)]],
          type: 'MultiPolygon',
        },
        kind: 'city',
        name: 'Islands',
      },
    ]);

    expect(await placed(at(10.5, 10.5))).toBe('islands');
    expect(await placed(at(30.5, 30.5))).toBe('islands');
    expect(await placed(at(20, 20))).toBe('unknown');
  });

  it('loads the shipped areas in under the transaction timeout', async () => {
    const started = Date.now();

    await loader.load(AREAS);

    expect(Date.now() - started).toBeLessThan(30_000);
  });
});

describe('placing a point hostilely', () => {
  beforeEach(() =>
    loader.load([
      square('left', 10, 10),
      square('right', 10, 11),
      {
        code: 'donut',
        geometry: {
          coordinates: [ring(30, 30, 3), ring(31, 31, 1).reverse()],
          type: 'Polygon',
        },
        kind: 'city',
        name: 'Donut',
      },
    ]),
  );

  it('places a point on a shared edge in the first code, once', async () => {
    expect(await placed(at(10.5, 11))).toBe('left');
    const [count] = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*) AS n FROM area a WHERE ST_Intersects(a.outline, ${at(10.5, 11)})`,
    );
    expect(Number(count.n)).toBe(2);
  });

  it('places a vertex and an edge point of a single outline inside it', async () => {
    expect(await placed(at(10, 10))).toBe('left');
    expect(await placed(at(11, 10.5))).toBe('left');
  });

  it('places a point in the hole of an outline in unknown', async () => {
    expect(await placed(at(31.5, 31.5))).toBe('unknown');
    expect(await placed(at(30.5, 30.5))).toBe('donut');
  });

  it('places a null point in unknown', async () => {
    expect(await placed(Prisma.sql`NULL::geography`)).toBe('unknown');
  });

  it.each([
    ['the south pole', -90, 0],
    ['the antimeridian', 0, 180],
    ['null island', 0, 0],
  ])('places %s in unknown', async (_, lat, lng) => {
    expect(await placed(at(lat, lng))).toBe('unknown');
  });
});

describe('the centre of a cell', () => {
  beforeEach(() => loader.load(AREAS));

  it.each([['zzzzz'], ['00000']])(
    'places the extreme cell %s in unknown',
    async (cell) => {
      expect(await placed(cellCentre(Prisma.sql`${cell}::text`))).toBe(
        'unknown',
      );
    },
  );

  it.each([
    ['an upper-case cell', 'SXFSE'],
    ['a cell with a letter geohash lacks', 'sxfsa'],
    ['an empty cell', ''],
    ['a cell with punctuation', 'sx!se'],
  ])('places %s in unknown instead of failing the query', async (_, cell) => {
    expect(await placed(cellCentre(Prisma.sql`${cell}::text`))).toBe('unknown');
  });
});

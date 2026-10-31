// @traces 106-FR-001 106-FR-002
import { AREAS, AreaLoader, type AreaRecord, areaOf } from './areas';
import { serialDatabase } from '../../auth/serial-db.testing';
import { Prisma } from '../../generated/prisma/client';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const loader = new AreaLoader(prisma);

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE area');
});

afterAll(() => prisma.$disconnect());

const at = (lat: number, lng: number) =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

// The area code a point falls in.
async function placed(point: Prisma.Sql) {
  const [row] = await prisma.$queryRaw<{ code: string }[]>(
    Prisma.sql`SELECT ${areaOf(point)} AS code`,
  );
  return row.code;
}

// A square of `size` degrees with its south-west corner at (lat, lng).
const square = (
  code: string,
  name: string,
  lat: number,
  lng: number,
  size = 1,
): AreaRecord => ({
  code,
  geometry: {
    coordinates: [
      [
        [lng, lat],
        [lng + size, lat],
        [lng + size, lat + size],
        [lng, lat + size],
        [lng, lat],
      ],
    ],
    type: 'Polygon',
  },
  kind: 'sector',
  name,
});

// The garage's point where the address or, for a mobile mechanic, the seat is.
async function garageAt(name: string, lat: number | null, lng = 0) {
  const garage = await world.garage(name);
  if (lat !== null)
    await prisma.$executeRaw`UPDATE garage SET position = ${at(lat, lng)} WHERE id = ${garage.id}::uuid`;
  return garage;
}

const placedGarage = (id: string) =>
  placed(
    Prisma.sql`(SELECT g.position FROM garage g WHERE g.id = ${id}::uuid)`,
  );

describe('the area load', () => {
  it('stores every area of the file once, and a second load changes nothing', async () => {
    expect(await loader.load(AREAS)).toEqual({ changed: 47 });
    const first = await prisma.$queryRaw<
      { code: string; updated_at: Date }[]
    >`SELECT code, updated_at FROM area ORDER BY code`;

    expect(await loader.load(AREAS)).toEqual({ changed: 0 });

    expect(first).toHaveLength(47);
    expect(
      await prisma.$queryRaw`SELECT code, updated_at FROM area ORDER BY code`,
    ).toEqual(first);
    expect(
      await prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM area WHERE NOT ST_IsValid(outline::geometry)`,
    ).toEqual([{ n: 0 }]);
  });

  it('updates the renamed area alone, and deletes none that left the file', async () => {
    const areas = [
      square('sector-1', 'Sector 1', 10, 10),
      square('sector-2', 'Sector 2', 20, 20),
    ];
    await loader.load(areas);

    expect(await loader.load([{ ...areas[0], name: 'Sectorul 1' }])).toEqual({
      changed: 1,
    });

    expect(
      await prisma.$queryRaw`SELECT code, name, kind FROM area ORDER BY code`,
    ).toEqual([
      { code: 'sector-1', kind: 'sector', name: 'Sectorul 1' },
      { code: 'sector-2', kind: 'sector', name: 'Sector 2' },
    ]);
  });

  it('updates a moved outline', async () => {
    await loader.load([square('sector-1', 'Sector 1', 10, 10)]);

    expect(await loader.load([square('sector-1', 'Sector 1', 30, 30)])).toEqual(
      { changed: 1 },
    );
    expect(await placed(at(30.5, 30.5))).toBe('sector-1');
    expect(await placed(at(10.5, 10.5))).toBe('unknown');
  });
});

describe('placing a point', () => {
  beforeEach(() => loader.load(AREAS));

  it('places a workshop in the sector whose outline holds it', async () => {
    const workshop = await garageAt('Atelier Titan', 44.415, 26.17);

    expect(await placedGarage(workshop.id)).toBe('sector-3');
  });

  it('places a mobile mechanic by its registered seat', async () => {
    const mobile = await garageAt('Mecanic la domiciliu', 46.77, 23.59);
    await prisma.garage.update({
      data: {
        businessKind: 'mobile',
        seatAddress: 'Str. Horea 1, Cluj-Napoca',
      },
      where: { id: mobile.id },
    });

    expect(await placedGarage(mobile.id)).toBe('cluj-napoca');
  });

  it('places a search by the centre of its five-character cell', async () => {
    expect(
      await placed(Prisma.sql`ST_PointFromGeoHash(${'sxfse'})::geography`),
    ).toBe('sector-3');
    expect(
      await placed(Prisma.sql`ST_PointFromGeoHash(${'sxft1'})::geography`),
    ).toBe('sector-1');
    expect(
      await placed(Prisma.sql`ST_PointFromGeoHash(${'u82f0'})::geography`),
    ).toBe('cluj-napoca');
  });

  it('places open country, a garage without a position and a search without a cell in unknown', async () => {
    const nowhere = await garageAt('Fără adresă', null);

    expect(await placed(at(45.5, 25))).toBe('unknown');
    expect(await placedGarage(nowhere.id)).toBe('unknown');
    expect(
      await placed(Prisma.sql`ST_PointFromGeoHash(${null}::text)::geography`),
    ).toBe('unknown');
  });
});

describe('outlines that meet', () => {
  it('places a point both outlines hold once, in the first area by code', async () => {
    await loader.load([
      square('sector-2', 'Sector 2', 10, 10),
      square('sector-1', 'Sector 1', 10, 10.5),
    ]);

    expect(await placed(at(10.5, 10.75))).toBe('sector-1');
    expect(await placed(at(10.5, 10.25))).toBe('sector-2');
  });

  it('places every point in unknown while no area is loaded', async () => {
    expect(await placed(at(44.415, 26.17))).toBe('unknown');
  });
});

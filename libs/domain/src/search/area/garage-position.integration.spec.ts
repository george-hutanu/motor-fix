import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma } = fixtures();
serialDatabase(databaseUrl);

const PLACED = [
  { latitude: 46.771, longitude: 23.624 },
  { latitude: 44.4268, longitude: 26.1025 },
  { latitude: 47.1585, longitude: 27.6014 },
];

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE garage CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

// @traces 271-garage-distance-FR-009
describe("each garage's stored position", () => {
  it('is the point of its latitude and longitude, and empty without them', async () => {
    for (const [n, place] of PLACED.entries()) {
      await prisma.garage.create({
        data: { name: `placed-${n}`, slug: `placed-${n}`, ...place },
      });
    }
    await prisma.garage.create({
      data: { name: 'unplaced', slug: 'unplaced' },
    });

    const rows = await prisma.$queryRaw<
      { slug: string; empty: boolean; same: boolean | null }[]
    >`
      SELECT
        slug,
        position IS NULL AS empty,
        position = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
          AND ST_AsText(position) = ST_AsText(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) AS same
      FROM garage
      ORDER BY slug
    `;

    expect(rows).toEqual([
      { empty: false, same: true, slug: 'placed-0' },
      { empty: false, same: true, slug: 'placed-1' },
      { empty: false, same: true, slug: 'placed-2' },
      { empty: true, same: null, slug: 'unplaced' },
    ]);
  });

  it('follows the garage when it moves, and loses no garage', async () => {
    const { id } = await prisma.garage.create({
      data: { name: 'moving', slug: 'moving', ...PLACED[0] },
    });
    await prisma.garage.update({ data: PLACED[1], where: { id } });

    const [row] = await prisma.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y(position::geometry) AS lat, ST_X(position::geometry) AS lng
      FROM garage WHERE id = ${id}::uuid
    `;

    expect(row).toEqual({ lat: PLACED[1].latitude, lng: PLACED[1].longitude });
    expect(await prisma.garage.count()).toBe(1);
  });

  it('is a geography point on the WGS 84 datum with a GiST index', async () => {
    const [column] = await prisma.$queryRaw<
      { type: string; generated: string }[]
    >`
      SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attgenerated::text AS generated
      FROM pg_attribute a
      WHERE a.attrelid = 'garage'::regclass AND a.attname = 'position'
    `;
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'garage' AND indexname = 'garage_position_idx'
    `;

    expect(column).toEqual({ generated: 's', type: 'geography(Point,4326)' });
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toMatch(/USING gist \(\s*"?position"?\s*\)/);
  });
});

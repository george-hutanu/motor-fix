import { randomUUID } from 'node:crypto';

import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma } = fixtures();
serialDatabase(databaseUrl);

let brandId: string;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  brandId = (
    await prisma.brand.create({
      data: { key: 'bmw', name: 'BMW', slug: 'bmw' },
    })
  ).id;
});

afterAll(() => prisma.$disconnect());

type Column = {
  column_name: string;
  column_default: string | null;
  data_type: string;
  character_maximum_length: number | null;
  datetime_precision: number | null;
  is_nullable: 'YES' | 'NO';
};

const columns = () =>
  prisma.$queryRaw<Column[]>`
    SELECT column_name, column_default, data_type, character_maximum_length,
           datetime_precision, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'search_log'
    ORDER BY column_name`;

const insert = (brand: string, areaCell: string | null) =>
  prisma.$executeRaw`INSERT INTO search_log (brand_id, area_cell) VALUES (${brand}::uuid, ${areaCell})`;

// @traces 267-brand-results-FR-007
describe('the search log table', () => {
  it('holds a brand, an area cell and a time, and nothing about the searcher', async () => {
    const list = await columns();
    const column = (name: string) =>
      list.find((each) => each.column_name === name);

    expect(list.map((each) => each.column_name)).toEqual([
      'area_cell',
      'at',
      'brand_id',
      'id',
    ]);
    expect(column('id')).toMatchObject({
      column_default: 'gen_random_uuid()',
      data_type: 'uuid',
      is_nullable: 'NO',
    });
    expect(column('brand_id')).toMatchObject({
      data_type: 'uuid',
      is_nullable: 'NO',
    });
    expect(column('area_cell')).toMatchObject({
      character_maximum_length: 5,
      data_type: 'character varying',
      is_nullable: 'YES',
    });
    expect(column('at')).toMatchObject({
      column_default: 'CURRENT_TIMESTAMP',
      data_type: 'timestamp with time zone',
      datetime_precision: 3,
      is_nullable: 'NO',
    });
  });

  it('fills the id and the time itself and keeps a row without a place', async () => {
    const before = Date.now();
    await insert(brandId, 'sxfs2');
    await insert(brandId, null);

    const rows = await prisma.$queryRaw<
      { id: string; area_cell: string | null; at: Date }[]
    >`SELECT id::text, area_cell, at FROM search_log ORDER BY area_cell NULLS LAST`;

    expect(rows.map((row) => row.area_cell)).toEqual(['sxfs2', null]);
    for (const row of rows) {
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    }
  });

  it('refuses a cell longer than five characters and a brand that does not exist', async () => {
    await expect(insert(brandId, 'sxfs2x')).rejects.toThrow();
    await expect(insert(randomUUID(), 'sxfs2')).rejects.toThrow();
  });

  it('keeps a brand that has searches from being deleted', async () => {
    await insert(brandId, 'sxfs2');

    await expect(
      prisma.brand.delete({ where: { id: brandId } }),
    ).rejects.toThrow();
  });

  it('has no index besides its key', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'search_log'`;

    expect(indexes.map((index) => index.indexname)).toEqual([
      'search_log_pkey',
    ]);
  });
});

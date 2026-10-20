import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// @traces 1352-catalogue-job-visibility-FR-016

const MIGRATION = join(
  __dirname,
  '..',
  '..',
  '..',
  'prisma',
  'migrations',
  '20261020100000_garage_brand_job_job_type_fk',
  'migration.sql',
);

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let garageId: string;
let brandId: string;
let jobTypeId: string;
const created: string[] = [];

async function jobType() {
  const key = `fk-${randomUUID()}`;
  const { id } = await prisma.jobType.create({
    data: { key, nameEn: key, nameRo: key, status: 'approved' },
  });
  created.push(id);
  return id;
}

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  const key = `dacia-${randomUUID()}`;
  ({ id: brandId } = await prisma.brand.create({
    data: { key, name: key, slug: key },
  }));
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
  await prisma.garageBrand.create({
    data: { brandId, garageId, stance: 'works_on' },
  });
  jobTypeId = await jobType();
});

afterAll(async () => {
  await reset();
  await prisma.jobType.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

const tick = (id: string) =>
  prisma.$executeRawUnsafe(
    'INSERT INTO "garage_brand_job" ("garage_id", "brand_id", "job_type_id") VALUES ($1::uuid, $2::uuid, $3::uuid)',
    garageId,
    brandId,
    id,
  );

const ticks = async () =>
  (
    await prisma.garageBrandJob.findMany({
      select: { jobTypeId: true },
      where: { garageId },
    })
  ).map((row) => row.jobTypeId);

// The migration's statements, run again on a table put back as it was before.
async function migrateAgain() {
  const sql = readFileSync(MIGRATION, 'utf8').replace(/--.*$/gm, '');
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "garage_brand_job" DROP CONSTRAINT IF EXISTS "garage_brand_job_job_type_id_fkey"',
  );
  await prisma.$executeRawUnsafe(
    'DROP INDEX IF EXISTS "garage_brand_job_job_type_id_idx"',
  );
  return async () => {
    for (const statement of sql.split(';').map((s) => s.trim())) {
      if (statement) await prisma.$executeRawUnsafe(statement);
    }
  };
}

describe('the brand ticks foreign key to the job catalogue', () => {
  it('removes a tick naming no catalogue job and keeps a tick on a real job', async () => {
    const migrate = await migrateAgain();
    const orphan = randomUUID();
    await tick(jobTypeId);
    await tick(orphan);

    await migrate();

    expect(await ticks()).toEqual([jobTypeId]);
  });

  it('refuses a tick with an unknown job id', async () => {
    await expect(tick(randomUUID())).rejects.toThrow(
      /garage_brand_job_job_type_id_fkey/,
    );
    expect(await ticks()).toEqual([]);
  });

  it('refuses to delete a catalogue job that has a tick', async () => {
    await tick(jobTypeId);

    await expect(
      prisma.jobType.delete({ where: { id: jobTypeId } }),
    ).rejects.toThrow();
    expect(
      await prisma.jobType.findUnique({ where: { id: jobTypeId } }),
    ).not.toBeNull();
    expect(await ticks()).toEqual([jobTypeId]);
  });
});

import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { BrandLoader } from './brand-loader';
import { BrandFileError, type BrandRecord } from './brands';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

const { prisma } = fixtures();
const redis = new Redis(redisUrlFor(3));
const loader = new BrandLoader(prisma, new AuditService(), redis);
serialDatabase(databaseUrl);

const FILE: BrandRecord[] = [
  { key: 'bmw', name: 'BMW', popularity: 1 },
  { key: 'skoda', name: 'Škoda', popularity: 2 },
  { key: 'dacia', name: 'Dacia' },
];

// The history is append-only: each test reads the entries written since it began.
let since: Date;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  await redis.del('brands:active');
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
});

afterAll(async () => {
  redis.disconnect();
  await prisma.$disconnect();
});

const stored = () =>
  prisma.brand.findMany({
    orderBy: { key: 'asc' },
    select: {
      active: true,
      id: true,
      key: true,
      name: true,
      popularity: true,
      slug: true,
    },
  });

const history = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, subjectType: 'brand' },
  });

async function garageWorkingOn(brandId: string) {
  const garage = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  });
  await prisma.garageBrand.create({
    data: { brandId, garageId: garage.id, stance: 'works_on' },
  });
  return garage.id;
}

describe('BrandLoader', () => {
  it('stores every brand of the file once, active, with its slug', async () => {
    const result = await loader.load(FILE);

    expect(result.changed).toBe(3);
    expect(await stored()).toEqual([
      expect.objectContaining({
        active: true,
        key: 'bmw',
        name: 'BMW',
        popularity: 1,
        slug: 'bmw',
      }),
      expect.objectContaining({
        active: true,
        key: 'dacia',
        name: 'Dacia',
        popularity: null,
        slug: 'dacia',
      }),
      expect.objectContaining({
        active: true,
        key: 'skoda',
        name: 'Škoda',
        popularity: 2,
        slug: 'skoda',
      }),
    ]);
  });

  it('records each created brand in the history as the system', async () => {
    await loader.load(FILE);

    const entries = await history();
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        action: 'create',
        actorId: null,
        actorName: 'MotorFix',
        actorRole: 'system',
        garageId: null,
      });
    }
  });

  it('changes nothing and records nothing when the same file runs again', async () => {
    await loader.load(FILE);
    const before = await prisma.brand.findMany({ orderBy: { key: 'asc' } });
    const entries = (await history()).length;

    const result = await loader.load(FILE);

    expect(result.changed).toBe(0);
    expect(await prisma.brand.findMany({ orderBy: { key: 'asc' } })).toEqual(
      before,
    );
    expect(await history()).toHaveLength(entries);
  });

  it('keeps the id and the garage rows of a renamed brand, recording the change', async () => {
    await loader.load(FILE);
    const skoda = await prisma.brand.findUniqueOrThrow({
      where: { key: 'skoda' },
    });
    const garageId = await garageWorkingOn(skoda.id);

    await loader.load([
      FILE[0],
      { key: 'skoda', name: 'Skoda Auto', popularity: 2 },
      FILE[2],
    ]);

    const renamed = await prisma.brand.findUniqueOrThrow({
      where: { key: 'skoda' },
    });
    expect(renamed).toMatchObject({
      id: skoda.id,
      name: 'Skoda Auto',
      slug: 'skoda-auto',
    });
    expect(
      await prisma.garageBrand.count({
        where: { brandId: skoda.id, garageId },
      }),
    ).toBe(1);
    expect(
      (await history()).filter((entry) => entry.action === 'update'),
    ).toEqual([
      expect.objectContaining({
        actorRole: 'system',
        field: 'name',
        newValue: 'Skoda Auto',
        oldValue: 'Škoda',
        subjectId: skoda.id,
      }),
      expect.objectContaining({
        field: 'slug',
        newValue: 'skoda-auto',
        oldValue: 'skoda',
        subjectId: skoda.id,
      }),
    ]);
  });

  it('records a changed popularity', async () => {
    await loader.load(FILE);

    const result = await loader.load([
      FILE[0],
      FILE[1],
      { key: 'dacia', name: 'Dacia', popularity: 3 },
    ]);

    expect(result.changed).toBe(1);
    expect(
      (await history()).filter((entry) => entry.action === 'update'),
    ).toEqual([
      expect.objectContaining({
        field: 'popularity',
        newValue: 3,
        oldValue: null,
      }),
    ]);
  });

  it('keeps a brand missing from the file, inactive, with its garage rows', async () => {
    await loader.load(FILE);
    const dacia = await prisma.brand.findUniqueOrThrow({
      where: { key: 'dacia' },
    });
    await garageWorkingOn(dacia.id);

    await loader.load(FILE.slice(0, 2));

    expect(
      await prisma.brand.findUniqueOrThrow({ where: { key: 'dacia' } }),
    ).toMatchObject({ active: false, id: dacia.id });
    expect(
      await prisma.garageBrand.count({ where: { brandId: dacia.id } }),
    ).toBe(1);
    expect(
      (await history()).filter((entry) => entry.action === 'update'),
    ).toEqual([
      expect.objectContaining({
        actorRole: 'system',
        field: 'active',
        newValue: false,
        oldValue: true,
        subjectId: dacia.id,
      }),
    ]);
  });

  it('brings a retired brand back as the same row', async () => {
    await loader.load(FILE);
    const dacia = await prisma.brand.findUniqueOrThrow({
      where: { key: 'dacia' },
    });
    await loader.load(FILE.slice(0, 2));

    const result = await loader.load(FILE);

    expect(result.changed).toBe(1);
    expect(await prisma.brand.count({ where: { key: 'dacia' } })).toBe(1);
    expect(
      await prisma.brand.findUniqueOrThrow({ where: { key: 'dacia' } }),
    ).toMatchObject({ active: true, id: dacia.id });
  });

  it('fails the whole load on a duplicate in the file, naming it, and stores nothing', async () => {
    await loader.load(FILE);
    const before = await stored();
    const entries = (await history()).length;

    const run = loader.load([
      { key: 'bmw', name: 'BMW', popularity: 1 },
      { key: 'tesla', name: 'Tesla' },
      { key: 'bmw-ag', name: 'BMW' },
    ]);

    await expect(run).rejects.toThrow(BrandFileError);
    await expect(run).rejects.toThrow('duplicate name "BMW": bmw, bmw-ag');
    expect(await stored()).toEqual(before);
    expect(await history()).toHaveLength(entries);
  });

  it.each([
    ['name', { key: 'dacia-group', name: 'Dacia' }],
    ['slug', { key: 'dacia-group', name: 'DACIA' }],
  ])(
    'refuses a %s held by a stored retired brand under another key, changing nothing',
    async (_, record) => {
      await loader.load(FILE);
      await loader.load(FILE.slice(0, 2));
      const before = await stored();

      await expect(loader.load([...FILE.slice(0, 2), record])).rejects.toThrow(
        BrandFileError,
      );
      expect(await stored()).toEqual(before);
    },
  );

  it('refuses a file that swaps two brands names, telling the operator to rename through a temporary name', async () => {
    await loader.load(FILE);
    const before = await stored();

    const run = loader.load([
      { key: 'bmw', name: 'Škoda', popularity: 1 },
      { key: 'skoda', name: 'BMW', popularity: 2 },
      { key: 'dacia', name: 'Dacia' },
    ]);

    await expect(run).rejects.toThrow(BrandFileError);
    await expect(run).rejects.toThrow(
      '"Škoda" is held by the stored brand skoda: rename one brand to a temporary name first, load, then load again',
    );
    expect(await stored()).toEqual(before);
  });

  it('drops the cached brand list when the list changed', async () => {
    await redis.set('brands:active', '[]');

    await loader.load(FILE);

    expect(await redis.get('brands:active')).toBeNull();
  });

  it('keeps the cached brand list when nothing changed', async () => {
    await loader.load(FILE);
    await redis.set('brands:active', '[]');

    await loader.load(FILE);

    expect(await redis.get('brands:active')).toBe('[]');
  });
});

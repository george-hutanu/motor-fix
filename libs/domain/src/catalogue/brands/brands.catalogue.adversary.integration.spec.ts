import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { BRANDS } from './brands';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { BrandLoader } from '../brand-loader';
import { CatalogueModule } from '../catalogue.module';
import { JobTypeLoader } from '../job-types/job-type-loader';
import { JOB_TYPES } from '../job-types/job-types';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
const redis = new Redis(redisUrl);
serialDatabase(databaseUrl);

let app: INestApplication;
let loader: BrandLoader;
let jobs: JobTypeLoader;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      CatalogueModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
  loader = app.get(BrandLoader);
  jobs = app.get(JobTypeLoader);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, job_type, garage CASCADE');
  await redis.incr('brands:version');
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

const names = async (q: string) =>
  (
    (
      await request(app.getHttpServer()).get(
        `/brands?q=${encodeURIComponent(q)}`,
      )
    ).body.items as { name: string }[]
  ).map((b) => b.name);

const auditCount = async () =>
  prisma.activityLog.count({
    where: { subjectType: { in: ['brand', 'job_type'] } },
  });

const FIRST_FIFTEEN = [
  'bmw',
  'mini',
  'mercedes-benz',
  'audi',
  'volkswagen',
  'skoda',
  'dacia',
  'renault',
  'ford',
  'toyota',
  'hyundai',
  'tesla',
  'opel',
  'alfa-romeo',
  'citroen',
];

describe('loading the real catalogue files', () => {
  it('creates every brand and job active, then changes nothing and audits nothing on the second load', async () => {
    expect((await loader.load(BRANDS)).changed).toBe(BRANDS.length);
    await jobs.load(JOB_TYPES);
    expect(await prisma.brand.count({ where: { active: true } })).toBe(
      BRANDS.length,
    );
    expect(await prisma.jobType.count()).toBe(6);
    const before = await auditCount();

    expect((await loader.load(BRANDS)).changed).toBe(0);
    await jobs.load(JOB_TYPES);

    expect(await auditCount()).toBe(before);
  });

  it('stores the file rank and your form of every brand', async () => {
    await loader.load(BRANDS);

    const rows = await prisma.brand.findMany();
    const wrong = BRANDS.filter((b) => {
      const row = rows.find((r) => r.key === b.key);
      return (
        !row ||
        row.name !== b.name ||
        row.popularity !== b.popularity ||
        row.roPossessive !== b.roPossessive
      );
    }).map((b) => b.key);
    expect(wrong).toEqual([]);
  });

  it('finds Škoda, Citroën and Lada first for skoda, citroen and Lada', async () => {
    await loader.load(BRANDS);

    expect((await names('skoda'))[0]).toBe('Škoda');
    expect((await names('citroen'))[0]).toBe('Citroën');
    expect((await names('Lada'))[0]).toBe('Lada');
  });

  it('finds Alfa Romeo alone for alf', async () => {
    await loader.load(BRANDS);

    expect(await names('alf')).toEqual(['Alfa Romeo']);
  });

  it('returns the mock twelve first, in order, for an empty query', async () => {
    await loader.load(BRANDS);

    const res = await request(app.getHttpServer()).get('/brands');

    expect(
      res.body.items.slice(0, 12).map((b: { name: string }) => b.name),
    ).toEqual(BRANDS.slice(0, 12).map((b) => b.name));
    expect(res.body.total).toBe(BRANDS.length);
  });

  it('fills a null rank over a database holding the fifteen, keeps a number, inserts the rest', async () => {
    const fifteen = BRANDS.filter((b) => FIRST_FIFTEEN.includes(b.key));
    expect(fifteen).toHaveLength(15);
    await loader.load(
      fifteen.map((b) => ({
        key: b.key,
        name: b.name,
        roPossessive: b.roPossessive,
      })),
    );
    await prisma.brand.update({
      data: { popularity: 99 },
      where: { key: 'bmw' },
    });
    await prisma.brand.update({
      data: { popularity: null },
      where: { key: 'opel' },
    });

    await loader.load(BRANDS);

    const bmw = await prisma.brand.findUnique({ where: { key: 'bmw' } });
    const opel = await prisma.brand.findUnique({ where: { key: 'opel' } });
    expect(bmw?.popularity).toBe(99);
    expect(opel?.popularity).toBe(
      BRANDS.find((b) => b.key === 'opel')?.popularity,
    );
    expect(await prisma.brand.count()).toBe(BRANDS.length);
  });

  it('writes one audit entry for a null rank it fills and none on the load after', async () => {
    await loader.load([{ key: 'opel', name: 'Opel' }]);
    const opel = await prisma.brand.findUniqueOrThrow({
      where: { key: 'opel' },
    });
    const before = await prisma.activityLog.count({
      where: { subjectId: opel.id, subjectType: 'brand' },
    });

    await loader.load([{ key: 'opel', name: 'Opel', popularity: 13 }]);
    const mid = await prisma.activityLog.count({
      where: { subjectId: opel.id, subjectType: 'brand' },
    });
    await loader.load([{ key: 'opel', name: 'Opel', popularity: 13 }]);
    const after = await prisma.activityLog.count({
      where: { subjectId: opel.id, subjectType: 'brand' },
    });

    expect([mid - before, after - mid]).toEqual([1, 0]);
  });

  it('does not re-rank a brand the nightly job moved when the file loads again', async () => {
    await loader.load(BRANDS);
    await prisma.brand.update({
      data: { popularity: 2 },
      where: { key: 'lada' },
    });

    expect((await loader.load(BRANDS)).changed).toBe(0);
    expect(
      (await prisma.brand.findUniqueOrThrow({ where: { key: 'lada' } }))
        .popularity,
    ).toBe(2);
  });
});

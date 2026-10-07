import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JobTypeLoader } from './job-type-loader';
import { JOB_TYPES } from './job-types';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { CatalogueModule } from '../catalogue.module';

const { prisma } = fixtures();
serialDatabase(databaseUrl);

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({
        databaseUrl,
        redisUrl: redisUrlFor(3),
        tokenSecret: 'test',
      }),
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
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE job_type, garage CASCADE');
  await app.get(JobTypeLoader).load(JOB_TYPES);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const search = (query: Record<string, string> = {}) =>
  request(app.getHttpServer()).get('/job-types').query(query);

const keys = (body: { items: { key: string }[] }) =>
  body.items.map((item) => item.key);

describe('GET /job-types', () => {
  it('lists the approved jobs by Romanian name, with their key and both names', async () => {
    const res = await search();

    expect(res.status).toBe(200);
    expect(keys(res.body)).toEqual([
      'diagnosis',
      'ac-regas',
      'timing-chain',
      'front-brakes',
      'oil-service',
      'suspension-alignment',
    ]);
    const brakes = await prisma.jobType.findUniqueOrThrow({
      where: { key: 'front-brakes' },
    });
    expect(res.body.items[3]).toEqual({
      id: brakes.id,
      key: 'front-brakes',
      nameEn: 'Front brake pads and discs',
      nameRo: 'Plăcuțe și discuri de frână față',
    });
  });

  it('never lists a pending or rejected job', async () => {
    await prisma.jobType.createMany({
      data: [
        {
          key: 'clutch',
          nameEn: 'Clutch',
          nameRo: 'Ambreiaj',
          status: 'pending',
        },
        { key: 'wash', nameEn: 'Wash', nameRo: 'Spălare', status: 'rejected' },
      ],
    });

    const res = await search();

    expect(keys(res.body)).not.toContain('clutch');
    expect(keys(res.body)).not.toContain('wash');
  });

  it.each(['frana', 'FRÂNĂ', 'brake'])(
    'finds the front brakes job for %s, accents and case ignored',
    async (q) => {
      const res = await search({ q });

      expect(keys(res.body)).toEqual(['front-brakes']);
    },
  );

  it('answers at most 20 jobs', async () => {
    await prisma.jobType.createMany({
      data: Array.from({ length: 25 }, (_, n) => ({
        key: `job-${n}`,
        nameEn: `Job ${n}`,
        nameRo: `Lucrare ${String(n).padStart(2, '0')}`,
        status: 'approved' as const,
      })),
    });

    const res = await search();

    expect(res.body.items).toHaveLength(20);
  });

  it('answers an empty list when nothing matches', async () => {
    const res = await search({ q: 'zzz' });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('refuses a search longer than 80 characters', async () => {
    const res = await search({ q: 'x'.repeat(81) });

    expect(res.status).toBe(400);
  });
});

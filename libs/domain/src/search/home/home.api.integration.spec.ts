import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { SearchModule } from '../search.module';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
serialDatabase(databaseUrl);

let app: INestApplication;
let dacia: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      SearchModule,
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
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', popularity: 7, slug: 'dacia' },
    })
  ).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const home = (query: Record<string, string>) =>
  request(app.getHttpServer()).get('/home').query(query);

async function garage(
  slug: string,
  status: 'draft' | 'approved' | 'suspended',
  stance?: 'works_on' | 'does_not_take',
) {
  const { id } = await prisma.garage.create({
    data: { name: slug, slug, status },
  });
  if (stance) {
    await prisma.garageBrand.create({
      data: {
        brandId: dacia,
        garageId: id,
        stance,
        ...(stance === 'does_not_take' && {
          diesel: false,
          electric: false,
          hybrid: false,
          petrol: false,
        }),
      },
    });
  }
}

describe('GET /home', () => {
  it('counts the listed garages and those that take the brand, for a visitor', async () => {
    await garage('a', 'approved', 'works_on');
    await garage('b', 'approved', 'works_on');
    await garage('c', 'approved', 'works_on');
    await garage('d', 'approved', 'does_not_take');
    await garage('e', 'approved');
    await garage('f', 'approved');
    await garage('g', 'draft', 'works_on');
    await garage('h', 'suspended', 'works_on');

    const res = await home({ brand: 'dacia' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brand: { id: dacia, name: 'Dacia', popularity: 7, slug: 'dacia' },
      takers: 3,
      total: 6,
    });
  });

  it('lets the answer be cached for a minute', async () => {
    const res = await home({ brand: 'dacia' });

    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('answers 0 of 0 when no garage is listed', async () => {
    await garage('draft-only', 'draft', 'works_on');

    const res = await home({ brand: 'dacia' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ takers: 0, total: 0 });
  });

  it('accepts a place and counts all of Romania all the same', async () => {
    await garage('a', 'approved', 'works_on');

    const res = await home({ brand: 'dacia', near: '44.43,26.10' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ takers: 1, total: 1 });
  });

  it('answers 404 for a brand retired from the catalogue', async () => {
    await prisma.brand.update({
      data: { active: false },
      where: { id: dacia },
    });

    const res = await home({ brand: 'dacia' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 404 for a slug no brand holds', async () => {
    const res = await home({ brand: 'lada' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(res.headers['cache-control']).not.toBe('public, max-age=60');
  });

  it.each([
    ['no brand', {}],
    ['a blank brand', { brand: '' }],
    ['a brand over 60 characters', { brand: 'a'.repeat(61) }],
    ['a place out of range', { brand: 'dacia', near: '95,26' }],
    ['an unknown parameter', { brand: 'dacia', sort: 'rating' }],
  ])('refuses with 400 %s', async (_, query) => {
    const res = await home(query);

    expect(res.status).toBe(400);
  });
});

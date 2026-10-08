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
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const popular = (query: Record<string, string> = {}) =>
  request(app.getHttpServer()).get('/brands/popular').query(query);

const brands = (rows: [string, number | null, boolean?][]) =>
  prisma.brand.createMany({
    data: rows.map(([name, popularity, active = true]) => ({
      active,
      key: name.toLowerCase(),
      name,
      popularity,
      slug: name.toLowerCase(),
    })),
  });

const names = (body: { name: string }[]) => body.map((b) => b.name);

describe('GET /brands/popular', () => {
  it('answers a visitor with the eight most popular active brands, most popular first', async () => {
    await brands([
      ['Renault', 8],
      ['Bmw', 1],
      ['Ford', 9],
      ['Mini', 2],
      ['Dacia', 7],
      ['Audi', 4],
      ['Skoda', 6],
      ['Mercedes', 3],
      ['Volkswagen', 5],
    ]);

    const res = await popular();

    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([
      'Bmw',
      'Mini',
      'Mercedes',
      'Audi',
      'Volkswagen',
      'Skoda',
      'Dacia',
      'Renault',
    ]);
    expect(Object.keys(res.body[0]).sort()).toEqual([
      'id',
      'name',
      'popularity',
      'slug',
    ]);
  });

  it('lets the answer be cached for a minute', async () => {
    const res = await popular();

    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('never lets a refusal be cached publicly', async () => {
    const res = await popular({ limit: '0' });

    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).not.toBe('public, max-age=60');
  });

  it('leaves out retired brands and puts unranked ones last, by name', async () => {
    await brands([
      ['Zastava', null],
      ['Aro', null],
      ['Dacia', 2],
      ['Lada', 1, false],
    ]);

    const res = await popular();

    expect(names(res.body)).toEqual(['Dacia', 'Aro', 'Zastava']);
  });

  it('answers as many brands as the limit asks for', async () => {
    await brands([
      ['Bmw', 1],
      ['Mini', 2],
      ['Mercedes', 3],
    ]);

    expect(names((await popular({ limit: '2' })).body)).toEqual([
      'Bmw',
      'Mini',
    ]);
    expect((await popular({ limit: '12' })).body).toHaveLength(3);
  });

  it('answers an empty list when the catalogue is empty', async () => {
    const res = await popular();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each(['0', '13', '2.5', 'eight'])(
    'refuses with 400 the limit %s',
    async (limit) => {
      const res = await popular({ limit });

      expect(res.status).toBe(400);
    },
  );
});

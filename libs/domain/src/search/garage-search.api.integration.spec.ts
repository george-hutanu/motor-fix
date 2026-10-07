import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { SearchModule } from './search.module';
import { AuthModule } from '../auth/auth.module';
import { serialDatabase } from '../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

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
  // The API's own pipe options (apps/api bootstrap).
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
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const search = (query: Record<string, string>) =>
  request(app.getHttpServer()).get('/search/garages').query(query);

describe('GET /search/garages', () => {
  it('answers a visitor without a session with a page of garages', async () => {
    const garage = await prisma.garage.create({
      data: { name: 'Alfa Service', slug: 'alfa-service', status: 'approved' },
    });
    await prisma.garageBrand.create({
      data: { brandId: dacia, garageId: garage.id, stance: 'works_on' },
    });

    const res = await search({ brandId: dacia });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      counts: { doesNotTake: 0, worksOn: 1 },
      items: [
        {
          id: garage.id,
          name: 'Alfa Service',
          slug: 'alfa-service',
          stance: 'works_on',
        },
      ],
      nextCursor: null,
      total: 1,
    });
  });

  it.each([
    ['no brand', {}],
    ['a brand that is not a uuid', { brandId: 'dacia' }],
    ['an unknown parameter', { brandId: randomUUID(), sort: 'rating' }],
    [
      'a cursor over 200 characters',
      { brandId: randomUUID(), cursor: 'a'.repeat(201) },
    ],
  ])('answers 400 to %s', async (_, query) => {
    expect((await search(query)).status).toBe(400);
  });

  it('answers 400 invalid_cursor to a cursor it did not give', async () => {
    const res = await search({ brandId: dacia, cursor: 'not-a-cursor' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 404 not_found to a brand that does not exist', async () => {
    const res = await search({ brandId: randomUUID() });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

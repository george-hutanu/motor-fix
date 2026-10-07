import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CatalogueModule } from './catalogue.module';
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

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      CatalogueModule,
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

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const list = (query: Record<string, string> = {}) =>
  request(app.getHttpServer()).get('/public-holidays').query(query);

describe('GET /public-holidays', () => {
  it("answers a visitor with the year's legal holidays in day order, with both names", async () => {
    const res = await list({ year: '2026' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(16);
    expect(res.body[0]).toEqual({
      day: '2026-01-01',
      nameEn: 'New Year',
      nameRo: 'Anul Nou',
    });
    expect(res.body).toContainEqual({
      day: '2026-06-01',
      nameEn: "Children's Day / Whit Monday",
      nameRo: 'Ziua Copilului / A doua zi de Rusalii',
    });
    const days = res.body.map((row: { day: string }) => row.day);
    expect(days).toEqual([...days].sort());
    expect(days.every((day: string) => day.startsWith('2026-'))).toBe(true);
  });

  it('answers the seventeen days of 2027', async () => {
    const res = await list({ year: '2027' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(17);
    expect(res.body.at(-1)).toEqual({
      day: '2027-12-26',
      nameEn: 'Christmas',
      nameRo: 'Crăciunul',
    });
  });

  it('answers an empty list for a year the calendar does not hold', async () => {
    const res = await list({ year: '2099' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each([
    ['no year', {}],
    ['a year before 2000', { year: '1999' }],
    ['a year after 2100', { year: '2101' }],
    ['a year that is not a number', { year: 'anul' }],
    ['a year with a fraction', { year: '2026.5' }],
  ])('answers 400 to %s', async (_, query) => {
    const res = await list(query as Record<string, string>);

    expect(res.status).toBe(400);
  });
});

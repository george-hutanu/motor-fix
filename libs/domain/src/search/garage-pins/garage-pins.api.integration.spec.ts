import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { dropSearches } from '../garage-search/garage-search.cache';
import { SearchModule } from '../search.module';

const reader = countedMetrics();
const redisUrl = redisUrlFor(12);
const { prisma } = fixtures();
serialDatabase(databaseUrl);

const NEAR = '44.437,26.117';
const BBOX = '44.35,26,44.5,26.25';

let app: INestApplication;
const other = new Redis(redisUrl);
let dacia: string;
let garageId: string;

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
  garageId = (
    await prisma.garage.create({
      data: {
        labourFromBani: 18_000,
        latitude: 44.44,
        longitude: 26.12,
        name: 'Alfa Service',
        slug: 'alfa-service',
        status: 'approved',
      },
    })
  ).id;
  await prisma.garageBrand.create({
    data: { brandId: dacia, garageId, stance: 'works_on' },
  });
});

afterAll(async () => {
  await app.close();
  other.disconnect();
  await prisma.$disconnect();
});

const pins = (query: Record<string, string | string[]>) =>
  request(app.getHttpServer()).get('/search/garages/pins').query(query);

const PIN = () => ({
  id: garageId,
  lat: 44.44,
  lng: 26.12,
  rateLei: 180,
  stance: 'works_on',
});

// @traces 269-FR-001 269-FR-019
describe('GET /search/garages/pins', () => {
  it('answers a visitor without a session with the pins, never to be kept on the way', async () => {
    const res = await pins({ brand: 'dacia', near: NEAR });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ pins: [PIN()], total: 1 });
  });

  it('answers the pins of a box', async () => {
    const res = await pins({ bbox: BBOX, brandId: dacia });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pins: [PIN()], total: 1 });
  });

  it('answers the pins of the whole country with neither a place nor a box', async () => {
    expect((await pins({ brand: 'dacia' })).body).toEqual({
      pins: [PIN()],
      total: 1,
    });
  });

  it.each([
    ['no brand', {}],
    ['a slug and an id together', { brand: 'dacia', brandId: randomUUID() }],
    ['a brand that is not a uuid', { brandId: 'dacia' }],
    ['a place outside Romania', { brand: 'dacia', near: '48.857,2.352' }],
    ['a place that is not lat,lng', { brand: 'dacia', near: 'bucuresti' }],
    ['a radius of 30', { brand: 'dacia', near: NEAR, radius: '30' }],
    [
      'a box with south above north',
      { bbox: '44.6,26,44.5,26.25', brand: 'dacia' },
    ],
    ['a box wider than 100 km', { bbox: '44.35,26,44.5,27.5', brand: 'dacia' }],
    ['a box outside Romania', { bbox: '48.8,2.3,48.9,2.4', brand: 'dacia' }],
    ['a repeated box', { bbox: [BBOX, BBOX], brand: 'dacia' }],
    ['ids, which only the list reads', { brand: 'dacia', ids: randomUUID() }],
    ['log, which only the list reads', { brand: 'dacia', log: '1' }],
  ])('answers 400 to %s', async (_, query) => {
    expect((await pins(query)).status).toBe(400);
  });

  it('names the box rule when a box is refused', async () => {
    const res = await pins({ bbox: '44.35,26,44.5,27.5', brand: 'dacia' });

    expect(JSON.stringify(res.body)).toContain(
      'bbox must be south,west,north,east inside Romania, at most 100 km wide',
    );
  });

  it('answers 404 not_found to a brand that does not exist', async () => {
    const res = await pins({ brand: 'trabant' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers again from the 60-second entry until a public garage event drops it', async () => {
    await pins({ brand: 'dacia', near: NEAR }).expect(200);
    await prisma.garage.update({
      data: { labourFromBani: 20_000 },
      where: { id: garageId },
    });

    const cached = await pins({ brand: 'dacia', near: NEAR });
    await dropSearches(other, [`public:garage:${garageId}`]);
    const fresh = await pins({ brand: 'dacia', near: NEAR });

    expect(cached.body.pins[0].rateLei).toBe(180);
    expect(fresh.body.pins[0].rateLei).toBe(200);
  });
});

// @traces 269-FR-020
describe('counting the pins reads', () => {
  const read = (outcome: string, mode: string) =>
    counterTotal(reader, 'motorfix_search_pins_total', { mode, outcome });

  it('counts each answer by outcome and mode, a cached one too', async () => {
    const before = {
      areaNone: await read('none', 'area'),
      areaResults: await read('results', 'area'),
      bboxResults: await read('results', 'bbox'),
    };

    await pins({ brand: 'dacia', near: NEAR }).expect(200);
    await pins({ brand: 'dacia', near: NEAR }).expect(200);
    await pins({ brand: 'dacia', near: '45.16,29.65' }).expect(200);
    await pins({ bbox: BBOX, brand: 'dacia' }).expect(200);

    expect(await read('results', 'area')).toBe(before.areaResults + 2);
    expect(await read('none', 'area')).toBe(before.areaNone + 1);
    expect(await read('results', 'bbox')).toBe(before.bboxResults + 1);
  });

  it('counts no read that is refused', async () => {
    const total = () => counterTotal(reader, 'motorfix_search_pins_total');
    const before = await total();

    await pins({ brand: 'trabant' }).expect(404);
    await pins({ bbox: '1,2,3,4', brand: 'dacia' }).expect(400);

    expect(await total()).toBe(before);
  });
});

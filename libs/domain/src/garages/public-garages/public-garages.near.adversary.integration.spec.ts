import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
const other = new Redis(redisUrl);

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({
    databaseUrl,
    redisUrl,
    tokenSecret: 'test-secret',
  });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
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
  other.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
});

const PLACE = { lat: 46.771, lng: 23.624 };
const METRES_PER_DEGREE = 111_194.9266;
const north = (metres: number) => ({
  latitude: PLACE.lat + metres / METRES_PER_DEGREE,
  longitude: PLACE.lng,
});
const near = `${PLACE.lat},${PLACE.lng}`;

const read = (slug: string, query: Record<string, string> = {}) =>
  request(app.getHttpServer()).get(`/garages/${slug}`).query(query);

const fixed = (at?: number, data: Record<string, unknown> = {}) =>
  prisma.garage.create({
    data: {
      name: 'Service Auto Militari',
      slug: `m-${randomUUID()}`,
      status: 'approved',
      ...(at === undefined ? {} : north(at)),
      ...data,
    },
  });

const mobile = (at: number) =>
  fixed(at, {
    businessKind: 'mobile',
    seatAddress: 'Strada Sediului 1, Cluj-Napoca',
    serviceRadiusKm: 30,
  });

// @traces 271-FR-014
describe('the distance on a profile read', () => {
  it('gives a fixed garage one decimal of kilometres', async () => {
    const garage = await fixed(3_240);

    const res = await read(garage.slug, { near });

    expect(res.status).toBe(200);
    expect(res.body.distanceKm).toBe(3.2);
  });

  it('gives a garage at the place itself a distance of zero, not none', async () => {
    const garage = await fixed(0);

    const res = await read(garage.slug, { near });

    expect(res.body).toHaveProperty('distanceKm', 0);
  });

  it('gives a distance for a garage far outside the area', async () => {
    const garage = await fixed(180_000);

    const res = await read(garage.slug, { near });

    expect(res.body.distanceKm).toBe(180);
  });

  it('gives no distance without near', async () => {
    const garage = await fixed(3_240);

    const res = await read(garage.slug);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('distanceKm');
  });

  it('gives no distance for a garage with no position', async () => {
    const garage = await fixed();

    const res = await read(garage.slug, { near });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('distanceKm');
  });

  it('gives a mobile mechanic no distance, inside its radius or far outside it', async () => {
    const close = await mobile(2_000);
    const far = await mobile(90_000);

    for (const garage of [close, far]) {
      const res = await read(garage.slug, { near });

      expect([res.status, 'distanceKm' in res.body]).toEqual([200, false]);
    }
  });

  it('gives a distance together with a brand in context', async () => {
    const garage = await fixed(1_000);

    const res = await read(garage.slug, { brand: 'does-not-exist', near });

    expect(res.status).toBe(200);
    expect(res.body.distanceKm).toBe(1);
  });

  it('answers a garage that is not public as it did, and with no distance', async () => {
    const garage = await fixed(1_000, { status: 'suspended' });

    const res = await read(garage.slug, { near });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toHaveProperty('distanceKm');
  });

  it('answers an unknown slug with not found, not with an error', async () => {
    const res = await read('nobody-here', { near });

    expect(res.status).toBe(404);
  });

  it('gives the same distance twice, and the right one to each place', async () => {
    const garage = await fixed(10_000);
    const farther = `${PLACE.lat - 0.09},${PLACE.lng}`;

    const first = await read(garage.slug, { near });
    const elsewhere = await read(garage.slug, { near: farther });
    const again = await read(garage.slug, { near });

    expect(first.body.distanceKm).toBe(10);
    expect(again.body.distanceKm).toBe(10);
    expect(elsewhere.body.distanceKm).toBe(20);
  });
});

// @traces 271-FR-014
describe('a profile read with a near that cannot be a place in Romania', () => {
  const refused: [string, string][] = [
    ['an empty value', ''],
    ['text', 'cluj'],
    ['one number', '46.771'],
    ['three numbers', '46.771,23.624,100'],
    ['a space after the comma', '46.771, 23.624'],
    ['a space before', ' 46.771,23.624'],
    ['a trailing comma', '46.771,23.624,'],
    ['a semicolon', '46.771;23.624'],
    ['a trailing newline', '46.771,23.624\n'],
    ['an exponent', '4.6771e1,2.3624e1'],
    ['NaN', 'NaN,NaN'],
    ['Infinity', 'Infinity,Infinity'],
    ['a latitude past the pole', '91,24'],
    ['a longitude past the antimeridian', '46,181'],
    ['the null island', '0,0'],
    ['Budapest', '47.4979,19.0402'],
    ['Sofia', '42.6977,23.3219'],
    ['a point in the Black Sea', '44.0,31.0'],
    ['a comma decimal', '46,771,23,624'],
    ['a point swapped lat and lng', '23.624,46.771'],
    ['digits that are not ASCII', '٤٦.٧٧١,٢٣.٦٢٤'],
  ];

  it.each(refused)('answers 400 for %s', async (_, value) => {
    const garage = await fixed(1_000);

    const res = await read(garage.slug, { near: value });

    expect(res.status).toBe(400);
  });

  it('refuses the same near for a mobile mechanic', async () => {
    const garage = await mobile(1_000);

    const res = await read(garage.slug, { near: 'nowhere' });

    expect(res.status).toBe(400);
  });

  it('refuses a near for a garage with no position', async () => {
    const garage = await fixed();

    const res = await read(garage.slug, { near: '0,0' });

    expect(res.status).toBe(400);
  });

  it('refuses near given twice', async () => {
    const garage = await fixed(1_000);

    const res = await request(app.getHttpServer()).get(
      `/garages/${garage.slug}?near=${near}&near=${near}`,
    );

    expect(res.status).toBe(400);
  });

  it('refuses near given as an object', async () => {
    const garage = await fixed(1_000);

    const res = await request(app.getHttpServer()).get(
      `/garages/${garage.slug}?near[lat]=46.771&near[lng]=23.624`,
    );

    expect(res.status).toBe(400);
  });

  it('refuses a near ten thousand characters long without an error', async () => {
    const garage = await fixed(1_000);

    const res = await read(garage.slug, { near: `${'1'.repeat(10_000)},2` });

    expect(res.status).toBe(400);
  });

  it('writes no profile into the cache for a refused near', async () => {
    const garage = await fixed(1_000);

    await read(garage.slug, { near: '0,0' });

    expect(await other.exists(`v1:profile:${garage.slug}:-`)).toBe(0);
  });
});

// @traces 271-FR-014
describe('the profile cache beside near', () => {
  const entries = async (slug: string) => {
    const keys = await other.keys(`v1:profile:${slug}:*`);
    return Promise.all(keys.map(async (key) => [key, await other.get(key)]));
  };

  it('holds no distance and no place after reads with near', async () => {
    const garage = await fixed(3_240);

    await read(garage.slug, { near });
    await read(garage.slug, { near: '45.7512,21.2301' });

    const held = await entries(garage.slug);
    expect(held.length).toBeGreaterThan(0);
    for (const [key, value] of held) {
      expect([key, String(value)]).not.toEqual([
        key,
        expect.stringMatching(/distanceKm|45\.7512|21\.2301/),
      ]);
    }
  });

  it('holds one entry per garage and brand, however many places are asked', async () => {
    const garage = await fixed(3_240);

    for (let i = 0; i < 25; i++) {
      await read(garage.slug, { near: `${45 + i / 100},24` });
    }

    expect(await other.keys(`v1:profile:${garage.slug}:*`)).toHaveLength(1);
  });

  it('gives the next read without near no distance, whoever filled the cache', async () => {
    const garage = await fixed(3_240);

    await read(garage.slug, { near });
    const plain = await read(garage.slug);

    expect(plain.body).not.toHaveProperty('distanceKm');
  });

  it('gives a read with near a distance when the cache was filled without it', async () => {
    const garage = await fixed(3_240);

    await read(garage.slug);
    const withPlace = await read(garage.slug, { near });

    expect(withPlace.body.distanceKm).toBe(3.2);
  });

  it('stores no place anywhere on the server', async () => {
    const garage = await fixed(3_240);

    await read(garage.slug, { near: '46.5551,23.4449' });

    const keys = await other.keys('*');
    const values = await Promise.all(
      keys.map((key) => other.get(key).catch(() => null)),
    );
    expect(values.filter((v) => v?.includes('46.5551'))).toEqual([]);
  });

  it('follows the garage when it moves, on the next read with near', async () => {
    const garage = await fixed(3_240);
    await read(garage.slug, { near });

    await prisma.garage.update({
      data: north(8_000),
      where: { id: garage.id },
    });
    const moved = await read(garage.slug, { near });

    expect(moved.body.distanceKm).toBe(8);
  });

  it('gives a mobile mechanic the same body with and without near', async () => {
    const garage = await mobile(2_000);

    const plain = await read(garage.slug);
    const placed = await read(garage.slug, { near });

    expect(placed.body).toEqual(plain.body);
  });
});

// @traces 091-FR-003 091-FR-005 091-FR-013
import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CarsModule } from './cars.module';
import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import { serialDatabase } from '../../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../../notifications/notifications.testing';

const redisUrl = redisUrlFor(15);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      CarsModule,
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
  await prisma.$disconnect();
});

beforeEach(reset);

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

async function driver(name = 'andrei') {
  const id = await account(name, ['driver']);
  return { auth: bearer(id, 'driver'), id };
}

async function brandId() {
  const { id } = await prisma.brand.upsert({
    create: { active: true, key: 'test-bmw', name: 'BMW', slug: 'test-bmw' },
    update: { active: true },
    where: { name: 'BMW' },
  });
  return id;
}

interface Car {
  id: string;
  updatedAt: string;
  [field: string]: unknown;
}

const add = async (auth: string, extra: Record<string, unknown> = {}) =>
  http()
    .post('/cars')
    .set('Authorization', auth)
    .set('Idempotency-Key', randomUUID())
    .send({
      brandId: await brandId(),
      fuel: 'diesel',
      model: '320d',
      odometerKm: 148_200,
      year: 2019,
      ...extra,
    });

async function saved(auth: string, extra: Record<string, unknown> = {}) {
  const res = await add(auth, extra);
  expect(res.status).toBe(201);
  return res.body as Car;
}

const edit = (auth: string, car: Car, body: Record<string, unknown>) =>
  http()
    .patch(`/cars/${car.id}`)
    .set('Authorization', auth)
    .send({ version: car.updatedAt, ...body });

const hostile: [string, unknown][] = [
  ['a string of digits', '152000'],
  ['a fraction', 152_000.5],
  ['zero', 0],
  ['a negative number', -5],
  ['true', true],
  ['an array', [152_000]],
  ['an object', { km: 152_000 }],
  ['an exponent beyond the ceiling', 1e21],
];

describe('the next oil service value from outside', () => {
  it.each(hostile)(
    'is refused on edit as %s, saving nothing',
    async (_name, value) => {
      const { auth } = await driver();
      const car = await saved(auth);

      const res = await edit(auth, car, { nextServiceKm: value });

      expect(res.status).toBe(400);
      const stored = await prisma.car.findUniqueOrThrow({
        where: { id: car.id },
      });
      expect(stored.nextServiceKm).toBeNull();
    },
  );

  it.each(hostile)(
    'is refused on add as %s, saving no car',
    async (_name, value) => {
      const { auth } = await driver();

      const res = await add(auth, { nextServiceKm: value });

      expect(res.status).toBe(400);
      expect(await prisma.car.count()).toBe(0);
      expect(await prisma.odometerReading.count()).toBe(0);
    },
  );

  it('refuses a value one above the odometer ceiling beside a car at the ceiling', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { odometerKm: 2_000_000 });

    const res = await edit(auth, car, { nextServiceKm: 2_000_001 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      { code: 'next_service_too_far', field: 'nextServiceKm' },
    ]);
  });

  it('refuses a value one above the odometer on a car at the ceiling with next_service_not_above_odometer at the ceiling itself', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { odometerKm: 2_000_000 });

    const res = await edit(auth, car, { nextServiceKm: 2_000_000 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      { code: 'next_service_not_above_odometer', field: 'nextServiceKm' },
    ]);
  });

  it('takes one km above the odometer and answers a due day', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car, { nextServiceKm: 148_201 });

    expect(res.status).toBe(200);
    expect(res.body.nextServiceKm).toBe(148_201);
    expect(typeof res.body.serviceDueOn).toBe('string');
  });

  it('answers a calendar day shaped YYYY-MM-DD in serviceDueOn', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { nextServiceKm: 152_000 });

    expect(car['serviceDueOn']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts null on add as no value and answers null for both fields', async () => {
    const { auth } = await driver();

    const res = await add(auth, { nextServiceKm: null });

    expect(res.status).toBe(201);
    expect(res.body.nextServiceKm).toBeNull();
    expect(res.body.serviceDueOn).toBeNull();
  });

  it('clears a value that is already null without error and without a history row', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car, { nextServiceKm: null });

    expect(res.status).toBe(200);
    expect(
      await prisma.activityLog.count({
        where: { field: 'nextServiceKm', subjectId: car.id },
      }),
    ).toBe(0);
  });

  it('keeps the stored value when the patch leaves the field out', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { nextServiceKm: 152_000 });

    const res = await edit(auth, car, { model: '330d' });

    expect(res.status).toBe(200);
    expect(res.body.nextServiceKm).toBe(152_000);
  });

  it('refuses a stale version with a new next service value and saves nothing', async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    await edit(auth, car, { model: '330d' });

    const res = await edit(auth, car, { nextServiceKm: 152_000 });

    expect(res.status).toBe(409);
    const stored = await prisma.car.findUniqueOrThrow({
      where: { id: car.id },
    });
    expect(stored.nextServiceKm).toBeNull();
  });

  it('judges a lowered odometer: a kept value above it saves and a new value at it is refused', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { nextServiceKm: 152_000 });

    const lowered = await edit(auth, car, { odometerKm: 140_000 });
    expect(lowered.status).toBe(200);
    expect(lowered.body.serviceDueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const res = await edit(auth, lowered.body, {
      nextServiceKm: 139_000,
      odometerKm: 140_000,
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      { code: 'next_service_not_above_odometer', field: 'nextServiceKm' },
    ]);
  });

  it('answers a null day once the odometer reaches the value exactly', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { nextServiceKm: 152_000 });

    const res = await edit(auth, car, { odometerKm: 152_000 });

    expect(res.status).toBe(200);
    expect(res.body.nextServiceKm).toBe(152_000);
    expect(res.body.serviceDueOn).toBeNull();
  });

  it("answers 404 and changes nothing for another account's car, whatever the value", async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    const maria = await driver('maria');

    const valid = await edit(maria.auth, car, { nextServiceKm: 152_000 });
    const invalid = await edit(maria.auth, car, { nextServiceKm: 1 });

    expect(valid.status).toBe(404);
    expect(invalid.status).toBe(404);
    const stored = await prisma.car.findUniqueOrThrow({
      where: { id: car.id },
    });
    expect(stored.nextServiceKm).toBeNull();
  });

  it('keeps nextServiceKm and serviceDueOn in the list and in the single answer alike', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { nextServiceKm: 152_000 });

    const list = await http().get('/cars').set('Authorization', auth);

    expect(list.status).toBe(200);
    const row = (list.body.items ?? list.body).find(
      (c: Car) => c.id === car.id,
    );
    expect(row['nextServiceKm']).toBe(152_000);
    expect(row['serviceDueOn']).toBe(car['serviceDueOn']);
  });

  it('writes one reading, not two, when an edit changes the kilometres and the value together', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    await edit(auth, car, { nextServiceKm: 160_000, odometerKm: 150_000 });

    expect(
      await prisma.odometerReading.count({ where: { carId: car.id } }),
    ).toBe(2);
  });
});

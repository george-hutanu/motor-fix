// @traces 091-FR-001 091-FR-002 091-FR-003 091-FR-005 091-FR-009 091-FR-013 091-FR-017
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CarsModule } from './cars.module';
import { AuditService } from '../../../audit/audit.service';
import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { addDays, localDay } from '../../../bucharest';
import { outboxMark } from '../../../events/outbox.testing';
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
let since: Date;
let mark: bigint;

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

beforeEach(async () => {
  await reset();
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
  mark = await outboxMark(prisma);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const today = localDay(new Date());

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

const readings = (carId: string) =>
  prisma.odometerReading.findMany({
    orderBy: [{ readOn: 'asc' }, { createdAt: 'asc' }],
    where: { carId },
  });

const carAudit = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { at: { gte: since }, subjectId, subjectType: 'car' },
  });

const updates = () =>
  prisma.outboxEvent.findMany({
    where: { id: { gt: mark }, kind: 'car.updated' },
  });

const refusedWith = (res: request.Response, code: string) => {
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('validation_failed');
  expect(res.body.errors).toEqual([{ code, field: 'nextServiceKm' }]);
};

describe('the next oil service on a car', () => {
  it('is set through PATCH and answered with its estimated day', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car, { nextServiceKm: 152_000 });

    expect(res.status).toBe(200);
    expect(res.body.nextServiceKm).toBe(152_000);
    // One reading of today at the 1,000 km default: 3,800 km is 116 days.
    expect(res.body.serviceDueOn).toBe(addDays(today, 116));
    expect(
      (await prisma.car.findUniqueOrThrow({ where: { id: car.id } }))
        .nextServiceKm,
    ).toBe(152_000);
  });

  it('is changed and cleared through PATCH', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { nextServiceKm: 152_000 });

    const changed = await edit(auth, car, { nextServiceKm: 149_700 });
    expect(changed.status).toBe(200);
    expect(changed.body.serviceDueOn).toBe(addDays(today, 46));

    const cleared = await edit(auth, changed.body, { nextServiceKm: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.nextServiceKm).toBeNull();
    expect(cleared.body.serviceDueOn).toBeNull();
  });

  it('is taken when the car is added', async () => {
    const { auth } = await driver();

    const res = await add(auth, { nextServiceKm: 152_000 });

    expect(res.status).toBe(201);
    expect(res.body.nextServiceKm).toBe(152_000);
    expect(res.body.serviceDueOn).toBe(addDays(today, 116));
  });

  it('gives a car without it no estimated day in every answer', async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    expect(car['serviceDueOn']).toBeNull();

    const listed = await http().get('/cars').set('Authorization', auth);
    expect(listed.body.items[0].serviceDueOn).toBeNull();
  });

  it('is listed with the estimated day', async () => {
    const { auth } = await driver();
    await saved(auth, { nextServiceKm: 152_000 });

    const listed = await http().get('/cars').set('Authorization', auth);

    expect(listed.body.items[0].serviceDueOn).toBe(addDays(today, 116));
  });

  it('counts the estimate from the readings of the last year', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { nextServiceKm: 152_000 });
    await prisma.odometerReading.create({
      data: {
        carId: car.id,
        km: 131_900,
        readOn: new Date(`${addDays(today, -365)}T00:00:00Z`),
        source: 'driver',
      },
    });

    const listed = await http().get('/cars').set('Authorization', auth);

    // 16,300 km in 365 days is 44.66 km a day: 3,800 km is 85 days.
    expect(listed.body.items[0].serviceDueOn).toBe(addDays(today, 85));
  });

  it.each([
    ['at', 148_200],
    ['below', 140_000],
  ])('is refused %s the odometer', async (_, nextServiceKm) => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await edit(auth, car, { nextServiceKm });

    refusedWith(res, 'next_service_not_above_odometer');
    expect(await updates()).toHaveLength(0);
  });

  it('is refused more than 100,000 km above the odometer and taken at 100,000', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    refusedWith(
      await edit(auth, car, { nextServiceKm: 248_201 }),
      'next_service_too_far',
    );
    expect((await edit(auth, car, { nextServiceKm: 248_200 })).status).toBe(
      200,
    );
  });

  it('is refused above the odometer ceiling', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { odometerKm: 1_950_000 });

    refusedWith(
      await edit(auth, car, { nextServiceKm: 2_000_001 }),
      'next_service_too_far',
    );
  });

  it('is refused when the car is added with it at its odometer', async () => {
    const { auth } = await driver();

    const res = await add(auth, { nextServiceKm: 148_200 });

    refusedWith(res, 'next_service_not_above_odometer');
    expect(await prisma.car.count()).toBe(0);
  });

  it('is judged against the odometer the same edit leaves', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    refusedWith(
      await edit(auth, car, { nextServiceKm: 152_000, odometerKm: 152_500 }),
      'next_service_not_above_odometer',
    );
    expect(
      (await edit(auth, car, { nextServiceKm: 160_000, odometerKm: 152_500 }))
        .status,
    ).toBe(200);
  });

  it('is not checked again when the edit leaves it as stored', async () => {
    const { auth } = await driver();
    const car = await saved(auth, { nextServiceKm: 152_000 });

    const raised = await edit(auth, car, { odometerKm: 153_000 });
    expect(raised.status).toBe(200);
    expect(raised.body.serviceDueOn).toBeNull();

    const resent = await edit(auth, raised.body, {
      model: '330d',
      nextServiceKm: 152_000,
    });
    expect(resent.status).toBe(200);
  });

  it('writes its old and new value to the history and names it in car.updated', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    await edit(auth, car, { nextServiceKm: 152_000, odometerKm: 149_000 });

    const entries = (await carAudit(car.id)).filter(
      (e) => e.action === 'update',
    );
    expect(entries.map((e) => [e.field, e.oldValue, e.newValue])).toEqual([
      ['nextServiceKm', null, 152_000],
      ['odometerKm', 148_200, 149_000],
    ]);
    const [event] = await updates();
    expect((event.payload as { changed: string[] }).changed.sort()).toEqual([
      'nextServiceKm',
      'odometerKm',
    ]);
  });

  it("answers 404 for another account's car", async () => {
    const andrei = await driver('andrei');
    const maria = await driver('maria');
    const car = await saved(andrei.auth);

    const res = await edit(maria.auth, car, { nextServiceKm: 152_000 });

    expect(res.status).toBe(404);
    expect(
      (await prisma.car.findUniqueOrThrow({ where: { id: car.id } }))
        .nextServiceKm,
    ).toBeNull();
  });
});

describe('the odometer readings of a car', () => {
  it('start with one driver reading of today when the car is added', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const rows = await readings(car.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      km: 148_200,
      source: 'driver',
      sourceId: null,
    });
    expect(rows[0].readOn.toISOString().slice(0, 10)).toBe(today);
  });

  it('gain one reading for each change of the kilometres, the newest being the odometer', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const first = await edit(auth, car, { odometerKm: 149_000 });
    await edit(auth, first.body, { odometerKm: 150_500 });

    const rows = await readings(car.id);
    expect(rows.map((r) => r.km)).toEqual([148_200, 149_000, 150_500]);
    expect(
      (await prisma.car.findUniqueOrThrow({ where: { id: car.id } }))
        .odometerKm,
    ).toBe(150_500);
  });

  it('gain none from an edit that leaves the kilometres as they are', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    await edit(auth, car, { model: '330d', odometerKm: 148_200 });

    expect(await readings(car.id)).toHaveLength(1);
  });

  it('gain none when the edit fails to write its history', async () => {
    const { auth } = await driver();
    const car = await saved(auth);
    jest
      .spyOn(AuditService.prototype, 'recordChanges')
      .mockRejectedValue(new Error('history down'));

    const res = await edit(auth, car, { odometerKm: 149_000 });

    expect(res.status).toBe(500);
    expect(await readings(car.id)).toHaveLength(1);
  });

  it('are removed with the account', async () => {
    const { auth, id } = await driver();
    const car = await saved(auth);

    await prisma.account.delete({ where: { id } });

    expect(await readings(car.id)).toHaveLength(0);
  });

  it('are kept but no longer answered once the car is removed', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    await http().delete(`/cars/${car.id}`).set('Authorization', auth);

    expect(await readings(car.id)).toHaveLength(1);
    const listed = await http().get('/cars').set('Authorization', auth);
    expect(listed.body.items).toEqual([]);
  });

  it('are back-filled with one driver reading per car, on the Bucharest day it last changed', async () => {
    const { id } = await driver();
    // 22:30 UTC on 7 October is already 8 October in Bucharest.
    const updatedAt = new Date('2026-10-07T22:30:00Z');
    const car = await prisma.car.create({
      data: {
        brandId: await brandId(),
        fuel: 'diesel',
        idempotencyKey: randomUUID(),
        model: '320d',
        odometerKm: 148_200,
        ownerId: id,
        updatedAt,
        year: 2019,
      },
    });
    const dir = join(__dirname, '../../../../prisma/migrations');
    const folder = readdirSync(dir).find((f) =>
      f.endsWith('_odometer_readings'),
    );
    const sql = readFileSync(join(dir, `${folder}/migration.sql`), 'utf8');
    const backFill = sql.slice(sql.indexOf('INSERT INTO "odometer_reading"'));

    await prisma.$executeRawUnsafe(backFill);

    const rows = await readings(car.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ km: 148_200, source: 'driver' });
    expect(rows[0].readOn.toISOString().slice(0, 10)).toBe('2026-10-08');
  });

  it('have no route of their own', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    const res = await http()
      .get(`/cars/${car.id}/readings`)
      .set('Authorization', auth);

    expect(res.status).toBe(404);
  });

  it('refuse a negative kilometre count in the table itself', async () => {
    const { auth } = await driver();
    const car = await saved(auth);

    await expect(
      prisma.odometerReading.create({
        data: { carId: car.id, km: -1, readOn: new Date(), source: 'driver' },
      }),
    ).rejects.toThrow();
  });
});

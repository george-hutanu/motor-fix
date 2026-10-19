import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
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

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
const redis = new Redis(redisUrl);

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
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
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

// Service Auto Nord, approved, labour 180 – 240 lei, with its owner Mihai, a
// receptionist and a mechanic; front brakes at 890 – 1.400 lei, 2 h, with a
// BMW range; Atelier Dinamo with its owner Radu and a row of its own.
async function world() {
  const nord = await prisma.garage.create({
    data: {
      labourFromBani: 18_000,
      labourToBani: 24_000,
      name: 'Service Auto Nord',
      slug: `nord-${randomUUID()}`,
      status: 'approved',
    },
  });
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: nord.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: nord.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  await prisma.mechanic.create({
    data: { accountId: vlad, garageId: nord.id, name: 'Mecanic' },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: dinamo.id, role: 'owner' },
  });
  const brakes = await prisma.jobType.create({
    data: {
      key: `brakes-${randomUUID()}`,
      nameEn: 'Front brakes',
      nameRo: 'Frâne față',
      status: 'approved',
    },
  });
  const row = await prisma.garagePrice.create({
    data: {
      durationMinutes: 120,
      fromBani: 89_000,
      garageId: nord.id,
      jobTypeId: brakes.id,
      position: 0,
      toBani: 140_000,
      updatedBy: mihai,
    },
  });
  const bmw = await prisma.brand.create({
    data: {
      key: `bmw-${randomUUID()}`,
      name: 'BMW',
      slug: `bmw-${randomUUID()}`,
    },
  });
  await prisma.garageBrand.create({
    data: { brandId: bmw.id, garageId: nord.id, stance: 'works_on' },
  });
  const brandRow = await prisma.garagePrice.create({
    data: {
      brandId: bmw.id,
      fromBani: 110_000,
      garageId: nord.id,
      jobTypeId: brakes.id,
      position: 0,
      toBani: 170_000,
      updatedBy: mihai,
    },
  });
  const theirs = await prisma.garagePrice.create({
    data: {
      fromBani: 50_000,
      garageId: dinamo.id,
      jobTypeId: brakes.id,
      position: 0,
      toBani: 60_000,
      updatedBy: radu,
    },
  });
  return {
    brakes,
    brandRow,
    dinamo,
    mechanic: bearer(vlad, 'mechanic'),
    mihai,
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
    row,
    theirs,
  };
}

type World = Awaited<ReturnType<typeof world>>;

const brandPath = (w: World, brandId: string) =>
  `/garages/${w.nord.id}/prices/${w.brakes.id}/brands/${brandId}`;
const putBrand = (w: World, brandId: string, body: unknown) =>
  http()
    .put(brandPath(w, brandId))
    .set('Authorization', w.owner)
    .send(body as object);
const stamp = (w: World) => w.row.updatedAt.toISOString();
const setRange = (w: World, body: Record<string, unknown>, at = stamp(w)) =>
  http()
    .patch(`/garages/${w.nord.id}/prices/${w.row.id}`)
    .set('Authorization', w.owner)
    .send({ expectedUpdatedAt: at, ...body });
const setLabour = (w: World, body: unknown) =>
  http()
    .patch(`/garages/${w.nord.id}/labour`)
    .set('Authorization', w.owner)
    .send(body as object);
const entries = (w: World) =>
  prisma.activityLog.findMany({
    orderBy: [{ at: 'asc' }, { field: 'asc' }],
    where: { garageId: w.nord.id },
  });
const keys = (value: unknown) => Object.keys(value as object).sort();

// @traces 176-FR-002 176-FR-006
describe('what a repeated or refused range save records', () => {
  it('writes one entry when the same save is sent twice with a fresh stamp', async () => {
    const w = await world();
    const body = { durationMinutes: 120, fromBani: 95_000, toBani: 145_000 };
    const first = await setRange(w, body);
    expect(first.status).toBe(200);

    const second = await setRange(w, body, first.body.updatedAt);

    expect(second.status).toBe(200);
    expect(await entries(w)).toEqual([
      expect.objectContaining({
        field: 'range',
        newValue: { from: 95_000, to: 145_000 },
        oldValue: { from: 89_000, to: 140_000 },
      }),
    ]);
  });

  it('writes nothing when a save is refused as invalid', async () => {
    const w = await world();

    const res = await setRange(w, {
      durationMinutes: 50,
      fromBani: 150_000,
      toBani: 145_000,
    });
    const labour = await setLabour(w, { fromBani: 30_000, toBani: 20_000 });

    expect(res.status).toBe(422);
    expect(labour.status).toBe(422);
    expect(await entries(w)).toEqual([]);
  });
});

// @traces 176-FR-002 176-FR-004 176-FR-007
describe('the values a range entry stores', () => {
  it('stores exactly the from and to keys, even for a cleared top', async () => {
    const w = await world();

    await setRange(w, { durationMinutes: 120, fromBani: 89_000, toBani: null });

    const [entry, ...rest] = await entries(w);
    expect(rest).toEqual([]);
    expect(keys(entry.oldValue)).toEqual(['from', 'to']);
    expect(keys(entry.newValue)).toEqual(['from', 'to']);
    expect(entry.newValue).toEqual({ from: 89_000, to: null });
  });

  it('records a labour change of one end as one entry with both ends', async () => {
    const w = await world();

    const res = await setLabour(w, { fromBani: 18_000, toBani: 26_000 });

    expect(res.status).toBe(200);
    const [entry, ...rest] = await entries(w);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      field: 'labour_range',
      newValue: { from: 18_000, to: 26_000 },
      oldValue: { from: 18_000, to: 24_000 },
      subjectId: w.nord.id,
      subjectType: 'garage',
    });
    expect(keys(entry.newValue)).toEqual(['from', 'to']);
  });
});

// @traces 176-FR-005 176-FR-006
describe('the brand range entries', () => {
  it('stores exactly four keys on create, update and delete', async () => {
    const w = await world();
    const audi = await prisma.brand.create({
      data: {
        key: `audi-${randomUUID()}`,
        name: 'Audi',
        slug: `audi-${randomUUID()}`,
      },
    });
    await prisma.garageBrand.create({
      data: { brandId: audi.id, garageId: w.nord.id, stance: 'works_on' },
    });

    expect(
      (await putBrand(w, audi.id, { fromBani: 110_000, toBani: 160_000 }))
        .status,
    ).toBe(200);
    expect(
      (await putBrand(w, audi.id, { fromBani: 120_000, toBani: 170_000 }))
        .status,
    ).toBe(200);
    expect(
      (await http().delete(brandPath(w, audi.id)).set('Authorization', w.owner))
        .status,
    ).toBe(204);

    const brandEntries = (await entries(w)).filter(
      ({ field }) => field === 'brand_range',
    );
    expect(brandEntries.map(({ action }) => action)).toEqual([
      'create',
      'update',
      'delete',
    ]);
    const ids = { brandId: audi.id, jobTypeId: w.brakes.id };
    expect(
      brandEntries.map(({ oldValue, newValue }) => [oldValue, newValue]),
    ).toEqual([
      [null, { ...ids, from: 110_000, to: 160_000 }],
      [
        { ...ids, from: 110_000, to: 160_000 },
        { ...ids, from: 120_000, to: 170_000 },
      ],
      [{ ...ids, from: 120_000, to: 170_000 }, null],
    ]);
    expect(
      brandEntries.every(
        ({ kind, isKeyChange, internal }) =>
          kind === 'price_list' && !isKeyChange && !internal,
      ),
    ).toBe(true);
  });

  it('writes nothing when a brand range is saved again unchanged', async () => {
    const w = await world();

    const res = await putBrand(w, w.brandRow.brandId as string, {
      fromBani: 110_000,
      toBani: 170_000,
    });

    expect(res.status).toBe(200);
    expect(await entries(w)).toEqual([]);
  });
});

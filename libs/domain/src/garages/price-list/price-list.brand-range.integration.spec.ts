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

const brand = (name: string, popularity: number | null = null) =>
  prisma.brand.create({
    data: {
      key: `${name}-${randomUUID()}`,
      name,
      popularity,
      slug: `${name.toLowerCase()}-${randomUUID()}`,
    },
  });

// Service Auto Nord, approved, with its owner Mihai, a receptionist and a
// mechanic, front brakes at 890 – 1.400 lei and BMW taken; Atelier Dinamo
// with its owner Radu; and an admin.
async function world() {
  const nord = await prisma.garage.create({
    data: {
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
  const ana = await account('ana', ['admin']);
  const brakes = await prisma.jobType.create({
    data: {
      key: `brakes-${randomUUID()}`,
      nameEn: 'Front brake pads',
      nameRo: 'Plăcuțe frână față',
      status: 'approved',
    },
  });
  await prisma.garagePrice.create({
    data: {
      fromBani: 89_000,
      garageId: nord.id,
      jobTypeId: brakes.id,
      position: 3,
      toBani: 140_000,
      updatedBy: mihai,
    },
  });
  const bmw = await brand('BMW', 2);
  await take(nord.id, bmw.id);
  return {
    admin: bearer(ana, 'admin'),
    bmw,
    brakes,
    mechanic: bearer(vlad, 'mechanic'),
    mihai,
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

// A refused brand carries no fuel tick (`garage_brand_fuel_check`).
const NO_FUEL = {
  diesel: false,
  electric: false,
  hybrid: false,
  petrol: false,
};

const take = (
  garageId: string,
  brandId: string,
  stance: 'works_on' | 'does_not_take' = 'works_on',
) =>
  prisma.garageBrand.create({
    data: {
      brandId,
      garageId,
      stance,
      ...(stance === 'works_on' ? {} : NO_FUEL),
    },
  });

const path = (w: World, brandId = w.bmw.id, jobTypeId = w.brakes.id) =>
  `/garages/${w.nord.id}/prices/${jobTypeId}/brands/${brandId}`;

const put = (
  w: World,
  body: unknown,
  { as = w.owner, to = path(w) }: { as?: string | null; to?: string } = {},
) => {
  const req = http().put(to);
  return (as ? req.set('Authorization', as) : req).send(body as object);
};

const remove = (
  w: World,
  { as = w.owner, to = path(w) }: { as?: string | null; to?: string } = {},
) => {
  const req = http().delete(to);
  return as ? req.set('Authorization', as) : req;
};

const brandRows = (w: World) =>
  prisma.garagePrice.findMany({
    select: { brandId: true, fromBani: true, toBani: true },
    where: { brandId: { not: null }, garageId: w.nord.id },
  });

const history = (w: World) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { garageId: w.nord.id, subjectType: 'garage_price' },
  });

const events = (w: World) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { kind: 'price_list.updated', subjectId: w.nord.id },
  });

const errorsOf = (body: { errors?: { code: string; field: string }[] }) =>
  (body.errors ?? []).map(({ code, field }) => `${field}:${code}`).sort();

const BMW_RANGE = { fromBani: 110_000, toBani: 170_000 };

// @traces 386-FR-005
describe('PUT /garages/:garageId/prices/:jobTypeId/brands/:brandId', () => {
  it('creates the brand row and answers it with no warning', async () => {
    const w = await world();

    const res = await put(w, BMW_RANGE);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brandId: w.bmw.id,
      jobTypeId: w.brakes.id,
      warnings: [],
      ...BMW_RANGE,
    });
    const [row] = await prisma.garagePrice.findMany({
      where: { brandId: w.bmw.id, garageId: w.nord.id },
    });
    expect(row).toMatchObject({
      position: 3,
      updatedBy: w.mihai,
      visible: true,
      ...BMW_RANGE,
    });
  });

  it('changes the pair in place on a second write, never a second row', async () => {
    const w = await world();
    await put(w, BMW_RANGE);

    const res = await put(w, { fromBani: 120_000, toBani: 180_000 });

    expect(res.status).toBe(200);
    expect(await brandRows(w)).toEqual([
      { brandId: w.bmw.id, fromBani: 120_000, toBani: 180_000 },
    ]);
  });

  it('warns of a wide range and still stores it', async () => {
    const w = await world();

    const res = await put(w, { fromBani: 50_000, toBani: 150_001 });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([
      expect.objectContaining({ code: 'wide_range', field: 'toBani' }),
    ]);
    expect(await brandRows(w)).toHaveLength(1);
  });

  it('accepts a brand retired from the catalogue that the garage still takes', async () => {
    const w = await world();
    await prisma.brand.update({
      data: { active: false },
      where: { id: w.bmw.id },
    });

    expect((await put(w, BMW_RANGE)).status).toBe(200);
  });

  it('allows the owner of a garage not yet live', async () => {
    const w = await world();
    await prisma.garage.update({
      data: { status: 'draft' },
      where: { id: w.nord.id },
    });

    expect((await put(w, BMW_RANGE)).status).toBe(200);
  });
});

// @traces 386-FR-006
describe('what the brand range write refuses', () => {
  it.each<[string, Record<string, unknown>, string[]]>([
    ['no top price', { fromBani: 110_000 }, ['toBani:required']],
    ['no low price', { toBani: 170_000 }, ['fromBani:required']],
    [
      'prices that are not whole bani',
      { fromBani: 1.5, toBani: '2' },
      ['fromBani:integer', 'toBani:integer'],
    ],
    [
      'a low price under one leu',
      { fromBani: 99, toBani: 170_000 },
      ['fromBani:min'],
    ],
    [
      'prices above the cap',
      { fromBani: 10_000_001, toBani: 10_000_002 },
      ['fromBani:max', 'toBani:max'],
    ],
    [
      'a top price below the low one',
      { fromBani: 170_000, toBani: 110_000 },
      ['toBani:below_from'],
    ],
  ])('refuses %s', async (_case, body, expected) => {
    const w = await world();

    const res = await put(w, body);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_failed');
    expect(errorsOf(res.body)).toEqual(expected);
    expect(await brandRows(w)).toEqual([]);
  });

  it('refuses a brand with no catalogue row', async () => {
    const w = await world();

    const res = await put(w, BMW_RANGE, { to: path(w, randomUUID()) });

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['brandId:unknown_brand']);
  });

  it.each<[string, 'does_not_take' | null]>([
    ['refused', 'does_not_take'],
    ['never stated', null],
  ])('refuses a brand the garage has %s', async (_case, stance) => {
    const w = await world();
    const audi = await brand('Audi');
    if (stance) await take(w.nord.id, audi.id, stance);

    const res = await put(w, BMW_RANGE, { to: path(w, audi.id) });

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['brandId:not_taken']);
  });

  it('refuses a job the garage does not list', async () => {
    const w = await world();
    const chain = await prisma.jobType.create({
      data: {
        key: `chain-${randomUUID()}`,
        nameEn: 'Timing chain',
        nameRo: 'Kit lanț',
        status: 'approved',
      },
    });

    const res = await put(w, BMW_RANGE, { to: path(w, w.bmw.id, chain.id) });

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['jobTypeId:unknown_job']);
  });

  it('refuses a job held only by brand rows, with no default range', async () => {
    const w = await world();
    const audi = await brand('Audi');
    await take(w.nord.id, audi.id);
    await prisma.garagePrice.updateMany({
      data: { brandId: audi.id },
      where: { brandId: null, garageId: w.nord.id },
    });

    const res = await put(w, BMW_RANGE);

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['jobTypeId:no_default_range']);
  });

  it('names every independent error in one answer', async () => {
    const w = await world();
    const audi = await brand('Audi');

    const res = await put(
      w,
      { fromBani: 99 },
      { to: path(w, audi.id, randomUUID()) },
    );

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual([
      'brandId:not_taken',
      'fromBani:min',
      'jobTypeId:unknown_job',
      'toBani:required',
    ]);
  });

  it('answers racing writes of one pair with one row, never a server error', async () => {
    const w = await world();

    const answers = await Promise.all(
      Array.from({ length: 4 }, () => put(w, BMW_RANGE)),
    );

    for (const res of answers) {
      if (res.status === 200) continue;
      expect(res.status).toBe(422);
      expect(errorsOf(res.body)).toEqual(['brandId:duplicate']);
    }
    expect(await brandRows(w)).toEqual([{ brandId: w.bmw.id, ...BMW_RANGE }]);
  });

  it.each<[string, (w: World) => string]>([
    ['garage', (w) => path(w).replace(w.nord.id, 'nord')],
    ['job', (w) => path(w, w.bmw.id, 'brakes')],
    ['brand', (w) => path(w, 'bmw')],
  ])('answers 400 to a %s id that is not a uuid', async (_case, to) => {
    const w = await world();

    expect((await put(w, BMW_RANGE, { to: to(w) })).status).toBe(400);
  });

  it('answers 400 to an unknown body key', async () => {
    const w = await world();

    const res = await put(w, { ...BMW_RANGE, visible: false });

    expect(res.status).toBe(400);
    expect(await brandRows(w)).toEqual([]);
  });

  it('refuses a body that is not JSON', async () => {
    const w = await world();

    const res = await http()
      .put(path(w))
      .set('Authorization', w.owner)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('fromBani=110000&toBani=170000');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await brandRows(w)).toEqual([]);
  });
});

// @traces 386-FR-007
describe('DELETE /garages/:garageId/prices/:jobTypeId/brands/:brandId', () => {
  it('removes the brand row and keeps the default', async () => {
    const w = await world();
    await put(w, BMW_RANGE);

    const res = await remove(w);

    expect(res.status).toBe(204);
    expect(await brandRows(w)).toEqual([]);
    expect(
      await prisma.garagePrice.count({
        where: { brandId: null, garageId: w.nord.id },
      }),
    ).toBe(1);
  });

  it('removes the range of a brand the garage no longer takes', async () => {
    const w = await world();
    await put(w, BMW_RANGE);
    await prisma.garageBrand.update({
      data: { stance: 'does_not_take', ...NO_FUEL },
      where: { garageId_brandId: { brandId: w.bmw.id, garageId: w.nord.id } },
    });

    expect((await remove(w)).status).toBe(204);
  });

  it('answers 404 when the pair has no row', async () => {
    const w = await world();

    const res = await remove(w);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 400 to an id that is not a uuid', async () => {
    const w = await world();

    expect((await remove(w, { to: path(w, 'bmw') })).status).toBe(400);
  });
});

// @traces 386-FR-008
describe('who may set or remove a brand range', () => {
  it.each<[string, (w: World) => string | null, number]>([
    ['the receptionist', (w) => w.receptionist, 403],
    ['the mechanic', (w) => w.mechanic, 403],
    ["another garage's owner", (w) => w.other, 404],
    ['an admin', (w) => w.admin, 404],
    ['a visitor without a session', () => null, 401],
  ])('refuses %s', async (_case, as, status) => {
    const w = await world();
    await put(w, BMW_RANGE);

    expect(
      (await put(w, { fromBani: 1_000, toBani: 2_000 }, { as: as(w) })).status,
    ).toBe(status);
    expect((await remove(w, { as: as(w) })).status).toBe(status);
    expect(await brandRows(w)).toEqual([{ brandId: w.bmw.id, ...BMW_RANGE }]);
  });
});

// @traces 386-FR-009 176-FR-005
describe('the audit history of a brand range', () => {
  it('records the creation, the change with old and new values, and the removal', async () => {
    const w = await world();

    await put(w, BMW_RANGE);
    await put(w, { fromBani: 120_000, toBani: 170_000 });
    await remove(w);

    const entries = await history(w);
    expect(entries.map((e) => e.action)).toEqual([
      'create',
      'update',
      'delete',
    ]);
    expect(entries.every((e) => e.actorId === w.mihai)).toBe(true);
    expect(entries.every((e) => e.actorRole === 'owner')).toBe(true);
    const [created, updated, deleted] = entries;
    const pair = { brandId: w.bmw.id, jobTypeId: w.brakes.id };
    expect(entries.every((e) => e.field === 'brand_range')).toBe(true);
    expect(entries.every((e) => e.kind === 'price_list')).toBe(true);
    expect(created?.oldValue).toBeNull();
    expect(created?.newValue).toEqual({ ...pair, from: 110_000, to: 170_000 });
    expect(updated?.oldValue).toEqual({ ...pair, from: 110_000, to: 170_000 });
    expect(updated?.newValue).toEqual({ ...pair, from: 120_000, to: 170_000 });
    expect(deleted?.oldValue).toEqual({ ...pair, from: 120_000, to: 170_000 });
    expect(deleted?.newValue).toBeNull();
  });

  it('records nothing for a write that changes nothing', async () => {
    const w = await world();
    await put(w, BMW_RANGE);

    const res = await put(w, BMW_RANGE);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(BMW_RANGE);
    expect(await history(w)).toHaveLength(1);
    expect(await events(w)).toHaveLength(1);
  });

  it('records nothing for a refused write', async () => {
    const w = await world();

    await put(w, { fromBani: 99 });

    expect(await history(w)).toEqual([]);
    expect(await events(w)).toEqual([]);
  });
});

// @traces 386-FR-010
describe('what a brand range change tells the profile', () => {
  it('saves one price list event per change to the staff and the public page', async () => {
    const w = await world();

    await put(w, BMW_RANGE);
    await remove(w);

    const sent = await events(w);
    expect(sent).toHaveLength(2);
    for (const event of sent) {
      expect(event.payload).toEqual({
        brandIds: [w.bmw.id],
        garageId: w.nord.id,
        jobTypeIds: [w.brakes.id],
      });
      expect([...event.audience].sort()).toEqual([
        `garage:${w.nord.id}`,
        `public:garage:${w.nord.id}`,
      ]);
    }
  });

  it("forgets the written brand's profile entry and keeps the others", async () => {
    const w = await world();
    const audi = await brand('Audi');
    await take(w.nord.id, audi.id);
    const profile = (slug?: string) =>
      http()
        .get(`/garages/${w.nord.slug}`)
        .query(slug ? { brand: slug } : {});
    await profile();
    await profile(w.bmw.slug);
    await profile(audi.slug);
    const entry = (slug: string) => `v1:profile:${w.nord.slug}:${slug}`;

    await put(w, BMW_RANGE);

    expect(await redis.exists(entry(w.bmw.slug))).toBe(0);
    expect(await redis.exists(entry('-'))).toBe(1);
    expect(await redis.exists(entry(audi.slug))).toBe(1);
    const res = await profile(w.bmw.slug);
    expect(res.body.prices).toEqual([
      expect.objectContaining({ jobTypeId: w.brakes.id, ...BMW_RANGE }),
    ]);
  });
});

// @traces 386-FR-002
describe('the profile range of a brand by its stance', () => {
  it('gives the default range to a brand the garage has not stated', async () => {
    const w = await world();
    const audi = await brand('Audi');
    await prisma.garagePrice.create({
      data: {
        brandId: audi.id,
        fromBani: 200_000,
        garageId: w.nord.id,
        jobTypeId: w.brakes.id,
        position: 3,
        toBani: 300_000,
        updatedBy: w.mihai,
      },
    });

    const res = await http()
      .get(`/garages/${w.nord.slug}`)
      .query({ brand: audi.slug });

    expect(res.body.prices).toEqual([
      expect.objectContaining({ fromBani: 89_000, toBani: 140_000 }),
    ]);
  });
});

// @traces 386-FR-011
describe("the owner's read of brand ranges", () => {
  it('lists each job its brand rows in catalogue order, and none as empty', async () => {
    const w = await world();
    const dacia = await brand('Dacia', 1);
    const audi = await brand('Audi');
    const alfa = await brand('Alfa Romeo');
    for (const b of [dacia, audi, alfa]) await take(w.nord.id, b.id);
    const oil = await prisma.jobType.create({
      data: {
        key: `oil-${randomUUID()}`,
        nameEn: 'Oil change',
        nameRo: 'Schimb ulei',
        status: 'approved',
      },
    });
    await prisma.garagePrice.create({
      data: {
        fromBani: 30_000,
        garageId: w.nord.id,
        jobTypeId: oil.id,
        position: 4,
        toBani: 40_000,
        updatedBy: w.mihai,
      },
    });
    await put(w, BMW_RANGE);
    await put(
      w,
      { fromBani: 100_000, toBani: 150_000 },
      { to: path(w, audi.id) },
    );
    await put(
      w,
      { fromBani: 95_000, toBani: 145_000 },
      { to: path(w, dacia.id) },
    );
    await prisma.garagePrice.create({
      data: {
        brandId: alfa.id,
        fromBani: 130_000,
        garageId: w.nord.id,
        jobTypeId: w.brakes.id,
        position: 3,
        toBani: null,
        updatedBy: w.mihai,
      },
    });

    const res = await http()
      .get(`/garages/${w.nord.id}/prices`)
      .set('Authorization', w.owner);

    expect(res.status).toBe(200);
    const [brakes, oilItem] = res.body.items;
    expect(brakes.brandRanges).toEqual([
      { brandId: dacia.id, fromBani: 95_000, name: 'Dacia', toBani: 145_000 },
      { brandId: w.bmw.id, name: 'BMW', ...BMW_RANGE },
      { brandId: alfa.id, fromBani: 130_000, name: 'Alfa Romeo' },
      { brandId: audi.id, fromBani: 100_000, name: 'Audi', toBani: 150_000 },
    ]);
    expect(oilItem.brandRanges).toEqual([]);
  });
});

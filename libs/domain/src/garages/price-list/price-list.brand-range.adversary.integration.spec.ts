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

// @traces 386-FR-006
describe('brand range write at the edges', () => {
  it.each<[string, Record<string, unknown>]>([
    ['the lowest low price and an equal top', { fromBani: 100, toBani: 100 }],
    ['the highest prices', { fromBani: 10_000_000, toBani: 10_000_000 }],
  ])('accepts %s', async (_case, body) => {
    const w = await world();

    const res = await put(w, body);

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
    expect(await brandRows(w)).toEqual([{ brandId: w.bmw.id, ...body }]);
  });

  it('warns on a top just over three times the low price and not at exactly three', async () => {
    const w = await world();

    const exact = await put(w, { fromBani: 50_000, toBani: 150_000 });
    const over = await put(w, { fromBani: 50_000, toBani: 150_001 });

    expect(exact.body.warnings).toEqual([]);
    expect(over.body.warnings).toEqual([
      expect.objectContaining({ code: 'wide_range', field: 'toBani' }),
    ]);
  });

  it.each<[string, unknown, string[]]>([
    [
      'null prices',
      { fromBani: null, toBani: null },
      ['fromBani:required', 'toBani:required'],
    ],
    ['an empty object', {}, ['fromBani:required', 'toBani:required']],
    ['negative prices', { fromBani: -5, toBani: -1 }, ['fromBani:min']],
    [
      'numeric strings',
      { fromBani: '110000', toBani: '170000' },
      ['fromBani:integer', 'toBani:integer'],
    ],
    [
      'an enormous number',
      { fromBani: 1e21, toBani: 1e21 },
      ['fromBani:max', 'toBani:max'],
    ],
    [
      'booleans',
      { fromBani: true, toBani: false },
      ['fromBani:integer', 'toBani:integer'],
    ],
    [
      'nested objects',
      { fromBani: {}, toBani: [] },
      ['fromBani:integer', 'toBani:integer'],
    ],
  ])(
    'refuses %s with 422 and stores nothing',
    async (_case, body, expected) => {
      const w = await world();

      const res = await put(w, body);

      expect(res.status).toBe(422);
      expect(errorsOf(res.body)).toEqual(expect.arrayContaining(expected));
      expect(await brandRows(w)).toEqual([]);
      expect(await history(w)).toEqual([]);
    },
  );

  it('answers a client error, never a server error, to an array body', async () => {
    const w = await world();

    const res = await put(w, [BMW_RANGE]);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await brandRows(w)).toEqual([]);
  });

  it('refuses a job that belongs to another garage as unknown', async () => {
    const w = await world();
    const radu = await prisma.garageMember.findFirstOrThrow({
      where: { garageId: { not: w.nord.id } },
    });
    const wipers = await prisma.jobType.create({
      data: {
        key: `wipers-${randomUUID()}`,
        nameEn: 'Wipers',
        nameRo: 'Stergatoare',
        status: 'approved',
      },
    });
    await prisma.garagePrice.create({
      data: {
        fromBani: 1_000,
        garageId: radu.garageId,
        jobTypeId: wipers.id,
        position: 1,
        toBani: 2_000,
        updatedBy: radu.accountId,
      },
    });

    const res = await put(w, BMW_RANGE, { to: path(w, w.bmw.id, wipers.id) });

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['jobTypeId:unknown_job']);
  });

  it("never lets the owner of one garage write into another garage's pair", async () => {
    const w = await world();
    const dinamoId = (
      await prisma.garageMember.findFirstOrThrow({
        where: { garageId: { not: w.nord.id } },
      })
    ).garageId;

    const res = await put(w, BMW_RANGE, {
      as: w.other,
      to: `/garages/${w.nord.id}/prices/${w.brakes.id}/brands/${w.bmw.id}`,
    });

    expect(res.status).toBe(404);
    expect(
      await prisma.garagePrice.count({ where: { garageId: dinamoId } }),
    ).toBe(0);
    expect(await brandRows(w)).toEqual([]);
  });
});

// @traces 386-FR-007
describe('brand range removal twice and beside a write', () => {
  it('answers 404 to a second removal and records one delete', async () => {
    const w = await world();
    await put(w, BMW_RANGE);

    const first = await remove(w);
    const second = await remove(w);

    expect(first.status).toBe(204);
    expect(first.text).toBe('');
    expect(second.status).toBe(404);
    expect(second.body.code).toBe('not_found');
    expect((await history(w)).map((e) => e.action)).toEqual([
      'create',
      'delete',
    ]);
    expect(await events(w)).toHaveLength(2);
  });

  it('answers 404 and keeps every row when asked to remove the default through an unknown brand', async () => {
    const w = await world();

    const res = await remove(w, { to: path(w, randomUUID()) });

    expect(res.status).toBe(404);
    expect(
      await prisma.garagePrice.count({
        where: { brandId: null, garageId: w.nord.id },
      }),
    ).toBe(1);
  });

  it('writes and removes at once without a server error and leaves at most one row', async () => {
    const w = await world();
    await put(w, BMW_RANGE);

    const answers = await Promise.all([
      put(w, { fromBani: 120_000, toBani: 180_000 }),
      remove(w),
      put(w, { fromBani: 130_000, toBani: 190_000 }),
      remove(w),
    ]);

    for (const res of answers)
      expect([200, 204, 404, 422]).toContain(res.status);
    expect((await brandRows(w)).length).toBeLessThanOrEqual(1);
  });

  it('forgets the brand profile entry on removal and serves the default after it', async () => {
    const w = await world();
    await put(w, BMW_RANGE);
    const profile = () =>
      http().get(`/garages/${w.nord.slug}`).query({ brand: w.bmw.slug });
    expect((await profile()).body.prices[0]).toMatchObject(BMW_RANGE);

    await remove(w);

    expect(await redis.exists(`v1:profile:${w.nord.slug}:${w.bmw.slug}`)).toBe(
      0,
    );
    expect((await profile()).body.prices[0]).toMatchObject({
      fromBani: 89_000,
      toBani: 140_000,
    });
  });
});

// @traces 386-FR-002
describe('the profile range when the garage changes its stance', () => {
  it('drops the brand range when the brand is refused and brings it back when taken again', async () => {
    const w = await world();
    await put(w, BMW_RANGE);
    const where = {
      garageId_brandId: { brandId: w.bmw.id, garageId: w.nord.id },
    };
    const profile = async () => {
      await redis.flushall();
      return (
        await http().get(`/garages/${w.nord.slug}`).query({ brand: w.bmw.slug })
      ).body.prices;
    };

    await prisma.garageBrand.update({
      data: { stance: 'does_not_take', ...NO_FUEL },
      where,
    });
    const refused = await profile();
    await prisma.garageBrand.update({
      data: { diesel: true, stance: 'works_on' },
      where,
    });
    const taken = await profile();

    expect(
      refused.every((p: { fromBani: number }) => p.fromBani === 89_000),
    ).toBe(true);
    expect(taken[0]).toMatchObject(BMW_RANGE);
  });

  it('gives the default range once the garage stops naming the brand', async () => {
    const w = await world();
    await put(w, BMW_RANGE);
    await prisma.garageBrand.delete({
      where: { garageId_brandId: { brandId: w.bmw.id, garageId: w.nord.id } },
    });
    await redis.flushall();

    const res = await http()
      .get(`/garages/${w.nord.slug}`)
      .query({ brand: w.bmw.slug });

    expect(res.body.prices[0]).toMatchObject({
      fromBani: 89_000,
      toBani: 140_000,
    });
  });

  it('gives the default range to a slug that matches no brand', async () => {
    const w = await world();
    await put(w, BMW_RANGE);

    const res = await http()
      .get(`/garages/${w.nord.slug}`)
      .query({ brand: 'no-such-brand-\u00e9\u00e8' });

    expect(res.status).toBe(200);
    expect(res.body.prices[0]).toMatchObject({
      fromBani: 89_000,
      toBani: 140_000,
    });
  });
});

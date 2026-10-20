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

const rangePath = (w: World, priceId = w.row.id) =>
  `/garages/${w.nord.id}/prices/${priceId}`;
const labourPath = (w: World) => `/garages/${w.nord.id}/labour`;

const patch = (to: string, body: unknown, as: string | null): request.Test => {
  const req = http().patch(to);
  return (as ? req.set('Authorization', as) : req).send(body as object);
};

const stamp = (w: World) => w.row.updatedAt.toISOString();
const NEW_RANGE = { durationMinutes: 120, fromBani: 95_000, toBani: 145_000 };
const setRange = (
  w: World,
  body: Record<string, unknown>,
  as: string | null = w.owner,
) => patch(rangePath(w), { expectedUpdatedAt: stamp(w), ...body }, as);
const setLabour = (w: World, body: unknown, as = w.owner) =>
  patch(labourPath(w), body, as);

const stored = (w: World) =>
  prisma.garagePrice.findUniqueOrThrow({
    select: {
      durationMinutes: true,
      fromBani: true,
      toBani: true,
      updatedBy: true,
    },
    where: { id: w.row.id },
  });

const history = (w: World, subjectType = 'garage_price') =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    select: {
      action: true,
      actorId: true,
      actorRole: true,
      field: true,
      newValue: true,
      oldValue: true,
      subjectId: true,
    },
    where: { garageId: w.nord.id, subjectType },
  });

const events = (w: World) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { kind: 'price_list.updated', subjectId: w.nord.id },
  });

const errorsOf = (body: { errors?: { code: string; field: string }[] }) =>
  (body.errors ?? []).map(({ code, field }) => `${field}:${code}`).sort();

const owned = (w: World) =>
  http()
    .get(`/garages/${w.nord.id}/prices`)
    .set('Authorization', w.owner)
    .then((res) => res.body.items[0]);

// @traces 173-FR-004

const untouched = async (w: World) => {
  expect(await stored(w)).toEqual({
    durationMinutes: 120,
    fromBani: 89_000,
    toBani: 140_000,
    updatedBy: w.mihai,
  });
  const row = await prisma.garagePrice.findUniqueOrThrow({
    select: { updatedAt: true },
    where: { id: w.row.id },
  });
  expect(row.updatedAt.toISOString()).toBe(stamp(w));
  expect(await history(w)).toEqual([]);
  expect(await events(w)).toEqual([]);
};

// @traces 173-FR-004
describe('range values at and past their limits', () => {
  it.each<[string, Record<string, unknown>]>([
    ['the lowest low end', { durationMinutes: 15, fromBani: 100, toBani: 200 }],
    [
      'the highest top and duration',
      { durationMinutes: 4_800, fromBani: 99_900, toBani: 10_000_000 },
    ],
    [
      'an equal low end and top',
      { durationMinutes: 120, fromBani: 95_000, toBani: 95_000 },
    ],
    [
      'a cleared top and duration',
      { durationMinutes: null, fromBani: 95_000, toBani: null },
    ],
  ])('stores %s', async (_c, body) => {
    const w = await world();

    const res = await setRange(w, body);

    expect(res.status).toBe(200);
    expect(await stored(w)).toMatchObject(body);
  });

  it.each<[string, Record<string, unknown>, string[]]>([
    [
      'a duration of zero',
      { durationMinutes: 0, fromBani: 95_000, toBani: 145_000 },
      ['durationMinutes:min'],
    ],
    [
      'a negative duration',
      { durationMinutes: -15, fromBani: 95_000, toBani: 145_000 },
      ['durationMinutes:min'],
    ],
    [
      'a duration one step past the cap',
      { durationMinutes: 4_815, fromBani: 95_000, toBani: 145_000 },
      ['durationMinutes:max'],
    ],
    [
      'a duration one under the first step',
      { durationMinutes: 14, fromBani: 95_000, toBani: 145_000 },
      ['durationMinutes:min'],
    ],
    [
      'a low end one bani under the minimum',
      { durationMinutes: 120, fromBani: 99, toBani: 145_000 },
      [],
    ],
    [
      'a low end past 32 bits',
      { durationMinutes: 120, fromBani: 3_000_000_000, toBani: 3_000_000_001 },
      [],
    ],
    [
      'the largest safe integer as a top',
      {
        durationMinutes: 120,
        fromBani: 95_000,
        toBani: Number.MAX_SAFE_INTEGER,
      },
      [],
    ],
    [
      'a top in exponent form',
      { durationMinutes: 120, fromBani: 95_000, toBani: 1e21 },
      [],
    ],
    [
      'a negative low end',
      { durationMinutes: 120, fromBani: -95_000, toBani: 145_000 },
      [],
    ],
    [
      'a duration past 32 bits',
      { durationMinutes: 4_294_967_295, fromBani: 95_000, toBani: 145_000 },
      [],
    ],
  ])('refuses %s with 422 and nothing written', async (_c, body, expected) => {
    const w = await world();

    const res = await setRange(w, body);

    expect(res.status).toBe(422);
    if (expected.length) expect(errorsOf(res.body)).toEqual(expected);
    await untouched(w);
  });

  it.each<[string, Record<string, unknown>]>([
    [
      'numbers as strings',
      { durationMinutes: '120', fromBani: '95000', toBani: '145000' },
    ],
    [
      'full-width digits',
      { durationMinutes: 120, fromBani: '９５０００', toBani: 145_000 },
    ],
    ['booleans', { durationMinutes: true, fromBani: true, toBani: false }],
    [
      'arrays',
      { durationMinutes: [120], fromBani: [95_000], toBani: [145_000] },
    ],
    ['objects', { durationMinutes: {}, fromBani: {}, toBani: {} }],
    [
      'a null low end',
      { durationMinutes: 120, fromBani: null, toBani: 145_000 },
    ],
  ])('refuses %s without writing or failing', async (_c, body) => {
    const w = await world();

    const res = await setRange(w, body);

    expect([400, 422]).toContain(res.status);
    await untouched(w);
  });
});

// @traces 173-FR-004
describe('request shapes the range write has to survive', () => {
  it.each<[string, unknown]>([
    ['an array body', []],
    ['a null body', 'null'],
    ['an empty body', {}],
    ['a bare string', '"x"'],
  ])('answers 400 or 422 to %s', async (_c, body) => {
    const w = await world();

    const res = await http()
      .patch(rangePath(w))
      .set('Authorization', w.owner)
      .set('Content-Type', 'application/json')
      .send(typeof body === 'string' ? body : JSON.stringify(body));

    expect([400, 422]).toContain(res.status);
    await untouched(w);
  });

  it('refuses a prototype key in the body', async () => {
    const w = await world();

    const res = await http()
      .patch(rangePath(w))
      .set('Authorization', w.owner)
      .set('Content-Type', 'application/json')
      .send(
        `{"__proto__":{"fromBani":1},"fromBani":95000,"toBani":145000,"durationMinutes":120,"expectedUpdatedAt":"${stamp(w)}"}`,
      );

    expect([200, 400]).toContain(res.status);
    expect(Object.prototype).not.toHaveProperty('fromBani');
  });

  it('refuses a body that is not JSON with 415', async () => {
    const w = await world();

    const res = await http()
      .patch(rangePath(w))
      .set('Authorization', w.owner)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ ...NEW_RANGE, expectedUpdatedAt: stamp(w) }));

    expect(res.status).toBe(415);
    await untouched(w);
  });

  it('answers 400 for a priceId that is not a uuid', async () => {
    const w = await world();

    const res = await patch(
      rangePath(w, 'not-a-uuid'),
      { ...NEW_RANGE, expectedUpdatedAt: stamp(w) },
      w.owner,
    );

    expect(res.status).toBe(400);
  });

  it('answers 400 for a garageId that is not a uuid on both writes', async () => {
    const w = await world();

    const row = await patch(
      `/garages/nope/prices/${w.row.id}`,
      { ...NEW_RANGE, expectedUpdatedAt: stamp(w) },
      w.owner,
    );
    const labour = await patch(
      '/garages/nope/labour',
      { fromBani: 20_000, toBani: 26_000 },
      w.owner,
    );

    expect(row.status).toBe(400);
    expect(labour.status).toBe(400);
  });

  it.each([
    ['an empty string', ''],
    ['a number', 1_760_000_000_000],
    ['null', null],
  ])('answers 400 for a stamp that is %s', async (_c, expectedUpdatedAt) => {
    const w = await world();

    const res = await patch(
      rangePath(w),
      { ...NEW_RANGE, expectedUpdatedAt },
      w.owner,
    );

    expect(res.status).toBe(400);
    await untouched(w);
  });
});

// @traces 173-FR-007
describe('the stamp the write compares', () => {
  it('takes the same instant written with a +00:00 offset', async () => {
    const w = await world();

    const res = await patch(
      rangePath(w),
      {
        ...NEW_RANGE,
        expectedUpdatedAt: stamp(w).replace('Z', '+00:00'),
      },
      w.owner,
    );

    expect(res.status).toBe(200);
  });

  it('answers 409 for a stamp one millisecond off', async () => {
    const w = await world();
    const off = new Date(w.row.updatedAt.getTime() + 1).toISOString();

    const res = await patch(
      rangePath(w),
      { ...NEW_RANGE, expectedUpdatedAt: off },
      w.owner,
    );

    expect(res.status).toBe(409);
    await untouched(w);
  });

  it('answers 409 for a stamp rounded to the second', async () => {
    const w = await world();
    const rounded = `${stamp(w).slice(0, 19)}Z`;
    if (rounded === stamp(w)) return;

    const res = await patch(
      rangePath(w),
      { ...NEW_RANGE, expectedUpdatedAt: rounded },
      w.owner,
    );

    expect(res.status).toBe(409);
    await untouched(w);
  });

  it('keeps the stamp when the same body is sent twice, and the read gives the stored one', async () => {
    const w = await world();
    const first = await setRange(w, NEW_RANGE);

    const again = await patch(
      rangePath(w),
      { ...NEW_RANGE, expectedUpdatedAt: first.body.updatedAt },
      w.owner,
    );

    expect(again.status).toBe(200);
    expect(again.body.updatedAt).toBe(first.body.updatedAt);
    expect((await owned(w)).updatedAt).toBe(first.body.updatedAt);
    expect(await history(w)).toHaveLength(1);
    expect(await events(w)).toHaveLength(1);
  });

  it('answers 409 when the first save is replayed with its old stamp', async () => {
    const w = await world();
    expect((await setRange(w, NEW_RANGE)).status).toBe(200);

    const replay = await setRange(w, NEW_RANGE);

    expect(replay.status).toBe(409);
  });

  it('lets exactly one of several parallel saves through', async () => {
    const w = await world();

    const results = await Promise.all(
      [95_000, 96_000, 97_000, 98_000, 99_000].map((fromBani) =>
        setRange(w, { ...NEW_RANGE, fromBani }),
      ),
    );

    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409, 409, 409, 409]);
    expect(await history(w)).toHaveLength(1);
    expect(await events(w)).toHaveLength(1);
  });

  it('does not bump the stamp on a refused save', async () => {
    const w = await world();

    await setRange(w, { ...NEW_RANGE, fromBani: 0 });
    const ok = await setRange(w, NEW_RANGE);

    expect(ok.status).toBe(200);
  });
});

// @traces 173-FR-006
describe('who a row write belongs to', () => {
  it("does not let another garage's owner reach this row through their own garage", async () => {
    const w = await world();

    const res = await patch(
      `/garages/${w.dinamo.id}/prices/${w.row.id}`,
      { ...NEW_RANGE, expectedUpdatedAt: stamp(w) },
      w.other,
    );

    expect(res.status).toBe(404);
    await untouched(w);
  });

  it("does not let this garage's owner write a row through another garage's path", async () => {
    const w = await world();

    const res = await patch(
      `/garages/${w.dinamo.id}/prices/${w.theirs.id}`,
      {
        ...NEW_RANGE,
        expectedUpdatedAt: w.theirs.updatedAt.toISOString(),
      },
      w.owner,
    );

    expect(res.status).toBe(404);
    expect(
      (
        await prisma.garagePrice.findUniqueOrThrow({
          where: { id: w.theirs.id },
        })
      ).fromBani,
    ).toBe(50_000);
  });

  it('answers a receptionist 403 even for an unknown row', async () => {
    const w = await world();

    const res = await patch(
      rangePath(w, randomUUID()),
      { ...NEW_RANGE, expectedUpdatedAt: stamp(w) },
      w.receptionist,
    );

    expect(res.status).toBe(403);
  });

  it('keeps a brand row untouched when its id is sent as a default row', async () => {
    const w = await world();

    const res = await patch(
      rangePath(w, w.brandRow.id),
      { ...NEW_RANGE, expectedUpdatedAt: w.brandRow.updatedAt.toISOString() },
      w.owner,
    );

    expect(res.status).toBe(404);
    expect(
      (
        await prisma.garagePrice.findUniqueOrThrow({
          where: { id: w.brandRow.id },
        })
      ).fromBani,
    ).toBe(110_000);
  });
});

// @traces 173-FR-008 176-FR-002
describe('what a row change records exactly', () => {
  it('records a cleared duration as a change to nothing', async () => {
    const w = await world();

    await setRange(w, {
      durationMinutes: null,
      fromBani: 89_000,
      toBani: 140_000,
    });

    const entries = await history(w);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: w.mihai,
      actorRole: 'owner',
      field: 'duration_minutes',
      subjectId: w.row.id,
    });
    expect(entries[0].newValue).toBeNull();
  });

  it('records nothing for the unchanged fields of a partial change', async () => {
    const w = await world();

    await setRange(w, {
      durationMinutes: 120,
      fromBani: 89_000,
      toBani: 150_000,
    });

    expect(await history(w)).toEqual([
      expect.objectContaining({
        field: 'range',
        newValue: { from: 89_000, to: 150_000 },
        oldValue: { from: 89_000, to: 140_000 },
      }),
    ]);
  });
});

// @traces 173-FR-005 176-FR-004
describe('PATCH /garages/:garageId/labour on hostile input', () => {
  it.each<[string, unknown, string[]]>([
    ['an omitted top', { fromBani: 20_000 }, ['toBani:required']],
    ['an omitted low end', { toBani: 26_000 }, ['fromBani:required']],
    ['an empty body', {}, ['fromBani:required', 'toBani:required']],
    [
      'a top below the low end',
      { fromBani: 26_000, toBani: 20_000 },
      ['toBani:below_from'],
    ],
    [
      'a low end under one leu',
      { fromBani: 50, toBani: 20_000 },
      ['fromBani:min'],
    ],
    [
      'a top above the cap',
      { fromBani: 20_000, toBani: 10_000_001 },
      ['toBani:max'],
    ],
    [
      'a fractional bani',
      { fromBani: 20_000.5, toBani: 26_000 },
      ['fromBani:integer'],
    ],
  ])('refuses %s with 422 and nothing written', async (_c, body, expected) => {
    const w = await world();

    const res = await setLabour(w, body);

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(expected);
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect([garage.labourFromBani, garage.labourToBani]).toEqual([
      18_000, 24_000,
    ]);
    expect(await history(w, 'garage')).toEqual([]);
    expect(await events(w)).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['null ends', { fromBani: null, toBani: null }],
    ['a null top', { fromBani: 20_000, toBani: null }],
    ['string ends', { fromBani: '20000', toBani: '26000' }],
    ['a past-32-bit end', { fromBani: 3_000_000_000, toBani: 3_000_000_001 }],
    [
      'an unknown field',
      { durationMinutes: 60, fromBani: 20_000, toBani: 26_000 },
    ],
    ['an array', []],
  ])('refuses %s with 400 or 422', async (_c, body) => {
    const w = await world();

    const res = await setLabour(w, body);

    expect([400, 422]).toContain(res.status);
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect([garage.labourFromBani, garage.labourToBani]).toEqual([
      18_000, 24_000,
    ]);
  });

  it('sets a labour range on a garage that had none as one entry', async () => {
    const w = await world();
    await prisma.garage.update({
      data: { labourFromBani: null, labourToBani: null },
      where: { id: w.nord.id },
    });

    const res = await setLabour(w, { fromBani: 20_000, toBani: 26_000 });

    expect(res.status).toBe(200);
    expect(await history(w, 'garage')).toEqual([
      expect.objectContaining({
        field: 'labour_range',
        newValue: { from: 20_000, to: 26_000 },
        oldValue: { from: null, to: null },
      }),
    ]);
  });

  it('records one entry when only one end moves', async () => {
    const w = await world();

    await setLabour(w, { fromBani: 18_000, toBani: 30_000 });

    expect(await history(w, 'garage')).toEqual([
      expect.objectContaining({
        actorRole: 'owner',
        field: 'labour_range',
        newValue: { from: 18_000, to: 30_000 },
        oldValue: { from: 18_000, to: 24_000 },
        subjectId: w.nord.id,
      }),
    ]);
  });

  it('warns of a wide labour range and still stores it', async () => {
    const w = await world();

    const res = await setLabour(w, { fromBani: 10_000, toBani: 100_000 });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([
      { code: 'wide_range', field: 'toBani' },
    ]);
  });

  it('leaves a draft garage as a draft when its labour changes', async () => {
    const w = await world();
    await prisma.garage.update({
      data: { status: 'draft' },
      where: { id: w.nord.id },
    });

    await setLabour(w, { fromBani: 20_000, toBani: 26_000 });

    expect(
      (await prisma.garage.findUniqueOrThrow({ where: { id: w.nord.id } }))
        .status,
    ).toBe('draft');
  });

  it('lets two parallel labour saves both finish with one of the two stored', async () => {
    const w = await world();

    const results = await Promise.all([
      setLabour(w, { fromBani: 20_000, toBani: 26_000 }),
      setLabour(w, { fromBani: 21_000, toBani: 27_000 }),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const g = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(g.labourToBani! - g.labourFromBani!).toBe(6_000);
  });
});

// @traces 173-FR-007
describe('the owner read after a write', () => {
  it('leaves priceId off a job that has only brand rows', async () => {
    const w = await world();
    await prisma.garagePrice.delete({ where: { id: w.row.id } });

    const res = await http()
      .get(`/garages/${w.nord.id}/prices`)
      .set('Authorization', w.owner);

    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.priceId).toBeUndefined();
      expect(item.updatedAt).toBeUndefined();
    }
  });
});

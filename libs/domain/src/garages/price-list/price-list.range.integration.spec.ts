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
import { quotesWorld } from '../../quotes/quotes.testing';
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
// @traces 173-FR-007
describe('PATCH /garages/:garageId/prices/:priceId', () => {
  it('changes the range and answers the saved row with its new stamp', async () => {
    const w = await world();

    const res = await setRange(w, NEW_RANGE);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      jobTypeId: w.brakes.id,
      priceId: w.row.id,
      updatedAt: expect.any(String),
      warnings: [],
      ...NEW_RANGE,
    });
    expect(res.body.updatedAt).not.toBe(stamp(w));
    expect(await stored(w)).toEqual({ ...NEW_RANGE, updatedBy: w.mihai });
  });

  it('changes the duration alone', async () => {
    const w = await world();

    const res = await setRange(w, {
      durationMinutes: 2_880,
      fromBani: 89_000,
      toBani: 140_000,
    });

    expect(res.status).toBe(200);
    expect((await stored(w)).durationMinutes).toBe(2_880);
  });

  it('clears the top and the duration with null, and the job leaves the profile', async () => {
    const w = await world();

    const res = await setRange(w, {
      durationMinutes: null,
      fromBani: 89_000,
      toBani: null,
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('toBani');
    expect(res.body).not.toHaveProperty('durationMinutes');
    expect(await stored(w)).toMatchObject({
      durationMinutes: null,
      toBani: null,
    });
    expect(await owned(w)).toMatchObject({
      public: false,
      reason: 'no_top_price',
    });
  });

  it('warns of a wide range and still stores it', async () => {
    const w = await world();

    const res = await setRange(w, {
      durationMinutes: 120,
      fromBani: 20_000,
      toBani: 500_000,
    });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([
      expect.objectContaining({ code: 'wide_range', field: 'toBani' }),
    ]);
    expect((await stored(w)).toBani).toBe(500_000);
  });

  it('answers the stored row and writes nothing when nothing changed', async () => {
    const w = await world();

    const res = await setRange(w, {
      durationMinutes: 120,
      fromBani: 89_000,
      toBani: 140_000,
    });

    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(stamp(w));
    expect(await history(w)).toEqual([]);
    expect(await events(w)).toEqual([]);
  });

  it('gives the owner each default row with its id and stamp on the read', async () => {
    const w = await world();

    expect(await owned(w)).toMatchObject({
      priceId: w.row.id,
      updatedAt: stamp(w),
    });
  });
});

// @traces 173-FR-003
// @traces 173-FR-004
describe('what the range write refuses', () => {
  it.each<[string, Record<string, unknown>, string[]]>([
    [
      'a top below the low end',
      { durationMinutes: 120, fromBani: 150_000, toBani: 145_000 },
      ['toBani:below_from'],
    ],
    [
      'a low end under one leu',
      { durationMinutes: 120, fromBani: 0, toBani: 145_000 },
      ['fromBani:min'],
    ],
    [
      'a top above the cap',
      { durationMinutes: 120, fromBani: 95_000, toBani: 15_000_000 },
      ['toBani:max'],
    ],
    [
      'prices that are not whole bani',
      { durationMinutes: 120, fromBani: 1.5, toBani: '2' },
      ['fromBani:integer', 'toBani:integer'],
    ],
    [
      'a duration off the 15-minute step',
      { durationMinutes: 50, fromBani: 95_000, toBani: 145_000 },
      ['durationMinutes:step'],
    ],
    [
      'an omitted top and duration',
      { fromBani: 95_000 },
      ['durationMinutes:required', 'toBani:required'],
    ],
    [
      'an omitted low end',
      { durationMinutes: 120, toBani: 145_000 },
      ['fromBani:required'],
    ],
  ])('refuses %s with nothing written', async (_case, body, expected) => {
    const w = await world();

    const res = await setRange(w, body);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_failed');
    expect(errorsOf(res.body)).toEqual(expected);
    expect(await stored(w)).toMatchObject({
      durationMinutes: 120,
      fromBani: 89_000,
      toBani: 140_000,
    });
    expect(await history(w)).toEqual([]);
    expect(await events(w)).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a missing stamp', { ...NEW_RANGE }],
    ['a malformed stamp', { ...NEW_RANGE, expectedUpdatedAt: 'yesterday' }],
    [
      'an unknown field',
      { ...NEW_RANGE, expectedUpdatedAt: new Date(0).toISOString(), x: 1 },
    ],
  ])('answers 400 for %s', async (_case, body) => {
    const w = await world();

    const res = await patch(rangePath(w), body, w.owner);

    expect(res.status).toBe(400);
    expect(await stored(w)).toMatchObject({ fromBani: 89_000 });
  });
});

// @traces 173-FR-007
describe('a save from a stale row', () => {
  it('answers 409 and keeps the newer save', async () => {
    const w = await world();
    expect((await setRange(w, NEW_RANGE)).status).toBe(200);

    const res = await setRange(w, {
      durationMinutes: 60,
      fromBani: 70_000,
      toBani: 90_000,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stale');
    expect(await stored(w)).toMatchObject(NEW_RANGE);
    expect(await history(w)).toHaveLength(2);
  });

  it('answers 409 before judging an unchanged body', async () => {
    const w = await world();
    await setRange(w, NEW_RANGE);

    const res = await setRange(w, NEW_RANGE);

    expect(res.status).toBe(409);
  });

  it('lets exactly one of two saves with the same stamp through', async () => {
    const w = await world();

    const answers = await Promise.all([
      setRange(w, NEW_RANGE),
      setRange(w, { durationMinutes: 60, fromBani: 70_000, toBani: 90_000 }),
    ]);

    expect(answers.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await events(w)).toHaveLength(1);
  });
});

// @traces 173-FR-006
describe('who may change a range', () => {
  it.each([
    ['receptionist', 'receptionist'],
    ['mechanic', 'mechanic'],
  ] as const)('refuses the garage %s with 403', async (_who, key) => {
    const w = await world();

    expect((await setRange(w, NEW_RANGE, w[key])).status).toBe(403);
    expect(
      (await setLabour(w, { fromBani: 20_000, toBani: 26_000 }, w[key])).status,
    ).toBe(403);
    expect((await stored(w)).fromBani).toBe(89_000);
  });

  it("answers 404 to another garage's owner", async () => {
    const w = await world();

    expect((await setRange(w, NEW_RANGE, w.other)).status).toBe(404);
    expect(
      (await setLabour(w, { fromBani: 20_000, toBani: 26_000 }, w.other))
        .status,
    ).toBe(404);
  });

  it.each<[string, (w: World) => string]>([
    ['a brand row', (w) => w.brandRow.id],
    ["another garage's row", (w) => w.theirs.id],
    ['an unknown id', () => randomUUID()],
  ])('answers 404 for %s', async (_case, id) => {
    const w = await world();

    const res = await patch(
      rangePath(w, id(w)),
      { ...NEW_RANGE, expectedUpdatedAt: stamp(w) },
      w.owner,
    );

    expect(res.status).toBe(404);
    expect(await history(w)).toEqual([]);
  });

  it('asks for a session', async () => {
    const w = await world();

    expect((await setRange(w, NEW_RANGE, null)).status).toBe(401);
  });
});

// @traces 173-FR-008
describe('what a range change records', () => {
  it('writes one audit entry per changed field', async () => {
    const w = await world();

    await setRange(w, {
      durationMinutes: 120,
      fromBani: 95_000,
      toBani: 145_000,
    });

    const entries = await history(w);
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'update',
        actorId: w.mihai,
        actorRole: 'owner',
        field: 'from_bani',
        newValue: 95_000,
        oldValue: 89_000,
        subjectId: w.row.id,
      }),
      expect.objectContaining({
        field: 'to_bani',
        newValue: 145_000,
        oldValue: 140_000,
      }),
    ]);
  });

  it('records the labour change against the garage', async () => {
    const w = await world();

    await setLabour(w, { fromBani: 20_000, toBani: 24_000 });

    expect(await history(w, 'garage')).toEqual([
      expect.objectContaining({
        action: 'update',
        field: 'labour_from_bani',
        newValue: 20_000,
        oldValue: 18_000,
        subjectId: w.nord.id,
      }),
    ]);
  });
});

// @traces 173-FR-009
describe('what a range change tells the profile', () => {
  it('saves one price list event naming the job and no brand', async () => {
    const w = await world();

    await setRange(w, NEW_RANGE);

    const sent = await events(w);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toEqual({
      brandIds: [],
      garageId: w.nord.id,
      jobTypeIds: [w.brakes.id],
    });
    expect([...(sent[0]?.audience ?? [])].sort()).toEqual([
      `garage:${w.nord.id}`,
      `public:garage:${w.nord.id}`,
    ]);
  });

  it('saves a labour event naming no job and no brand', async () => {
    const w = await world();

    await setLabour(w, { fromBani: 20_000, toBani: 26_000 });

    expect((await events(w)).map((event) => event.payload)).toEqual([
      { brandIds: [], garageId: w.nord.id, jobTypeIds: [] },
    ]);
  });

  it('forgets the profile entry so the next read has the new range', async () => {
    const w = await world();
    const profile = () => http().get(`/garages/${w.nord.slug}`);
    await profile();
    expect(await redis.exists(`v1:profile:${w.nord.slug}:-`)).toBe(1);

    await setRange(w, NEW_RANGE);

    expect(await redis.exists(`v1:profile:${w.nord.slug}:-`)).toBe(0);
    const res = await profile();
    expect(res.body.prices).toEqual([
      expect.objectContaining({
        fromBani: 95_000,
        jobTypeId: w.brakes.id,
        toBani: 145_000,
      }),
    ]);
  });
});

// @traces 173-FR-010
describe('what a price change leaves alone', () => {
  it("keeps the garage's verification status and a sent quote's range", async () => {
    const w = await world();
    const quotes = quotesWorld(prisma);
    const driver = await quotes.account('dan');
    const asked = await quotes.request(driver);
    const sent = await quotes.quote(asked.id, w.nord.id);

    await setRange(w, NEW_RANGE);
    await setLabour(w, { fromBani: 20_000, toBani: 26_000 });

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(garage.status).toBe('approved');
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: sent.id },
    });
    expect(quote).toMatchObject({ fromBani: 45_000, toBani: 60_000 });
  });
});

// @traces 173-FR-005
describe('PATCH /garages/:garageId/labour', () => {
  it('changes both ends and answers them', async () => {
    const w = await world();

    const res = await setLabour(w, { fromBani: 20_000, toBani: 26_000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      fromBani: 20_000,
      toBani: 26_000,
      warnings: [],
    });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(garage).toMatchObject({
      labourFromBani: 20_000,
      labourToBani: 26_000,
    });
  });

  it.each<[string, Record<string, unknown>, string[]]>([
    ['a missing top', { fromBani: 20_000 }, ['toBani:required']],
    ['a cleared top', { fromBani: 20_000, toBani: null }, ['toBani:required']],
    ['a missing low end', { toBani: 26_000 }, ['fromBani:required']],
    [
      'a top below the low end',
      { fromBani: 30_000, toBani: 26_000 },
      ['toBani:below_from'],
    ],
  ])('refuses %s with nothing written', async (_case, body, expected) => {
    const w = await world();

    const res = await setLabour(w, body);

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(expected);
    expect(await history(w, 'garage')).toEqual([]);
    expect(await events(w)).toEqual([]);
  });

  it('writes nothing when nothing changed', async () => {
    const w = await world();

    const res = await setLabour(w, { fromBani: 18_000, toBani: 24_000 });

    expect(res.status).toBe(200);
    expect(await history(w, 'garage')).toEqual([]);
    expect(await events(w)).toEqual([]);
  });
});

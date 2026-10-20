import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
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

// Service Auto Nord, approved, with its owner Mihai, a receptionist and a
// mechanic; front brakes at 890 – 1.400 lei, 2 h, with a BMW range; Atelier
// Dinamo with its owner Radu and a row of its own.
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
    admin: bearer(await account('ana', ['admin']), 'admin'),
    brakes,
    brandRow,
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

const patch = (
  w: World,
  body: Record<string, unknown>,
  as: string | null = w.owner,
  priceId: string = w.row.id,
) => {
  const req = http().patch(`/garages/${w.nord.id}/prices/${priceId}`);
  return (as ? req.set('Authorization', as) : req).send(body);
};

const setVisible = (w: World, visible: boolean, as?: string | null) =>
  patch(w, { visible }, as);

const stored = (w: World) =>
  prisma.garagePrice.findUniqueOrThrow({ where: { id: w.row.id } });

const history = (w: World) =>
  prisma.activityLog.findMany({ where: { garageId: w.nord.id } });

const events = (w: World) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'price_list.updated', subjectId: w.nord.id },
  });

const expectNothingWritten = async (w: World) => {
  expect(await stored(w)).toMatchObject({
    updatedAt: w.row.updatedAt,
    visible: true,
  });
  expect(await history(w)).toEqual([]);
  expect(await events(w)).toEqual([]);
};

const owned = (w: World) =>
  http()
    .get(`/garages/${w.nord.id}/prices`)
    .set('Authorization', w.owner)
    .then((res) => res.body.items[0]);

const profilePrices = async (w: World) =>
  (await http().get(`/garages/${w.nord.slug}`)).body.prices.map(
    (price: { jobTypeId: string }) => price.jobTypeId,
  );

// @traces 1352-catalogue-job-visibility-FR-005
describe('PATCH /garages/:garageId/prices/:priceId with { visible }', () => {
  it('hides the job and answers the saved row with its new stamp', async () => {
    const w = await world();

    const res = await setVisible(w, false);

    expect(res.status).toBe(200);
    const row = await stored(w);
    expect(row.visible).toBe(false);
    expect(row.updatedAt.getTime()).toBeGreaterThan(w.row.updatedAt.getTime());
    expect(res.body).toEqual({
      durationMinutes: 120,
      fromBani: 89_000,
      jobTypeId: w.brakes.id,
      priceId: w.row.id,
      toBani: 140_000,
      updatedAt: row.updatedAt.toISOString(),
      warnings: [],
    });
    expect(await owned(w)).toMatchObject({
      public: false,
      reason: 'hidden_by_garage',
      visible: false,
    });
  });

  it('shows a hidden job again', async () => {
    const w = await world();
    await setVisible(w, false);

    const res = await setVisible(w, true);

    expect(res.status).toBe(200);
    expect((await stored(w)).visible).toBe(true);
    expect(await owned(w)).toMatchObject({ visible: true });
  });

  it('changes nothing but the flag', async () => {
    const w = await world();

    await setVisible(w, false);

    expect(await stored(w)).toMatchObject({
      durationMinutes: 120,
      fromBani: 89_000,
      position: 0,
      toBani: 140_000,
      updatedBy: w.mihai,
    });
    expect(
      await prisma.garagePrice.findUniqueOrThrow({
        where: { id: w.brandRow.id },
      }),
    ).toMatchObject({ fromBani: 110_000, toBani: 170_000, visible: true });
  });

  it('answers the stored row and writes nothing for the value it already has', async () => {
    const w = await world();

    const res = await setVisible(w, true);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      priceId: w.row.id,
      updatedAt: w.row.updatedAt.toISOString(),
    });
    await expectNothingWritten(w);
  });

  it('writes one entry and one event when the same hide is sent twice', async () => {
    const w = await world();

    await setVisible(w, false);
    const res = await setVisible(w, false);

    expect(res.status).toBe(200);
    expect(await history(w)).toHaveLength(1);
    expect(await events(w)).toHaveLength(1);
  });

  it('answers a range edit read before the hide with 409 stale', async () => {
    const w = await world();
    await setVisible(w, false);

    const res = await patch(w, {
      durationMinutes: 120,
      expectedUpdatedAt: w.row.updatedAt.toISOString(),
      fromBani: 95_000,
      toBani: 145_000,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stale');
    expect(await stored(w)).toMatchObject({ fromBani: 89_000 });
  });

  it.each<[string, Record<string, unknown>]>([
    ['a starting price', { fromBani: 95_000 }],
    ['a stamp', { expectedUpdatedAt: new Date().toISOString() }],
    ['a null top', { toBani: null }],
    ['a duration', { durationMinutes: 120 }],
  ])(
    'refuses %s beside visible with 400 validation_failed',
    async (_case, extra) => {
      const w = await world();

      const res = await patch(w, { visible: false, ...extra });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
      expect(res.body.errors).toEqual([
        { code: 'exclusive', field: 'visible' },
      ]);
      await expectNothingWritten(w);
    },
  );

  it.each<[string, Record<string, unknown>]>([
    ['a visible that is not a boolean', { visible: 'false' }],
    ['a null visible', { visible: null }],
    ['an unknown field beside visible', { visible: false, x: 1 }],
  ])('answers 400 for %s', async (_case, body) => {
    const w = await world();

    expect((await patch(w, body)).status).toBe(400);
    await expectNothingWritten(w);
  });

  it.each<[string, (w: World) => string]>([
    ['a brand row', (w) => w.brandRow.id],
    ["another garage's row", (w) => w.theirs.id],
    ['an unknown row', () => randomUUID()],
  ])('answers 404 for %s', async (_case, priceIdOf) => {
    const w = await world();

    const res = await patch(w, { visible: false }, w.owner, priceIdOf(w));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(await history(w)).toEqual([]);
  });
});

// @traces 1352-catalogue-job-visibility-FR-011
describe('who may hide a job', () => {
  it.each(['receptionist', 'mechanic'] as const)(
    'refuses the garage %s with 403',
    async (key) => {
      const w = await world();

      const res = await setVisible(w, false, w[key]);

      expect(res.status).toBe(403);
      await expectNothingWritten(w);
    },
  );

  it.each(['other', 'admin'] as const)(
    'answers 404 to the %s with nothing about the garage',
    async (key) => {
      const w = await world();

      const res = await setVisible(w, false, w[key]);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      await expectNothingWritten(w);
    },
  );

  it('asks for a session', async () => {
    const w = await world();

    expect((await setVisible(w, false, null)).status).toBe(401);
  });

  it('answers 400 for a price id that is not a uuid', async () => {
    const w = await world();

    expect((await patch(w, { visible: false }, w.owner, 'x')).status).toBe(400);
  });
});

// @traces 1352-catalogue-job-visibility-FR-012
describe('what a hide leaves alone', () => {
  it("keeps the garage's verification status and takes the job off the profile at once", async () => {
    const w = await world();
    expect(await profilePrices(w)).toContain(w.brakes.id);

    await setVisible(w, false);

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(garage.status).toBe('approved');
    expect(await redis.exists(`v1:profile:${w.nord.slug}:-`)).toBe(0);
    expect(await profilePrices(w)).not.toContain(w.brakes.id);
  });

  it('puts the job back on the profile at once when shown', async () => {
    const w = await world();
    await setVisible(w, false);
    await profilePrices(w);

    await setVisible(w, true);

    expect(await profilePrices(w)).toContain(w.brakes.id);
  });
});

// @traces 1352-catalogue-job-visibility-FR-013
describe('what a hide or show records', () => {
  it('writes one update entry on the row, field visible, with the old and new flag', async () => {
    const w = await world();

    await setVisible(w, false);
    await setVisible(w, true);

    const entries = await prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: { garageId: w.nord.id },
    });
    const common = {
      action: 'update',
      actorId: w.mihai,
      actorName: 'mihai',
      actorRole: 'owner',
      field: 'visible',
      garageId: w.nord.id,
      internal: false,
      isKeyChange: false,
      kind: 'price_list',
      subjectId: w.row.id,
      subjectType: 'garage_price',
    };
    expect(entries).toEqual([
      expect.objectContaining({ ...common, newValue: false, oldValue: true }),
      expect.objectContaining({ ...common, newValue: true, oldValue: false }),
    ]);
  });

  it('keeps neither the flag, the entry nor the event when the entry cannot be written', async () => {
    const w = await world();
    const audit = app.get<AuditPort>(AUDIT_PORT);
    const failing = jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('the entry write failed'));

    const res = await setVisible(w, false);
    failing.mockRestore();

    expect(res.status).toBe(500);
    await expectNothingWritten(w);
  });
});

// @traces 1352-catalogue-job-visibility-FR-014
describe('what a hide tells the profile', () => {
  it('saves one price list event naming the job and no brand', async () => {
    const w = await world();

    await setVisible(w, false);

    const sent = await events(w);
    expect(sent.map((event) => event.payload)).toEqual([
      { brandIds: [], garageId: w.nord.id, jobTypeIds: [w.brakes.id] },
    ]);
    expect([...(sent[0]?.audience ?? [])].sort()).toEqual([
      `garage:${w.nord.id}`,
      `public:garage:${w.nord.id}`,
    ]);
  });
});

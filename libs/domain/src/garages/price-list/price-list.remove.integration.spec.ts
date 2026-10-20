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
import type { Prisma } from '../../generated/prisma/client';
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

const jobType = (nameRo: string) =>
  prisma.jobType.create({
    data: {
      key: `job-${randomUUID()}`,
      nameEn: nameRo,
      nameRo,
      status: 'approved',
    },
  });

const brand = (name: string) =>
  prisma.brand.create({
    data: {
      key: `${name}-${randomUUID()}`,
      name,
      slug: `${name}-${randomUUID()}`,
    },
  });

const HOUR = 3_600_000;

// Andrei's open request for front brakes, sent to Service Auto Nord, and the
// quote Nord sent for it.
async function openRequest(
  garageId: string,
  jobTypeId: string,
  makeId: string,
) {
  const driverId = await account('andrei', ['driver']);
  const car = await prisma.car.create({
    data: {
      brandId: makeId,
      fuel: 'petrol',
      idempotencyKey: randomUUID(),
      model: 'Seria 3',
      odometerKm: 84_000,
      ownerId: driverId,
      year: 2019,
    },
  });
  const asked = await prisma.quoteRequest.create({
    data: {
      carBrand: 'BMW',
      carFuel: 'petrol',
      carId: car.id,
      carModel: 'Seria 3',
      carYear: 2019,
      driverId,
      expiresAt: new Date(Date.now() + 7 * 24 * HOUR),
      idempotencyKey: randomUUID(),
    },
  });
  const line = await prisma.requestJob.create({
    data: { jobTypeId, position: 0, requestId: asked.id },
  });
  const recipient = await prisma.requestRecipient.create({
    data: { garageId, requestId: asked.id, source: 'search', status: 'quoted' },
  });
  const quote = await prisma.quote.create({
    data: {
      durationMinutes: 60,
      expiresAt: new Date(Date.now() + 7 * 24 * HOUR),
      fromBani: 89_000,
      garageId,
      idempotencyKey: randomUUID(),
      recipientId: recipient.id,
      requestId: asked.id,
      slot: new Date(Date.now() + 24 * HOUR),
      toBani: 140_000,
    },
  });
  await prisma.quoteJob.create({
    data: { included: true, quoteId: quote.id, requestJobId: line.id },
  });
}

// Service Auto Nord, approved, taking BMW and Mini, with its owner Mihai, a
// receptionist and a mechanic; front brakes listed at position 3 with a BMW
// range and ticked for BMW and Mini; an oil change listed and ticked for BMW;
// Atelier Dinamo with its owner Radu and its own front brakes.
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
  const brakes = await jobType('Frâne față');
  const oil = await jobType('Schimb ulei');
  const bmw = await brand('bmw');
  const mini = await brand('mini');
  for (const taken of [bmw, mini]) {
    await prisma.garageBrand.create({
      data: { brandId: taken.id, garageId: nord.id, stance: 'works_on' },
    });
  }
  const listed = { garageId: nord.id, jobTypeId: brakes.id, updatedBy: mihai };
  const brakesRow = await prisma.garagePrice.create({
    data: {
      ...listed,
      durationMinutes: 90,
      fromBani: 89_000,
      position: 3,
      toBani: 140_000,
      visible: false,
    },
  });
  const bmwRow = await prisma.garagePrice.create({
    data: {
      ...listed,
      brandId: bmw.id,
      fromBani: 110_000,
      position: 3,
      toBani: 170_000,
    },
  });
  const oilRow = await prisma.garagePrice.create({
    data: {
      fromBani: 25_000,
      garageId: nord.id,
      jobTypeId: oil.id,
      position: 4,
      updatedBy: mihai,
    },
  });
  await prisma.garageBrandJob.createMany({
    data: [
      { brandId: bmw.id, garageId: nord.id, jobTypeId: brakes.id },
      { brandId: mini.id, garageId: nord.id, jobTypeId: brakes.id },
      { brandId: bmw.id, garageId: nord.id, jobTypeId: oil.id },
    ],
  });
  const dinamoRow = await prisma.garagePrice.create({
    data: {
      fromBani: 70_000,
      garageId: dinamo.id,
      jobTypeId: brakes.id,
      position: 0,
      updatedBy: radu,
    },
  });
  return {
    admin: bearer(await account('ana', ['admin']), 'admin'),
    bmw,
    bmwRow,
    brakes,
    brakesRow,
    dinamoRow,
    mechanic: bearer(vlad, 'mechanic'),
    mihai,
    mini,
    nord,
    oil,
    oilRow,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const remove = (
  w: World,
  priceId: string = w.brakesRow.id,
  as: string | null = w.owner,
  garageId: string = w.nord.id,
) => {
  const req = http().delete(`/garages/${garageId}/prices/${priceId}`);
  return as ? req.set('Authorization', as) : req;
};

const rowsOf = (w: World) =>
  prisma.garagePrice.findMany({
    orderBy: { fromBani: 'asc' },
    where: { garageId: w.nord.id },
  });

const ticksOf = (w: World) =>
  prisma.garageBrandJob.findMany({
    orderBy: { brandId: 'asc' },
    where: { garageId: w.nord.id },
  });

const history = (w: World) =>
  prisma.activityLog.findMany({ where: { garageId: w.nord.id } });

const events = (w: World) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'price_list.updated', subjectId: w.nord.id },
  });

const snapshot = async (w: World) => ({
  rows: await rowsOf(w),
  ticks: await ticksOf(w),
});

const expectNothingWritten = async (
  w: World,
  before: Awaited<ReturnType<typeof snapshot>>,
) => {
  expect(await snapshot(w)).toEqual(before);
  expect(await history(w)).toEqual([]);
  expect(await events(w)).toEqual([]);
};

// @traces 1352-catalogue-job-visibility-FR-007
describe('DELETE /garages/:garageId/prices/:priceId', () => {
  it("deletes the job's default row, its brand rows and its ticks and answers 204", async () => {
    const w = await world();

    const res = await remove(w);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await rowsOf(w)).map((row) => row.id)).toEqual([w.oilRow.id]);
    expect(await ticksOf(w)).toEqual([
      expect.objectContaining({ brandId: w.bmw.id, jobTypeId: w.oil.id }),
    ]);
  });

  it("leaves another garage's rows for the same job", async () => {
    const w = await world();

    await remove(w);

    expect(
      await prisma.garagePrice.findUnique({ where: { id: w.dinamoRow.id } }),
    ).not.toBeNull();
  });

  it('changes no open request line and no sent quote', async () => {
    const w = await world();
    await openRequest(w.nord.id, w.brakes.id, w.bmw.id);
    const requests = async () => ({
      jobs: await prisma.requestJob.findMany(),
      quoteJobs: await prisma.quoteJob.findMany(),
      quotes: await prisma.quote.findMany(),
      requests: await prisma.quoteRequest.findMany(),
    });
    const before = await requests();

    expect((await remove(w)).status).toBe(204);

    expect(await requests()).toEqual(before);
  });

  it('lists the job no more on the profile', async () => {
    const w = await world();
    await prisma.garagePrice.update({
      data: { visible: true },
      where: { id: w.brakesRow.id },
    });
    const profile = () => http().get(`/garages/${w.nord.slug}`);
    const jobsOf = async () =>
      (await profile()).body.prices.map(
        (price: { jobTypeId: string }) => price.jobTypeId,
      );
    expect(await jobsOf()).toContain(w.brakes.id);

    await remove(w);

    expect(await jobsOf()).not.toContain(w.brakes.id);
  });

  it.each<[string, (w: World) => string]>([
    ['a brand row', (w) => w.bmwRow.id],
    ["another garage's row", (w) => w.dinamoRow.id],
    ['a row that does not exist', () => randomUUID()],
  ])('answers 404 for %s with nothing written', async (_case, idOf) => {
    const w = await world();
    const before = await snapshot(w);

    const res = await remove(w, idOf(w));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    await expectNothingWritten(w, before);
  });

  it('lets one of two removals of the same job through', async () => {
    const w = await world();

    const answers = await Promise.all([remove(w), remove(w)]);

    expect(answers.map((res) => res.status).sort()).toEqual([204, 404]);
    expect(await events(w)).toHaveLength(1);
  });

  it('answers 400 for an id that is not a uuid', async () => {
    const w = await world();

    expect((await remove(w, 'frane')).status).toBe(400);
    expect((await remove(w, w.brakesRow.id, w.owner, 'x')).status).toBe(400);
  });
});

// Holds the garage as a write to its list does, runs `meanwhile` inside, and
// lets go once another write is waiting on it.
async function holdingGarage(
  w: World,
  meanwhile: (tx: Prisma.TransactionClient) => Promise<unknown>,
  then: () => Promise<request.Response>,
) {
  let answer: Promise<request.Response> | undefined;
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM garage WHERE id = ${w.nord.id}::uuid FOR UPDATE`;
      await meanwhile(tx);
      answer = then();
      for (let waited = 0; waited < 5_000; waited += 25) {
        const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`;
        if (n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    { timeout: 15_000 },
  );
  return answer as Promise<request.Response>;
}

const jobsListed = async (w: World) => [
  ...new Set((await rowsOf(w)).map((row) => row.jobTypeId)),
];

describe('a removal racing a brand range', () => {
  it('refuses a brand range that reaches the job after its removal', async () => {
    const w = await world();

    const res = await holdingGarage(
      w,
      (tx) =>
        tx.garagePrice.deleteMany({
          where: { garageId: w.nord.id, jobTypeId: w.brakes.id },
        }),
      () =>
        http()
          .put(
            `/garages/${w.nord.id}/prices/${w.brakes.id}/brands/${w.mini.id}`,
          )
          .set('Authorization', w.owner)
          .send({ fromBani: 120_000, toBani: 180_000 })
          .then((answered) => answered),
    );

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { code: 'no_default_range', field: 'jobTypeId' },
    ]);
    expect(await jobsListed(w)).toEqual([w.oil.id]);
  });

  it('takes away a brand range stored while the removal waited', async () => {
    const w = await world();

    const res = await holdingGarage(
      w,
      (tx) =>
        tx.garagePrice.create({
          data: {
            brandId: w.mini.id,
            fromBani: 120_000,
            garageId: w.nord.id,
            jobTypeId: w.brakes.id,
            position: 3,
            toBani: 180_000,
            updatedBy: w.mihai,
          },
        }),
      () => remove(w).then((answered) => answered),
    );

    expect(res.status).toBe(204);
    expect(await jobsListed(w)).toEqual([w.oil.id]);
  });
});

// @traces 1352-catalogue-job-visibility-FR-011
describe('who may remove a job', () => {
  it.each(['receptionist', 'mechanic'] as const)(
    'refuses the garage %s with 403',
    async (key) => {
      const w = await world();
      const before = await snapshot(w);

      const res = await remove(w, w.brakesRow.id, w[key]);

      expect(res.status).toBe(403);
      await expectNothingWritten(w, before);
    },
  );

  it.each(['other', 'admin'] as const)(
    'answers 404 to the %s with nothing about the garage',
    async (key) => {
      const w = await world();
      const before = await snapshot(w);

      const res = await remove(w, w.brakesRow.id, w[key]);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      await expectNothingWritten(w, before);
    },
  );

  it('asks for a session', async () => {
    const w = await world();

    expect((await remove(w, w.brakesRow.id, null)).status).toBe(401);
  });
});

// @traces 1352-catalogue-job-visibility-FR-012
describe('what the removal leaves alone', () => {
  it("keeps the garage's verification status and drops the profile's entries", async () => {
    const w = await world();
    const profile = (slug?: string) =>
      http()
        .get(`/garages/${w.nord.slug}`)
        .query(slug ? { brand: slug } : {});
    await profile();
    await profile(w.bmw.slug);
    await profile(w.mini.slug);
    const entry = (slug: string) => `v1:profile:${w.nord.slug}:${slug}`;

    await remove(w);

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(garage.status).toBe('approved');
    expect(await redis.exists(entry('-'))).toBe(0);
    expect(await redis.exists(entry(w.bmw.slug))).toBe(0);
    expect(await redis.exists(entry(w.mini.slug))).toBe(0);
  });
});

// @traces 1352-catalogue-job-visibility-FR-013
describe('what the removal records', () => {
  it('writes a delete entry on the default row, one per brand row and one per tick', async () => {
    const w = await world();

    await remove(w);

    const scope = {
      actorId: w.mihai,
      actorName: 'mihai',
      actorRole: 'owner',
      garageId: w.nord.id,
      internal: false,
      isKeyChange: false,
      kind: 'price_list',
    };
    const entries = await history(w);
    expect(entries).toHaveLength(4);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...scope,
          action: 'delete',
          field: null,
          oldValue: {
            brandId: null,
            durationMinutes: 90,
            fromBani: 89_000,
            jobTypeId: w.brakes.id,
            position: 3,
            toBani: 140_000,
            visible: false,
          },
          subjectId: w.brakesRow.id,
          subjectType: 'garage_price',
        }),
        expect.objectContaining({
          ...scope,
          action: 'delete',
          field: 'brand_range',
          oldValue: {
            brandId: w.bmw.id,
            from: 110_000,
            jobTypeId: w.brakes.id,
            to: 170_000,
          },
          subjectId: w.bmwRow.id,
          subjectType: 'garage_price',
        }),
        ...[w.bmw, w.mini].map((ticked) =>
          expect.objectContaining({
            ...scope,
            action: 'delete',
            oldValue: { brandId: ticked.id },
            subjectId: w.brakes.id,
            subjectType: 'garage_brand_job',
          }),
        ),
      ]),
    );
  });

  it('keeps every row, tick, entry and event when the entries cannot be written', async () => {
    const w = await world();
    const before = await snapshot(w);
    const audit = app.get<AuditPort>(AUDIT_PORT);
    const failing = jest
      .spyOn(audit, 'recordMany')
      .mockRejectedValueOnce(new Error('the entry write failed'));

    const res = await remove(w);
    failing.mockRestore();

    expect(res.status).toBe(500);
    await expectNothingWritten(w, before);
  });
});

// @traces 1352-catalogue-job-visibility-FR-014
describe('what the removal tells the profile', () => {
  it('saves one price list event naming the job and the brands of its rows and ticks', async () => {
    const w = await world();

    await remove(w);

    const sent = await events(w);
    expect(sent).toHaveLength(1);
    const payload = sent[0]?.payload as { brandIds: string[] };
    expect(payload).toEqual({
      brandIds: expect.any(Array),
      garageId: w.nord.id,
      jobTypeIds: [w.brakes.id],
    });
    expect([...payload.brandIds].sort()).toEqual([w.bmw.id, w.mini.id].sort());
    expect([...(sent[0]?.audience ?? [])].sort()).toEqual([
      `garage:${w.nord.id}`,
      `public:garage:${w.nord.id}`,
    ]);
  });

  it('saves no event for a refused removal', async () => {
    const w = await world();

    await remove(w, w.bmwRow.id);

    expect(await events(w)).toEqual([]);
  });
});

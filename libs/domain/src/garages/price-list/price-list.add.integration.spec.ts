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

const jobType = (
  nameRo: string,
  status: 'approved' | 'pending' | 'rejected' = 'approved',
) =>
  prisma.jobType.create({
    data: { key: `job-${randomUUID()}`, nameEn: nameRo, nameRo, status },
  });

// Service Auto Nord, approved, taking BMW, with its owner Mihai, a
// receptionist and a mechanic; front brakes listed at position 3 with a BMW
// range; freon charging in the catalogue and not listed; Atelier Dinamo with
// its owner Radu.
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
  const freon = await jobType('Încărcare freon climă');
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
  const listed = { garageId: nord.id, jobTypeId: brakes.id, updatedBy: mihai };
  await prisma.garagePrice.create({
    data: { ...listed, fromBani: 89_000, position: 3, toBani: 140_000 },
  });
  await prisma.garagePrice.create({
    data: {
      ...listed,
      brandId: bmw.id,
      fromBani: 110_000,
      position: 3,
      toBani: 170_000,
    },
  });
  return {
    admin: bearer(await account('ana', ['admin']), 'admin'),
    bmw,
    brakes,
    freon,
    mechanic: bearer(vlad, 'mechanic'),
    mihai,
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const FREON = { durationMinutes: 45, fromBani: 28_000, toBani: 36_000 };

const add = (
  w: World,
  body: Record<string, unknown>,
  as: string | null = w.owner,
  garageId: string = w.nord.id,
) => {
  const req = http().post(`/garages/${garageId}/prices`);
  return (as ? req.set('Authorization', as) : req).send(body);
};

const addFreon = (w: World, as?: string | null) =>
  add(w, { jobTypeId: w.freon.id, ...FREON }, as);

const rowsOf = (w: World, jobTypeId = w.freon.id) =>
  prisma.garagePrice.findMany({ where: { garageId: w.nord.id, jobTypeId } });

const history = (w: World) =>
  prisma.activityLog.findMany({ where: { garageId: w.nord.id } });

const events = (w: World) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'price_list.updated', subjectId: w.nord.id },
  });

const errorsOf = (body: { errors?: { code: string; field: string }[] }) =>
  (body.errors ?? []).map(({ code, field }) => `${field}:${code}`).sort();

const expectNothingWritten = async (w: World) => {
  expect(await rowsOf(w)).toEqual([]);
  expect(await history(w)).toEqual([]);
  expect(await events(w)).toEqual([]);
};

// @traces 1352-catalogue-job-visibility-FR-002
describe('POST /garages/:garageId/prices', () => {
  it('adds the job with its range and duration and answers the saved row', async () => {
    const w = await world();

    const res = await addFreon(w);

    expect(res.status).toBe(201);
    const [row] = await rowsOf(w);
    expect(res.body).toEqual({
      ...FREON,
      jobTypeId: w.freon.id,
      priceId: row?.id,
      updatedAt: row?.updatedAt.toISOString(),
      warnings: [],
    });
    expect(row).toMatchObject({
      ...FREON,
      brandId: null,
      updatedBy: w.mihai,
      visible: true,
    });
  });

  it('adds the job with a starting price alone', async () => {
    const w = await world();

    const res = await add(w, { fromBani: 28_000, jobTypeId: w.freon.id });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('toBani');
    expect(res.body).not.toHaveProperty('durationMinutes');
    expect(await rowsOf(w)).toEqual([
      expect.objectContaining({
        durationMinutes: null,
        fromBani: 28_000,
        toBani: null,
      }),
    ]);
  });

  it('takes null for the top and the duration', async () => {
    const w = await world();

    const res = await add(w, {
      durationMinutes: null,
      fromBani: 28_000,
      jobTypeId: w.freon.id,
      toBani: null,
    });

    expect(res.status).toBe(201);
  });

  it('places the job after every job on the list', async () => {
    const w = await world();

    await addFreon(w);

    const [row] = await rowsOf(w);
    expect(row?.position).toBe(4);
    const list = await http()
      .get(`/garages/${w.nord.id}/prices`)
      .set('Authorization', w.owner);
    expect(
      list.body.items.map((item: { jobTypeId: string }) => item.jobTypeId),
    ).toEqual([w.brakes.id, w.freon.id]);
  });

  it('warns of a wide range and still stores it', async () => {
    const w = await world();

    const res = await add(w, {
      durationMinutes: 45,
      fromBani: 20_000,
      jobTypeId: w.freon.id,
      toBani: 500_000,
    });

    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([
      expect.objectContaining({ code: 'wide_range', field: 'toBani' }),
    ]);
  });
});

// @traces 1352-catalogue-job-visibility-FR-002
describe('what the add refuses', () => {
  it.each<[string, Record<string, unknown>, string[]]>([
    [
      'a top below the starting price',
      { durationMinutes: 45, fromBani: 36_000, toBani: 28_000 },
      ['toBani:below_from'],
    ],
    ['a missing starting price', { toBani: 36_000 }, ['fromBani:required']],
    [
      'a duration off the 15-minute step',
      { durationMinutes: 50, fromBani: 28_000 },
      ['durationMinutes:step'],
    ],
    [
      'prices that are not whole bani',
      { fromBani: 1.5, toBani: '2' },
      ['fromBani:integer', 'toBani:integer'],
    ],
  ])('refuses %s with nothing written', async (_case, values, expected) => {
    const w = await world();

    const res = await add(w, { jobTypeId: w.freon.id, ...values });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_failed');
    expect(errorsOf(res.body)).toEqual(expected);
    await expectNothingWritten(w);
  });

  it('refuses a job already on the list', async () => {
    const w = await world();

    const res = await add(w, { jobTypeId: w.brakes.id, ...FREON });

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['jobTypeId:duplicate']);
    expect(await rowsOf(w, w.brakes.id)).toHaveLength(2);
    expect(await history(w)).toEqual([]);
  });

  it('refuses a job listed only with a brand range', async () => {
    const w = await world();
    await prisma.garagePrice.create({
      data: {
        brandId: w.bmw.id,
        fromBani: 30_000,
        garageId: w.nord.id,
        jobTypeId: w.freon.id,
        position: 5,
        updatedBy: w.mihai,
      },
    });

    const res = await addFreon(w);

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['jobTypeId:duplicate']);
  });

  it('lets one of two adds of the same job through', async () => {
    const w = await world();

    const answers = await Promise.all([addFreon(w), addFreon(w)]);

    expect(answers.map((res) => res.status).sort()).toEqual([201, 422]);
    const refused = answers.find((res) => res.status === 422);
    expect(errorsOf(refused?.body)).toEqual(['jobTypeId:duplicate']);
    expect(await rowsOf(w)).toHaveLength(1);
    expect(await events(w)).toHaveLength(1);
  });

  it('refuses a job the catalogue does not hold', async () => {
    const w = await world();

    const res = await add(w, { jobTypeId: randomUUID(), ...FREON });

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['jobTypeId:unknown_job']);
    expect(await history(w)).toEqual([]);
  });

  it.each(['pending', 'rejected'] as const)(
    'refuses a %s catalogue job',
    async (status) => {
      const w = await world();
      const proposed = await prisma.jobType.create({
        data: {
          key: `job-${randomUUID()}`,
          nameEn: 'Recondiționare injectoare',
          nameRo: 'Recondiționare injectoare',
          status,
        },
      });

      const res = await add(w, { jobTypeId: proposed.id, ...FREON });

      expect(res.status).toBe(422);
      expect(errorsOf(res.body)).toEqual(['jobTypeId:not_approved']);
      expect(await rowsOf(w, proposed.id)).toEqual([]);
    },
  );

  it('refuses a fifty-first job, a pending one counted, and takes the fiftieth', async () => {
    const w = await world();
    const more = await Promise.all(
      Array.from({ length: 48 }, (_, i) =>
        jobType(`Lucrare ${i}`, i === 0 ? 'pending' : 'approved'),
      ),
    );
    await prisma.garagePrice.createMany({
      data: more.map((job, i) => ({
        fromBani: 10_000,
        garageId: w.nord.id,
        jobTypeId: job.id,
        position: 10 + i,
        updatedBy: w.mihai,
      })),
    });
    const fiftieth = await jobType('Lucrarea cincizeci');

    expect((await add(w, { jobTypeId: fiftieth.id, ...FREON })).status).toBe(
      201,
    );
    const res = await addFreon(w);

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['jobTypeId:too_many']);
    expect(await rowsOf(w)).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a job id that is not a uuid', { ...FREON, jobTypeId: 'frane' }],
    ['a missing job id', { ...FREON }],
    ['an unknown field', { ...FREON, jobTypeId: randomUUID(), visible: false }],
  ])('answers 400 for %s', async (_case, body) => {
    const w = await world();

    expect((await add(w, body)).status).toBe(400);
    expect(await history(w)).toEqual([]);
  });

  it('answers 400 for a garage id that is not a uuid', async () => {
    const w = await world();

    const res = await add(w, { jobTypeId: w.freon.id, ...FREON }, w.owner, 'x');

    expect(res.status).toBe(400);
  });
});

// @traces 1352-catalogue-job-visibility-FR-003
describe('what the add leaves to the brands write', () => {
  it('ticks the job for no brand the garage takes', async () => {
    const w = await world();

    await addFreon(w);

    expect(
      await prisma.garageBrandJob.findMany({ where: { garageId: w.nord.id } }),
    ).toEqual([]);
  });
});

// @traces 1352-catalogue-job-visibility-FR-011
describe('who may add a job', () => {
  it.each(['receptionist', 'mechanic'] as const)(
    'refuses the garage %s with 403',
    async (key) => {
      const w = await world();

      const res = await addFreon(w, w[key]);

      expect(res.status).toBe(403);
      await expectNothingWritten(w);
    },
  );

  it.each(['other', 'admin'] as const)(
    'answers 404 to the %s with nothing about the garage',
    async (key) => {
      const w = await world();

      const res = await addFreon(w, w[key]);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      await expectNothingWritten(w);
    },
  );

  it('asks for a session', async () => {
    const w = await world();

    expect((await addFreon(w, null)).status).toBe(401);
  });
});

// @traces 1352-catalogue-job-visibility-FR-012
describe('what the add leaves alone', () => {
  it("keeps the garage's verification status and shows the job on the profile at once", async () => {
    const w = await world();
    const profile = () => http().get(`/garages/${w.nord.slug}`);
    await profile();

    await addFreon(w);

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(garage.status).toBe('approved');
    expect(await redis.exists(`v1:profile:${w.nord.slug}:-`)).toBe(0);
    const res = await profile();
    expect(res.body.prices).toContainEqual(
      expect.objectContaining({
        fromBani: 28_000,
        jobTypeId: w.freon.id,
        toBani: 36_000,
      }),
    );
  });
});

// @traces 1352-catalogue-job-visibility-FR-013
describe('what the add records', () => {
  it('writes one create entry on the new row in the shape the listing writes', async () => {
    const w = await world();

    await addFreon(w);

    const [row] = await rowsOf(w);
    expect(await history(w)).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: w.mihai,
        actorName: 'mihai',
        actorRole: 'owner',
        garageId: w.nord.id,
        internal: false,
        isKeyChange: false,
        kind: 'price_list',
        newValue: {
          brandId: null,
          durationMinutes: 45,
          fromBani: 28_000,
          jobTypeId: w.freon.id,
          position: 4,
          toBani: 36_000,
          visible: true,
        },
        subjectId: row?.id,
        subjectType: 'garage_price',
      }),
    ]);
  });

  it('keeps neither the row, the entry nor the event when the entry cannot be written', async () => {
    const w = await world();
    const audit = app.get<AuditPort>(AUDIT_PORT);
    const failing = jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('the entry write failed'));

    const res = await addFreon(w);
    failing.mockRestore();

    expect(res.status).toBe(500);
    await expectNothingWritten(w);
  });
});

// @traces 1352-catalogue-job-visibility-FR-014
describe('what the add tells the profile', () => {
  it('saves one price list event naming the job and no brand', async () => {
    const w = await world();

    await addFreon(w);

    const sent = await events(w);
    expect(sent.map((event) => event.payload)).toEqual([
      { brandIds: [], garageId: w.nord.id, jobTypeIds: [w.freon.id] },
    ]);
    expect([...(sent[0]?.audience ?? [])].sort()).toEqual([
      `garage:${w.nord.id}`,
      `public:garage:${w.nord.id}`,
    ]);
  });

  it('saves no event for a refused add', async () => {
    const w = await world();

    await add(w, { jobTypeId: w.brakes.id, ...FREON });

    expect(await events(w)).toEqual([]);
  });
});

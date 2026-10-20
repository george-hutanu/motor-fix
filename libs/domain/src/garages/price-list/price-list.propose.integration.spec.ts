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
import { audienceOf } from '../../events/audience';
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
  await prisma.$executeRawUnsafe('TRUNCATE brand, job_type CASCADE');
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const jobType = (
  nameRo: string,
  status: 'approved' | 'pending' | 'rejected' = 'approved',
  nameEn = nameRo,
  proposedByGarageId?: string,
) =>
  prisma.jobType.create({
    data: {
      key: `job-${randomUUID()}`,
      nameEn,
      nameRo,
      proposedByGarageId,
      status,
    },
  });

// Service Auto Nord, approved, taking BMW, with its owner Mihai, a
// receptionist and a mechanic; front brakes listed at position 3; Atelier
// Dinamo with its owner Radu.
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
  const brakes = await jobType('Frâne față', 'approved', 'Front brakes');
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
  return {
    admin: bearer(await account('ana', ['admin']), 'admin'),
    brakes,
    dinamo,
    mechanic: bearer(vlad, 'mechanic'),
    mihai,
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const NAME = 'Recondiționare injectoare';
const RANGE = { durationMinutes: 90, fromBani: 60_000, toBani: 90_000 };

const propose = (
  w: World,
  body: Record<string, unknown>,
  as: string | null = w.owner,
  garageId: string = w.nord.id,
) => {
  const req = http().post(`/garages/${garageId}/catalogue-jobs`);
  return (as ? req.set('Authorization', as) : req).send(body);
};

const proposeInjectors = (w: World, as?: string | null) =>
  propose(w, { name: NAME, ...RANGE }, as);

const proposedBy = (garageId: string) =>
  prisma.jobType.findMany({
    orderBy: { createdAt: 'asc' },
    where: { proposedByGarageId: garageId },
  });

const rowsOf = (w: World) =>
  prisma.garagePrice.findMany({
    orderBy: { position: 'asc' },
    where: { garageId: w.nord.id },
  });

const history = (w: World) =>
  prisma.activityLog.findMany({ where: { garageId: w.nord.id } });

const events = (w: World, kind: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { kind, payload: { equals: w.nord.id, path: ['garageId'] } },
  });

const errorsOf = (body: { errors?: { code: string; field: string }[] }) =>
  (body.errors ?? []).map(({ code, field }) => `${field}:${code}`).sort();

const expectNothingWritten = async (w: World) => {
  expect(await proposedBy(w.nord.id)).toEqual([]);
  expect(await rowsOf(w)).toHaveLength(1);
  expect(await history(w)).toEqual([]);
  expect(await events(w, 'catalogue_job.proposed')).toEqual([]);
  expect(await events(w, 'price_list.updated')).toEqual([]);
};

// @traces 1352-catalogue-job-visibility-FR-010
describe('POST /garages/:garageId/catalogue-jobs', () => {
  it('creates the pending catalogue job and its price row last on the list, and answers the saved row', async () => {
    const w = await world();

    const res = await proposeInjectors(w);

    expect(res.status).toBe(201);
    const [job] = await proposedBy(w.nord.id);
    expect(job).toMatchObject({
      key: 'reconditionare-injectoare',
      nameEn: NAME,
      nameRo: NAME,
      status: 'pending',
    });
    const row = (await rowsOf(w))[1];
    expect(row).toMatchObject({
      ...RANGE,
      brandId: null,
      jobTypeId: job?.id,
      position: 4,
      updatedBy: w.mihai,
      visible: true,
    });
    expect(res.body).toEqual({
      ...RANGE,
      jobTypeId: job?.id,
      priceId: row?.id,
      updatedAt: row?.updatedAt.toISOString(),
      warnings: [],
    });
    expect(
      await prisma.garageBrandJob.findMany({ where: { garageId: w.nord.id } }),
    ).toEqual([]);
  });

  it("lists the job on the owner's read as waiting for approval", async () => {
    const w = await world();
    await proposeInjectors(w);

    const list = await http()
      .get(`/garages/${w.nord.id}/prices`)
      .set('Authorization', w.owner);

    expect(list.body.items).toContainEqual(
      expect.objectContaining({
        nameRo: NAME,
        public: false,
        reason: 'awaiting_approval',
        visible: true,
      }),
    );
  });

  it('stores the name trimmed and takes a starting price alone', async () => {
    const w = await world();

    const res = await propose(w, { fromBani: 60_000, name: `  ${NAME}  ` });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('toBani');
    expect(res.body).not.toHaveProperty('durationMinutes');
    expect(await proposedBy(w.nord.id)).toEqual([
      expect.objectContaining({ nameEn: NAME, nameRo: NAME }),
    ]);
  });

  it('warns of a wide range and still stores it', async () => {
    const w = await world();

    const res = await propose(w, {
      fromBani: 20_000,
      name: NAME,
      toBani: 500_000,
    });

    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([
      expect.objectContaining({ code: 'wide_range', field: 'toBani' }),
    ]);
  });

  it('accepts a name equal only to a rejected proposal as a new pending job', async () => {
    const w = await world();
    const rejected = await jobType(NAME, 'rejected', NAME, w.nord.id);

    const res = await proposeInjectors(w);

    expect(res.status).toBe(201);
    expect(res.body.jobTypeId).not.toBe(rejected.id);
    expect(
      (await proposedBy(w.nord.id)).map((job) => job.status).sort(),
    ).toEqual(['pending', 'rejected']);
  });

  it('lets two garages propose the same name, each its own pending job', async () => {
    const w = await world();

    const nord = await proposeInjectors(w);
    const dinamo = await propose(
      w,
      { name: NAME, ...RANGE },
      w.other,
      w.dinamo.id,
    );

    expect([nord.status, dinamo.status]).toEqual([201, 201]);
    expect(nord.body.jobTypeId).not.toBe(dinamo.body.jobTypeId);
    expect(await proposedBy(w.dinamo.id)).toEqual([
      expect.objectContaining({ nameRo: NAME, status: 'pending' }),
    ]);
  });
});

// @traces 1352-catalogue-job-visibility-FR-010
describe('what the proposal refuses', () => {
  it.each<[string, Record<string, unknown>]>([
    ['a name of two characters after trimming', { name: '  Ab  ' }],
    ['a name over 80 characters', { name: 'x'.repeat(81) }],
    ['a missing name', {}],
    ['a name that is not text', { name: 42 }],
    ['an unknown field', { name: NAME, visible: false }],
  ])('answers 400 for %s with nothing written', async (_case, values) => {
    const w = await world();

    const res = await propose(w, { ...RANGE, ...values });

    // The API's own filter names it validation_failed; this module answers
    // the pipe's plain 400.
    expect(res.status).toBe(400);
    await expectNothingWritten(w);
  });

  it('refuses a range the range check refuses, with nothing written', async () => {
    const w = await world();

    const res = await propose(w, { fromBani: 90_000, name: NAME, toBani: 1 });

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['toBani:below_from']);
    await expectNothingWritten(w);
  });

  it('refuses a second proposal of a pending name, accents and case aside', async () => {
    const w = await world();
    await proposeInjectors(w);

    const res = await propose(w, {
      ...RANGE,
      name: ' RECONDITIONARE injectoare ',
    });

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['name:duplicate']);
    expect(await proposedBy(w.nord.id)).toHaveLength(1);
  });

  it('still refuses it once the owner removed the job from the list', async () => {
    const w = await world();
    const first = await proposeInjectors(w);
    await http()
      .delete(`/garages/${w.nord.id}/prices/${first.body.priceId}`)
      .set('Authorization', w.owner)
      .expect(204);

    const res = await proposeInjectors(w);

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['name:duplicate']);
    expect(await proposedBy(w.nord.id)).toHaveLength(1);
  });

  it.each([
    ['Romanian', 'frane FATA'],
    ['English', ' front brakes '],
  ])("refuses an approved job's %s name with the job's id", async (_, name) => {
    const w = await world();

    const res = await propose(w, { ...RANGE, name });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { code: 'exists', field: 'name', jobTypeId: w.brakes.id },
    ]);
    await expectNothingWritten(w);
  });

  it('refuses a fifty-first job, pending ones counted', async () => {
    const w = await world();
    const more = await Promise.all(
      Array.from({ length: 49 }, (_, i) =>
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

    const res = await proposeInjectors(w);

    expect(res.status).toBe(422);
    expect(errorsOf(res.body)).toEqual(['name:too_many']);
    expect(await proposedBy(w.nord.id)).toEqual([]);
  });

  it('answers 400 for a garage id that is not a uuid', async () => {
    const w = await world();

    expect(
      (await propose(w, { name: NAME, ...RANGE }, w.owner, 'x')).status,
    ).toBe(400);
  });
});

// @traces 1352-catalogue-job-visibility-FR-011
describe('who may propose a job', () => {
  it.each(['receptionist', 'mechanic'] as const)(
    'refuses the garage %s with 403',
    async (key) => {
      const w = await world();

      const res = await proposeInjectors(w, w[key]);

      expect(res.status).toBe(403);
      await expectNothingWritten(w);
    },
  );

  it.each(['other', 'admin'] as const)(
    'answers 404 to the %s with nothing about the garage',
    async (key) => {
      const w = await world();

      const res = await proposeInjectors(w, w[key]);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      await expectNothingWritten(w);
    },
  );

  it('asks for a session', async () => {
    const w = await world();

    expect((await proposeInjectors(w, null)).status).toBe(401);
  });
});

// @traces 1352-catalogue-job-visibility-FR-012
describe('what the proposal leaves alone', () => {
  it("keeps the garage's verification status and drops the profile's cached entry", async () => {
    const w = await world();
    await http().get(`/garages/${w.nord.slug}`);

    await proposeInjectors(w);

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: w.nord.id } }),
    ).toMatchObject({ status: 'approved' });
    expect(await redis.exists(`v1:profile:${w.nord.slug}:-`)).toBe(0);
  });
});

// @traces 1352-catalogue-job-visibility-FR-013
describe('what the proposal records', () => {
  it('writes the catalogue job and the price row create entries as the owner', async () => {
    const w = await world();

    await proposeInjectors(w);

    const [job] = await proposedBy(w.nord.id);
    const row = (await rowsOf(w))[1];
    const owner = {
      action: 'create',
      actorId: w.mihai,
      actorRole: 'owner',
      garageId: w.nord.id,
      internal: false,
      isKeyChange: false,
      kind: 'price_list',
    };
    const entries = await history(w);
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ...owner,
          newValue: {
            key: 'reconditionare-injectoare',
            name_en: NAME,
            name_ro: NAME,
            status: 'pending',
          },
          subjectId: job?.id,
          subjectType: 'job_type',
        }),
        expect.objectContaining({
          ...owner,
          newValue: {
            brandId: null,
            ...RANGE,
            jobTypeId: job?.id,
            position: 4,
            visible: true,
          },
          subjectId: row?.id,
          subjectType: 'garage_price',
        }),
      ]),
    );
  });

  it('keeps no job, row, entry or event when an entry cannot be written', async () => {
    const w = await world();
    const audit = app.get<AuditPort>(AUDIT_PORT);
    const failing = jest
      .spyOn(audit, 'record')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('the entry write failed'));

    const res = await proposeInjectors(w);
    failing.mockRestore();

    expect(res.status).toBe(500);
    await expectNothingWritten(w);
  });
});

// @traces 1352-catalogue-job-visibility-FR-014
describe('what the proposal tells the admins and the profile', () => {
  it('saves the admins’ catalogue event and one price list event', async () => {
    const w = await world();

    await proposeInjectors(w);

    const [job] = await proposedBy(w.nord.id);
    const [proposed] = await events(w, 'catalogue_job.proposed');
    expect(proposed).toMatchObject({
      audience: audienceOf({ adminOnly: true, type: 'platform' }),
      payload: { garageId: w.nord.id, jobTypeId: job?.id },
      subjectId: job?.id,
    });
    expect(
      (await events(w, 'price_list.updated')).map((event) => event.payload),
    ).toEqual([{ brandIds: [], garageId: w.nord.id, jobTypeIds: [job?.id] }]);
  });

  it('saves no event for a refused proposal', async () => {
    const w = await world();

    await propose(w, { ...RANGE, name: 'Frâne față' });

    expect(await events(w, 'catalogue_job.proposed')).toEqual([]);
    expect(await events(w, 'price_list.updated')).toEqual([]);
  });
});

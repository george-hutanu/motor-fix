import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
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

// @traces 1247-FR-001

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let mark: bigint;

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
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  mark = await outboxMark(prisma);
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

async function brand(name: string, popularity: number | null = null) {
  const key = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({
    data: { key, name, popularity, slug: key },
  });
}

// Service Auto Nord (approved unless said) with its brand texts, its owner Mihai, a receptionist and a
// mechanic; Atelier Dinamo with its owner Radu; an admin.
async function world(status: 'approved' | 'suspended' = 'approved') {
  const nord = await prisma.garage.create({
    data: {
      brandNote: 'Fără mașini 100% electrice',
      name: 'Service Auto Nord',
      refusalPhrase: 'orice nu e BMW',
      slug: `nord-${randomUUID()}`,
      status,
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
  return {
    admin: bearer(ana, 'admin'),
    bmw: await brand('BMW', 2),
    mechanic: bearer(vlad, 'mechanic'),
    mini: await brand('Mini', 1),
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
    tesla: await brand('Tesla'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const get = (w: World, as: string | null = w.owner, id = w.nord.id) => {
  const req = http().get(`/garages/${id}/brands`);
  return as ? req.set('Authorization', as) : req;
};

async function jobType(nameRo: string, nameEn: string) {
  return (
    await prisma.jobType.create({
      data: {
        key: `${nameEn}-${randomUUID()}`,
        nameEn,
        nameRo,
        status: 'approved',
      },
    })
  ).id;
}

// Front brakes then an oil change on the price list (the oil change twice,
// for two brand ranges); BMW taken on diesel with the oil change ticked,
// Mini taken on every fuel with both jobs, Tesla refused.
async function marked(w: World) {
  const brakes = await jobType('Plăcuțe față', 'Front brakes');
  const oil = await jobType('Schimb ulei', 'Oil change');
  const owner = await prisma.garageMember.findFirstOrThrow({
    where: { garageId: w.nord.id, role: 'owner' },
  });
  await prisma.garagePrice.createMany({
    data: [
      { brandId: null, jobTypeId: brakes, position: 0 },
      { brandId: null, jobTypeId: oil, position: 1 },
      { brandId: w.bmw.id, jobTypeId: oil, position: 2 },
    ].map((price) => ({
      ...price,
      fromBani: 30_000,
      garageId: w.nord.id,
      updatedBy: owner.accountId,
    })),
  });
  const brand = (
    brandId: string,
    data: { stance: 'works_on' | 'does_not_take' } & Partial<
      Record<'diesel' | 'electric' | 'hybrid' | 'petrol', boolean>
    >,
  ) =>
    prisma.garageBrand.create({
      data: { brandId, garageId: w.nord.id, ...data },
    });
  await brand(w.bmw.id, {
    electric: false,
    hybrid: false,
    petrol: false,
    stance: 'works_on',
  });
  await brand(w.mini.id, { stance: 'works_on' });
  await brand(w.tesla.id, {
    diesel: false,
    electric: false,
    hybrid: false,
    petrol: false,
    stance: 'does_not_take',
  });
  await prisma.garageBrandJob.createMany({
    data: [
      { brandId: w.bmw.id, jobTypeId: oil },
      { brandId: w.mini.id, jobTypeId: oil },
      { brandId: w.mini.id, jobTypeId: brakes },
    ].map((tick) => ({ ...tick, garageId: w.nord.id })),
  });
  return { brakes, oil };
}

describe('GET /garages/:garageId/brands', () => {
  it("answers the owner with the brand answer, each taken brand's fuels and jobs, and the price list", async () => {
    const w = await world();
    const { brakes, oil } = await marked(w);

    const res = await get(w);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brandNote: 'Fără mașini 100% electrice',
      doesNotTake: [{ id: w.tesla.id, name: 'Tesla', slug: w.tesla.slug }],
      priceList: [
        { jobTypeId: brakes, nameEn: 'Front brakes', nameRo: 'Plăcuțe față' },
        { jobTypeId: oil, nameEn: 'Oil change', nameRo: 'Schimb ulei' },
      ],
      refusalPhrase: 'orice nu e BMW',
      worksOn: [
        {
          fuels: ['petrol', 'diesel', 'hybrid', 'electric'],
          id: w.mini.id,
          jobs: [brakes, oil],
          name: 'Mini',
          slug: w.mini.slug,
        },
        {
          fuels: ['diesel'],
          id: w.bmw.id,
          jobs: [oil],
          name: 'BMW',
          slug: w.bmw.slug,
        },
      ],
    });
  });

  it('answers an empty answer and an empty price list to a garage that marked nothing', async () => {
    const w = await world();
    await prisma.garage.update({
      data: { brandNote: null, refusalPhrase: null },
      where: { id: w.nord.id },
    });

    const res = await get(w);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brandNote: null,
      doesNotTake: [],
      priceList: [],
      refusalPhrase: null,
      worksOn: [],
    });
  });

  it('writes no history entry and no event', async () => {
    const w = await world();
    await marked(w);
    const entries = await prisma.activityLog.count({
      where: { garageId: w.nord.id },
    });

    await get(w).expect(200);

    expect(
      await prisma.activityLog.count({ where: { garageId: w.nord.id } }),
    ).toBe(entries);
    expect(
      await prisma.outboxEvent.count({ where: { id: { gt: mark } } }),
    ).toBe(0);
  });

  it("answers 403 forbidden to the garage's own receptionist and mechanic", async () => {
    const w = await world();

    for (const as of [w.receptionist, w.mechanic]) {
      const res = await get(w, as);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    }
  });

  it("answers 404 not_found to another garage's owner, a driver and an admin", async () => {
    const w = await world();
    const driver = bearer(await account('andrei', ['driver']), 'driver');

    for (const as of [w.other, driver, w.admin]) {
      const res = await get(w, as);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(JSON.stringify(res.body)).not.toContain('Service Auto Nord');
    }
  });

  it('answers 404 not_found for an id that is no garage', async () => {
    const w = await world();

    const res = await get(w, w.owner, randomUUID());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 410 gone to the owner of a suspended garage', async () => {
    const w = await world('suspended');

    const res = await get(w);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('gone');
  });

  it('answers 401 without a session', async () => {
    const w = await world();

    const res = await get(w, null);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });
});

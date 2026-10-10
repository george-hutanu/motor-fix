import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PriceListService } from './price-list.service';
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
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

// Service Auto Nord (approved) with its owner Mihai, a receptionist and a
// mechanic; Atelier Dinamo with its owner Radu.
async function world(rarActivities: string[] = []) {
  const nord = await prisma.garage.create({
    data: {
      name: 'Service Auto Nord',
      rarActivities,
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
  return {
    mechanic: bearer(vlad, 'mechanic'),
    mihai,
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const jobType = (
  nameRo: string,
  status: 'approved' | 'pending' | 'rejected' = 'approved',
  rarActivity: string | null = null,
) =>
  prisma.jobType.create({
    data: {
      key: `job-${randomUUID()}`,
      nameEn: nameRo,
      nameRo,
      rarActivity,
      status,
    },
  });

const price = (
  w: World,
  jobTypeId: string,
  position: number,
  extra: Record<string, unknown> = {},
) =>
  prisma.garagePrice.create({
    data: {
      fromBani: 35_000,
      garageId: w.nord.id,
      jobTypeId,
      position,
      toBani: 48_000,
      updatedBy: w.mihai,
      ...extra,
    },
  });

const read = (w: World, as: string | null = w.owner, id = w.nord.id) => {
  const req = http().get(`/garages/${id}/prices`);
  return as ? req.set('Authorization', as) : req;
};

const profile = (w: World) => http().get(`/garages/${w.nord.slug}`);

// @traces 357-public-price-jobs-FR-001
// @traces 357-public-price-jobs-FR-002
// @traces 357-public-price-jobs-FR-007
describe('GET /garages/:garageId/prices', () => {
  it('gives every job its state, the first reason and its default range', async () => {
    const w = await world(['ITP']);
    const bmw = await prisma.brand.create({
      data: {
        key: `bmw-${randomUUID()}`,
        name: 'BMW',
        slug: `bmw-${randomUUID()}`,
      },
    });
    const oil = await jobType('Schimb ulei');
    const suspension = await jobType('Verificare suspensie și geometrie');
    const chain = await jobType('Kit lanț de distribuție');
    const pending = await jobType('Reglaj faruri', 'pending');
    const rejected = await jobType('Spălare motor', 'rejected', 'X');
    const outside = await jobType('Inspecție tehnică', 'approved', 'ROTI');
    await price(w, oil.id, 0, { durationMinutes: 60 });
    await price(w, suspension.id, 1, { durationMinutes: 90, toBani: null });
    await price(w, suspension.id, 7, { brandId: bmw.id, fromBani: 40_000 });
    await price(w, chain.id, 2, { visible: false });
    await price(w, pending.id, 3);
    await price(w, rejected.id, 4, { toBani: null, visible: false });
    await price(w, outside.id, 5);

    const res = await read(w);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          durationMinutes: 60,
          fromBani: 35_000,
          jobTypeId: oil.id,
          nameEn: 'Schimb ulei',
          nameRo: 'Schimb ulei',
          public: true,
          toBani: 48_000,
        },
        {
          durationMinutes: 90,
          fromBani: 35_000,
          jobTypeId: suspension.id,
          nameEn: suspension.nameEn,
          nameRo: suspension.nameRo,
          public: false,
          reason: 'no_top_price',
        },
        expect.objectContaining({
          jobTypeId: chain.id,
          public: false,
          reason: 'hidden_by_garage',
          toBani: 48_000,
        }),
        expect.objectContaining({
          jobTypeId: pending.id,
          reason: 'awaiting_approval',
        }),
        expect.objectContaining({ jobTypeId: rejected.id, reason: 'rejected' }),
        expect.objectContaining({
          jobTypeId: outside.id,
          reason: 'not_authorised',
        }),
      ],
    });
  });

  it('makes a job public once its top is set, with no other write', async () => {
    const w = await world();
    const suspension = await jobType('Verificare suspensie și geometrie');
    const row = await price(w, suspension.id, 0, { toBani: null });
    expect((await read(w)).body.items[0]).toMatchObject({
      public: false,
      reason: 'no_top_price',
    });

    await prisma.garagePrice.update({
      data: { toBani: 48_000 },
      where: { id: row.id },
    });

    const [item] = (await read(w)).body.items;
    expect(item).toMatchObject({ public: true, toBani: 48_000 });
    expect(item).not.toHaveProperty('reason');
  });

  // @traces 357-public-price-jobs-FR-008
  it('covers every job while the garage has no RAR activity recorded', async () => {
    const w = await world();
    const itp = await jobType('Inspecție tehnică', 'approved', 'ROTI');
    await price(w, itp.id, 0);

    expect((await read(w)).body.items[0]).toMatchObject({ public: true });

    await prisma.garage.update({
      data: { rarActivities: ['ITP'] },
      where: { id: w.nord.id },
    });

    expect((await read(w)).body.items[0]).toMatchObject({
      public: false,
      reason: 'not_authorised',
    });
  });

  it('answers an empty list for a garage with no price', async () => {
    const w = await world();

    const res = await read(w);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  // @traces 357-public-price-jobs-FR-009
  it.each([
    ['a receptionist', 'receptionist', 403, 'forbidden'],
    ['a mechanic', 'mechanic', 403, 'forbidden'],
    ["another garage's owner", 'other', 404, 'not_found'],
  ] as const)('refuses %s', async (_who, as, status, code) => {
    const w = await world();
    await price(w, (await jobType('Schimb ulei')).id, 0);

    const res = await read(w, w[as]);

    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toContain('Schimb ulei');
  });

  it('asks for a session', async () => {
    const w = await world();

    expect((await read(w, null)).status).toBe(401);
  });

  it('refuses an id that is not a uuid before any check', async () => {
    const w = await world();

    const res = await read(w, w.owner, 'not-a-uuid');

    // Its code, validation_failed, comes from the api's ProblemFilter.
    expect(res.status).toBe(400);
  });

  it('answers an assistant acting for the owner as it answers the owner', async () => {
    const w = await world();
    await price(w, (await jobType('Schimb ulei')).id, 0);
    const owner = (await read(w)).body;

    const viaAssistant = await app.get(PriceListService).read(
      {
        accountId: w.mihai,
        garageId: w.nord.id,
        permissions: {
          canAnswerQuotes: false,
          canMoveBookings: false,
          canRecordFinalPrice: false,
        },
        role: 'garage',
        roles: ['garage'],
        scopes: ['motorfix.read'],
        via: 'assistant',
      },
      w.nord.id,
    );

    expect(viaAssistant).toEqual(owner);
  });
});

// @traces 357-public-price-jobs-FR-005
// @traces 357-public-price-jobs-FR-006
describe('the public profile and the owner agree', () => {
  it('lists on the profile exactly the jobs the owner sees as public', async () => {
    const w = await world(['ITP']);
    const jobs = await Promise.all([
      jobType('Schimb ulei'),
      jobType('Verificare suspensie și geometrie'),
      jobType('Kit lanț de distribuție'),
      jobType('Reglaj faruri', 'pending'),
      jobType('Inspecție tehnică', 'approved', 'ROTI'),
      jobType('Plăcuțe frână'),
    ]);
    await price(w, jobs[0].id, 3);
    await price(w, jobs[1].id, 0, { toBani: null });
    await price(w, jobs[2].id, 1, { visible: false });
    await price(w, jobs[3].id, 2);
    await price(w, jobs[4].id, 4);
    await price(w, jobs[5].id, 5);

    const owner = (await read(w)).body.items as {
      jobTypeId: string;
      public: boolean;
    }[];
    const shown = (await profile(w)).body.jobTypes as { id: string }[];

    expect(shown.map((job) => job.id)).toEqual(
      owner.filter((item) => item.public).map((item) => item.jobTypeId),
    );
    expect(shown.map((job) => job.id)).toEqual([jobs[0].id, jobs[5].id]);
  });
});

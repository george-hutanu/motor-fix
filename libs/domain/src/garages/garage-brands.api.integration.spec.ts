import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { GaragesModule } from './garages.module';
import { signAccessToken } from '../auth/access-token';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { serialDatabase } from '../auth/serial-db.testing';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../notifications/notifications.testing';

// @traces 040-FR-008 040-FR-009 040-FR-011 040-FR-012

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let since: Date;

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
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
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

// Service Auto Nord (approved) with its owner Mihai, a receptionist and a
// mechanic; Atelier Dinamo with its owner Radu; an admin.
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
    data: { accountId: vlad, garageId: nord.id },
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

const put = (w: World, body: object, as: string | null = w.owner) => {
  const req = http().put(`/garages/${w.nord.id}/brands`).send(body);
  return as ? req.set('Authorization', as) : req;
};

const rows = (w: World) =>
  prisma.garageBrand.count({ where: { garageId: w.nord.id } });

describe('PUT /garages/:garageId/brands', () => {
  it("replaces the owner's answer and returns it in catalogue order", async () => {
    const w = await world();

    const res = await put(w, {
      brandNote: '  Fără mașini 100% electrice ',
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: w.mini.id, stance: 'works_on' },
        { brandId: w.tesla.id, stance: 'does_not_take' },
      ],
      refusalPhrase: 'orice nu e BMW',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brandNote: 'Fără mașini 100% electrice',
      doesNotTake: [{ id: w.tesla.id, name: 'Tesla', slug: w.tesla.slug }],
      refusalPhrase: 'orice nu e BMW',
      worksOn: [
        { id: w.mini.id, name: 'Mini', slug: w.mini.slug },
        { id: w.bmw.id, name: 'BMW', slug: w.bmw.slug },
      ],
    });
  });

  it('saves one garage.updated event for the change', async () => {
    const w = await world();

    await put(w, { brands: [{ brandId: w.bmw.id, stance: 'works_on' }] });

    const events = await prisma.outboxEvent.findMany({
      where: { createdAt: { gte: since }, kind: 'garage.updated' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      fields: ['brands'],
      garageId: w.nord.id,
    });
  });

  it.each([
    [
      'a stance that is neither taken nor refused',
      (w: World) => ({ brands: [{ brandId: w.bmw.id, stance: 'unstated' }] }),
    ],
    [
      'a brand id that is not a uuid',
      () => ({ brands: [{ brandId: 'bmw', stance: 'works_on' }] }),
    ],
    [
      'the same brand twice',
      (w: World) => ({
        brands: [
          { brandId: w.bmw.id, stance: 'works_on' },
          { brandId: w.bmw.id, stance: 'does_not_take' },
        ],
      }),
    ],
    [
      'a brand missing from the catalogue',
      () => ({ brands: [{ brandId: randomUUID(), stance: 'works_on' }] }),
    ],
    [
      'a note of 141 characters',
      () => ({ brandNote: 'a'.repeat(141), brands: [] }),
    ],
    [
      'a phrase of 61 characters',
      () => ({ brands: [], refusalPhrase: 'a'.repeat(61) }),
    ],
    ['no set at all', () => ({})],
  ])('answers 400 to %s and changes nothing', async (_, body) => {
    const w = await world();

    const res = await put(w, body(w));

    expect(res.status).toBe(400);
    expect(await rows(w)).toBe(0);
  });

  it("answers 403 to the garage's own receptionist and mechanic", async () => {
    const w = await world();
    const body = { brands: [{ brandId: w.bmw.id, stance: 'works_on' }] };

    for (const as of [w.receptionist, w.mechanic]) {
      const res = await put(w, body, as);
      expect(res.status).toBe(403);
    }
    expect(await rows(w)).toBe(0);
  });

  it("answers 404 not_found to another garage's owner and to an admin", async () => {
    const w = await world();
    const body = { brands: [{ brandId: w.bmw.id, stance: 'works_on' }] };

    for (const as of [w.other, w.admin]) {
      const res = await put(w, body, as);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
    expect(await rows(w)).toBe(0);
  });

  it('answers 404 for a garage that does not exist', async () => {
    const w = await world();

    const res = await http()
      .put(`/garages/${randomUUID()}/brands`)
      .set('Authorization', w.owner)
      .send({ brands: [] });

    expect(res.status).toBe(404);
  });

  it('answers 401 without a session', async () => {
    const w = await world();

    const res = await put(w, { brands: [] }, null);

    expect(res.status).toBe(401);
  });
});

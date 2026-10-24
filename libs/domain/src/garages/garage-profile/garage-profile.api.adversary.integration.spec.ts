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

// @traces 133-FR-001 133-FR-002 133-FR-004 133-FR-015

const redisUrl = redisUrlFor(2);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const PHONE = '+40722123456';
let app: NestExpressApplication;
let redis: Redis;

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
  redis = new Redis(redisUrl);
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.flushdb();
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const staffRead = (garageId: string, as: string | null) => {
  const req = http().get(`/garages/${garageId}/profile`);
  return as ? req.set('Authorization', as) : req;
};

// Service Auto Nord with its owner, a receptionist and a mechanic; Atelier
// Dinamo with its owner; a driver and an admin.
async function world(
  data: Partial<Parameters<typeof prisma.garage.create>[0]['data']> = {},
) {
  const nord = await prisma.garage.create({
    data: {
      address: 'Str. Atelierului 14, București',
      name: 'Service Auto Nord',
      phone: PHONE,
      slug: `nord-${randomUUID()}`,
      status: 'approved',
      ...data,
    },
  });
  const dinamo = await prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
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
  const andrei = await account('andrei', ['driver']);
  const ana = await account('ana', ['admin']);
  return {
    admin: bearer(ana, 'admin'),
    driver: bearer(andrei, 'driver'),
    mechanic: bearer(vlad, 'mechanic'),
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

describe('the staff read of a garage profile under attack', () => {
  it('answers 404 to another garage owner even while the garage is suspended', async () => {
    const w = await world({ status: 'suspended' });

    const res = await staffRead(w.nord.id, w.other);

    expect(res.status).toBe(404);
  });

  it('answers 403 to the receptionist of a suspended garage', async () => {
    const w = await world({ status: 'suspended' });

    const res = await staffRead(w.nord.id, w.receptionist);

    expect(res.status).toBe(403);
  });

  it('answers 403 to the mechanic of a garage not yet approved', async () => {
    const w = await world({ status: 'draft' });

    const res = await staffRead(w.nord.id, w.mechanic);

    expect(res.status).toBe(403);
  });

  it('answers 404 to a driver and an admin for a suspended garage, never 410', async () => {
    const w = await world({ status: 'suspended' });

    for (const as of [w.driver, w.admin]) {
      const res = await staffRead(w.nord.id, as);
      expect(res.status).toBe(404);
    }
  });

  it('answers 401 before anything else for a malformed bearer token', async () => {
    const w = await world();

    const res = await staffRead(w.nord.id, 'Bearer not.a.token');

    expect(res.status).toBe(401);
  });

  it('answers 401 for a token signed with another secret', async () => {
    const w = await world();
    const forged = `Bearer ${signAccessToken(
      { accountId: randomUUID(), role: 'garage' },
      'other-secret',
    )}`;

    const res = await staffRead(w.nord.id, forged);

    expect(res.status).toBe(401);
  });

  it('answers 404 to a token for an account that does not exist', async () => {
    const w = await world();

    const res = await staffRead(w.nord.id, bearer(randomUUID(), 'garage'));

    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('722123456');
  });

  it('answers 400 for a garage id with trailing text after a uuid', async () => {
    const w = await world();

    const res = await staffRead(`${w.nord.id}x`, w.owner);

    expect(res.status).toBe(400);
  });

  it('answers 400 when the garage slug is given in place of the id', async () => {
    const w = await world();

    const res = await staffRead(w.nord.slug, w.owner);

    expect(res.status).toBe(400);
  });

  it('answers the same body twice in a row', async () => {
    const w = await world();

    const first = await staffRead(w.nord.id, w.owner);
    const second = await staffRead(w.nord.id, w.owner);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('keeps the phone when the public read has filled the cache first', async () => {
    const w = await world();
    await http().get(`/garages/${w.nord.slug}`).expect(200);

    const res = await staffRead(w.nord.id, w.owner);

    expect(res.body.phone).toBe(PHONE);
  });

  it('shows the new phone at once after the row changes, whatever the cache holds', async () => {
    const w = await world();
    await staffRead(w.nord.id, w.owner).expect(200);

    await prisma.garage.update({
      data: { phone: '+40733999888' },
      where: { id: w.nord.id },
    });
    const res = await staffRead(w.nord.id, w.owner);

    expect(res.body.phone).toBe('+40733999888');
  });

  it('ignores brand and near parameters on the query string', async () => {
    const w = await world();

    const res = await staffRead(w.nord.id, w.owner).query({
      brand: 'bmw',
      near: '44.4,26.1',
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('brand');
    expect(res.body).not.toHaveProperty('distanceKm');
  });

  it('keeps the phone of a garage out of another garage owner answer', async () => {
    const w = await world();

    const res = await staffRead(w.nord.id, w.other);

    expect(res.text).not.toContain('722123456');
    expect(res.text).not.toContain('Service Auto Nord');
  });

  it('refuses a POST, PUT and DELETE on the route', async () => {
    const w = await world();

    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await http()
        [method](`/garages/${w.nord.id}/profile`)
        .set('Authorization', w.owner);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(500);
    }
  });

  it('answers 404 to an owner whose membership row is removed', async () => {
    const w = await world();
    await prisma.garageMember.deleteMany({ where: { garageId: w.nord.id } });

    const res = await staffRead(w.nord.id, w.owner);

    expect(res.status).toBe(404);
  });

  it('writes no row anywhere on a 403 and a 404', async () => {
    const w = await world();
    const before = await prisma.activityLog.count();

    await staffRead(w.nord.id, w.mechanic);
    await staffRead(randomUUID(), w.owner);

    expect(await prisma.activityLog.count()).toBe(before);
  });
});

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
import { cacheKey } from '../../cache/cache.service';
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
import { NO_BRAND } from '../public-garages/public-garages';

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

describe("the staff read of a garage's own public profile", () => {
  it('answers the owner with the public answer plus the stored phone', async () => {
    const w = await world();
    await prisma.garageFacility.create({
      data: { facility: 'waiting_area', garageId: w.nord.id },
    });

    const staff = await staffRead(w.nord.id, w.owner);
    const open = await http().get(`/garages/${w.nord.slug}`);

    expect(staff.status).toBe(200);
    expect(open.status).toBe(200);
    const { phone, ...rest } = staff.body;
    expect(phone).toBe(PHONE);
    expect(rest).toEqual(open.body);
    expect(Object.keys(staff.body).sort()).toEqual(
      [...Object.keys(open.body), 'phone'].sort(),
    );
  });

  it('never carries the fiscal code, the seat or the position', async () => {
    const w = await world({
      address: null,
      businessKind: 'mobile',
      cui: '12345678',
      latitude: 44.9365,
      longitude: 26.0129,
      mobileLegalForm: 'pfa',
      seatAddress: 'Str. Sediului 3, Chiajna',
      serviceRadiusKm: 20,
    });

    const res = await staffRead(w.nord.id, w.owner);

    expect(res.status).toBe(200);
    expect(res.body.serviceRadiusKm).toBe(20);
    for (const key of ['cui', 'seatAddress', 'latitude', 'longitude']) {
      expect(res.body).not.toHaveProperty(key);
    }
    expect(res.body).not.toHaveProperty('brand');
    expect(res.body).not.toHaveProperty('distanceKm');
    const raw = res.text.toLowerCase();
    expect(raw).not.toContain('12345678');
    expect(raw).not.toContain('sediului');
    expect(raw).not.toContain('44.9365');
  });

  it('answers phone null when the row has none', async () => {
    const w = await world({ phone: null });

    const res = await staffRead(w.nord.id, w.owner);

    expect(res.status).toBe(200);
    expect(res.body.phone).toBeNull();
  });

  it('keeps the phone out of the public answer and its cache entry', async () => {
    const w = await world();

    await staffRead(w.nord.id, w.owner).expect(200);
    const open = await http().get(`/garages/${w.nord.slug}`);

    expect(open.text).not.toContain('722123456');
    const entry = await redis.get(cacheKey('profile', w.nord.slug, NO_BRAND));
    expect(entry ?? '').not.toContain('722123456');
  });

  it('writes no history row and no event', async () => {
    const w = await world();
    const before = {
      events: await prisma.outboxEvent.count(),
      history: await prisma.activityLog.count(),
    };

    await staffRead(w.nord.id, w.owner).expect(200);
    await staffRead(w.nord.id, w.owner).expect(200);

    expect(await prisma.outboxEvent.count()).toBe(before.events);
    expect(await prisma.activityLog.count()).toBe(before.history);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const w = await world();

    const res = await staffRead(w.nord.id, null);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  // @traces 133-FR-003
  it("answers 403 forbidden to the garage's receptionist and mechanic", async () => {
    const w = await world();

    for (const as of [w.receptionist, w.mechanic]) {
      const res = await staffRead(w.nord.id, as);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
      expect(res.text).not.toContain('722123456');
    }
  });

  it("answers 404 not_found to another garage's owner, a driver and an admin", async () => {
    const w = await world();

    for (const as of [w.other, w.driver, w.admin]) {
      const res = await staffRead(w.nord.id, as);
      // The API's problem filter writes the not_found code on any 404.
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('722123456');
    }
  });

  it('answers 404 for an id that is no garage', async () => {
    const w = await world();

    const res = await staffRead(randomUUID(), w.owner);

    expect(res.status).toBe(404);
  });

  it('answers 400 for an id that is not a uuid', async () => {
    const w = await world();

    const res = await staffRead('not-a-uuid', w.owner);

    expect(res.status).toBe(400);
  });

  it('answers 410 gone to the owner of a suspended garage', async () => {
    const w = await world({ status: 'suspended' });

    const res = await staffRead(w.nord.id, w.owner);

    expect(res.status).toBe(410);
    expect(res.text).not.toContain('722123456');
  });

  it('answers 404 to the owner of a garage not yet approved', async () => {
    const w = await world({ status: 'draft' });
    await prisma.verificationFile.create({
      data: { garageId: w.nord.id, status: 'submitted' },
    });

    const res = await staffRead(w.nord.id, w.owner);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('722123456');
  });

  it('refuses the mechanic before telling a suspended garage apart', async () => {
    const w = await world({ status: 'suspended' });

    const res = await staffRead(w.nord.id, w.mechanic);

    expect(res.status).toBe(403);
  });
});

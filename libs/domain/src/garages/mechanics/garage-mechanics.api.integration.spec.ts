import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
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

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;

beforeAll(async () => {
  await brevo.start();
  const email = testConfig(brevo.url);
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
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(() => reset());

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const team = (garageId: string, auth?: string) => {
  const call = request(app.getHttpServer()).get(
    `/garages/${garageId}/mechanics`,
  );
  return auth ? call.set('Authorization', auth) : call;
};

// Atelier Dinamo: its owner Mihai (who has a card of his own), a receptionist,
// a mechanic with an account, and cards with none; Atelier Nord with its owner.
async function world() {
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const nord = await prisma.garage.create({
    data: { name: 'Atelier Nord', slug: `nord-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage', 'mechanic']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: dinamo.id, role: 'owner' },
  });
  await prisma.mechanic.create({
    data: { accountId: mihai, garageId: dinamo.id, name: 'Mihai Pop' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: dinamo.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  const vladCard = await prisma.mechanic.create({
    data: {
      accountId: vlad,
      garageId: dinamo.id,
      name: 'Tudor Vlad',
      onProfile: true,
      rating: 4.9,
      reviewCount: 58,
      speciality: 'Frâne, suspensie',
    },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: nord.id, role: 'owner' },
  });
  return { dinamo, ioana, mihai, nord, radu, vlad, vladCard };
}

const card = (garageId: string, name: string, extra: object = {}) =>
  prisma.mechanic.create({ data: { garageId, name, ...extra } });

const switchOff = (garageId: string) =>
  prisma.garageFeature.create({
    data: { enabled: false, garageId, key: 'team_mechanics' },
  });

// @traces 055-FR-001 055-FR-016
describe("reading the garage's team", () => {
  it("answers each current card by Romanian order, without the owner's own and a removed one", async () => {
    const { dinamo, mihai, vladCard } = await world();
    const stefan = await card(dinamo.id, 'Ștefan Ilie');
    const stan = await card(dinamo.id, 'stan Ion', { onProfile: true });
    await card(dinamo.id, 'Andrei Gone', { removedAt: new Date() });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          hasAccount: false,
          id: stan.id,
          name: 'stan Ion',
          onProfile: true,
          rating: null,
          reviewCount: 0,
          speciality: null,
        },
        {
          hasAccount: false,
          id: stefan.id,
          name: 'Ștefan Ilie',
          onProfile: false,
          rating: null,
          reviewCount: 0,
          speciality: null,
        },
        {
          hasAccount: true,
          id: vladCard.id,
          name: 'Tudor Vlad',
          onProfile: true,
          rating: '4.9',
          reviewCount: 58,
          speciality: 'Frâne, suspensie',
        },
      ],
    });
  });

  it('answers an empty list for a garage with no card', async () => {
    const { nord, radu } = await world();

    const res = await team(nord.id, bearer(radu, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  // @traces 055-FR-004
  it('leaves out a card that moved to another garage and one whose account was deleted', async () => {
    const { dinamo, mihai, nord, vlad } = await world();
    await prisma.mechanic.update({
      data: { garageId: nord.id },
      where: { accountId: vlad },
    });
    await card(dinamo.id, 'Elena Pop', {
      onProfile: false,
      removedAt: new Date(),
    });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.body).toEqual({ items: [] });
  });
});

// @traces 055-FR-002 055-FR-003 055-FR-016
describe('who reads the team', () => {
  it('answers the garage staff 403 forbidden', async () => {
    const { dinamo, ioana, vlad } = await world();

    for (const auth of [
      bearer(ioana, 'receptionist'),
      bearer(vlad, 'mechanic'),
    ]) {
      const res = await team(dinamo.id, auth);
      expect([res.status, res.body.code]).toEqual([403, 'forbidden']);
    }
  });

  it("answers a driver, an admin and another garage's owner 404 not_found", async () => {
    const { dinamo, radu } = await world();
    const driver = await account('andrei', ['driver']);
    const admin = await account('admin', ['admin']);

    for (const auth of [
      bearer(driver, 'driver'),
      bearer(admin, 'admin'),
      bearer(radu, 'garage'),
    ]) {
      const res = await team(dinamo.id, auth);
      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    }
  });

  it('answers 401 without a session', async () => {
    const { dinamo } = await world();

    expect((await team(dinamo.id)).status).toBe(401);
  });

  it('answers 400 to a garage id that is not a uuid', async () => {
    const { mihai } = await world();

    const res = await team('dinamo', bearer(mihai, 'garage'));

    expect(res.status).toBe(400);
  });

  // @traces 102-FR-003
  it('answers the owner 404 feature_off with the team switched off, after the access check', async () => {
    const { dinamo, ioana, mihai, radu, vlad } = await world();
    await switchOff(dinamo.id);

    const owner = await team(dinamo.id, bearer(mihai, 'garage'));
    const staff = await team(dinamo.id, bearer(ioana, 'receptionist'));
    const mechanic = await team(dinamo.id, bearer(vlad, 'mechanic'));
    const other = await team(dinamo.id, bearer(radu, 'garage'));

    expect([owner.status, owner.body.code]).toEqual([404, 'feature_off']);
    expect([staff.status, staff.body.code]).toEqual([403, 'forbidden']);
    expect([mechanic.status, mechanic.body.code]).toEqual([403, 'forbidden']);
    expect([other.status, other.body.code]).toEqual([404, 'not_found']);
  });

  it('answers the list again once the team is switched back on', async () => {
    const { dinamo, mihai } = await world();
    await switchOff(dinamo.id);
    await prisma.garageFeature.update({
      data: { enabled: true },
      where: { garageId_key: { garageId: dinamo.id, key: 'team_mechanics' } },
    });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

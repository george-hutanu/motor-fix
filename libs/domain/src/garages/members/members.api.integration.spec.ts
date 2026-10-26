import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
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

const DAY = 86_400_000;
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const members = (garageId: string, auth?: string) => {
  const call = request(app.getHttpServer()).get(`/garages/${garageId}/members`);
  return auth ? call.set('Authorization', auth) : call;
};

// Atelier Dinamo: its owner Mihai (with a card of his own), two receptionists,
// two mechanics with accounts, a card with none and a removed one; Atelier
// Nord with its owner; a driver and an admin.
async function world() {
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const nord = await prisma.garage.create({
    data: { name: 'Atelier Nord', slug: `nord-${randomUUID()}` },
  });
  const mihai = await account('Mihai Ionescu', ['garage', 'mechanic']);
  const owned = await prisma.garageMember.create({
    data: { accountId: mihai, garageId: dinamo.id, role: 'owner' },
  });
  await prisma.mechanic.create({
    data: { accountId: mihai, garageId: dinamo.id, name: 'Mihai Ionescu' },
  });
  const ioana = await account('Ioana Marin', ['receptionist']);
  const ioanaJoined = await prisma.garageMember.create({
    data: { accountId: ioana, garageId: dinamo.id, role: 'receptionist' },
  });
  const ana = await account('ana Pop', ['receptionist']);
  const anaJoined = await prisma.garageMember.create({
    data: { accountId: ana, garageId: dinamo.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  await prisma.mechanic.create({
    data: {
      accountId: vlad,
      canAnswerQuotes: true,
      garageId: dinamo.id,
      name: 'Ștefan Vlad',
    },
  });
  const sorin = await account('sorin', ['mechanic']);
  await prisma.mechanic.create({
    data: {
      accountId: sorin,
      canMoveBookings: true,
      canRecordFinalPrice: true,
      garageId: dinamo.id,
      name: 'Sorin Stan',
    },
  });
  await prisma.mechanic.create({
    data: { garageId: dinamo.id, name: 'Andrei Fără Cont' },
  });
  const gone = await account('gone', ['mechanic']);
  await prisma.mechanic.create({
    data: {
      accountId: gone,
      garageId: dinamo.id,
      name: 'Aurel Plecat',
      removedAt: new Date(),
    },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: nord.id, role: 'owner' },
  });
  const driver = await account('dana', ['driver']);
  const admin = await account('alex', ['admin']);
  return {
    admin,
    ana,
    anaJoined,
    dinamo,
    driver,
    ioana,
    ioanaJoined,
    mihai,
    nord,
    owned,
    radu,
    sorin,
    vlad,
  };
}

const invite = (
  garageId: string,
  email: string,
  extra: {
    createdAt?: Date;
    expiresAt?: Date;
    status?: 'sent' | 'accepted' | 'revoked';
    kind?: 'mechanic' | 'receptionist';
  } = {},
) =>
  prisma.staffInvite.create({
    data: {
      email,
      expiresAt: new Date(Date.now() + 7 * DAY),
      garageId,
      kind: 'mechanic',
      name: 'Invited Person',
      tokenHash: randomUUID(),
      ...extra,
    },
  });

// @traces 102-FR-011
describe('reading who has access to the garage', () => {
  it('answers the owner the members, owner first, then receptionists and mechanics, each by Romanian order', async () => {
    const w = await world();

    const res = await members(w.dinamo.id, bearer(w.mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      invites: [],
      members: [
        {
          accountId: w.mihai,
          name: 'Mihai Ionescu',
          permissions: null,
          role: 'owner',
          since: w.owned.joinedAt.toISOString(),
        },
        {
          accountId: w.ana,
          name: 'ana Pop',
          permissions: null,
          role: 'receptionist',
          since: w.anaJoined.joinedAt.toISOString(),
        },
        {
          accountId: w.ioana,
          name: 'Ioana Marin',
          permissions: null,
          role: 'receptionist',
          since: w.ioanaJoined.joinedAt.toISOString(),
        },
        {
          accountId: w.sorin,
          name: 'Sorin Stan',
          permissions: {
            canAnswerQuotes: false,
            canMoveBookings: true,
            canRecordFinalPrice: true,
          },
          role: 'mechanic',
          since: null,
        },
        {
          accountId: w.vlad,
          name: 'Ștefan Vlad',
          permissions: { ...NONE, canAnswerQuotes: true },
          role: 'mechanic',
          since: null,
        },
      ],
    });
  });

  it('carries no e-mail on a member and leaves out a card without an account and a removed one', async () => {
    const w = await world();

    const res = await members(w.dinamo.id, bearer(w.mihai, 'garage'));

    const names = res.body.members.map((m: { name: string }) => m.name);
    expect(names).not.toContain('Andrei Fără Cont');
    expect(names).not.toContain('Aurel Plecat');
    for (const member of res.body.members)
      expect(Object.keys(member).sort()).toEqual([
        'accountId',
        'name',
        'permissions',
        'role',
        'since',
      ]);
  });

  it('lists the sent invites still open, oldest first, and none past expiry, accepted or revoked', async () => {
    const w = await world();
    const second = await invite(w.dinamo.id, 'andrei@example.test', {
      createdAt: new Date(Date.now() - DAY),
      kind: 'receptionist',
    });
    const first = await invite(w.dinamo.id, 'elena@example.test', {
      createdAt: new Date(Date.now() - 2 * DAY),
    });
    await invite(w.dinamo.id, 'expired@example.test', {
      expiresAt: new Date(Date.now() - 1000),
    });
    await invite(w.dinamo.id, 'accepted@example.test', { status: 'accepted' });
    await invite(w.dinamo.id, 'revoked@example.test', { status: 'revoked' });
    await invite(w.nord.id, 'nord@example.test');

    const res = await members(w.dinamo.id, bearer(w.mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body.invites).toEqual([
      {
        email: 'elena@example.test',
        id: first.id,
        kind: 'mechanic',
        phone: null,
        sentAt: first.createdAt.toISOString(),
      },
      {
        email: 'andrei@example.test',
        id: second.id,
        kind: 'receptionist',
        phone: null,
        sentAt: second.createdAt.toISOString(),
      },
    ]);
  });

  // @traces 1255-FR-001
  it('lists an invite sent to a phone by its number', async () => {
    const w = await world();
    const sent = await prisma.staffInvite.create({
      data: {
        expiresAt: new Date(Date.now() + 7 * DAY),
        garageId: w.dinamo.id,
        kind: 'mechanic',
        name: 'Elena Stan',
        phone: '+40722000111',
        tokenHash: randomUUID(),
      },
    });

    const res = await members(w.dinamo.id, bearer(w.mihai, 'garage'));

    expect(res.body.invites).toEqual([
      {
        email: null,
        id: sent.id,
        kind: 'mechanic',
        phone: '+40722000111',
        sentAt: sent.createdAt.toISOString(),
      },
    ]);
  });

  it('drops an invite once it is revoked, accepted or past its expiry', async () => {
    const w = await world();
    const open = await invite(w.dinamo.id, 'elena@example.test');
    const read = async () =>
      (await members(w.dinamo.id, bearer(w.mihai, 'garage'))).body.invites
        .length;
    expect(await read()).toBe(1);

    for (const data of [
      { status: 'revoked' as const },
      { status: 'accepted' as const },
      { expiresAt: new Date(Date.now() - 1000), status: 'sent' as const },
    ]) {
      await prisma.staffInvite.update({ data, where: { id: open.id } });
      expect(await read()).toBe(0);
      await prisma.staffInvite.update({
        data: { expiresAt: new Date(Date.now() + DAY), status: 'sent' },
        where: { id: open.id },
      });
      expect(await read()).toBe(1);
    }
  });

  it('accepts an upper-case garage id', async () => {
    const w = await world();

    const res = await members(
      w.dinamo.id.toUpperCase(),
      bearer(w.mihai, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(5);
  });

  it('writes nothing: no audit entry and no event', async () => {
    const w = await world();
    await invite(w.dinamo.id, 'elena@example.test');
    const before = [
      await prisma.activityLog.count(),
      await prisma.outboxEvent.count(),
    ];

    await members(w.dinamo.id, bearer(w.mihai, 'garage'));
    await members(w.dinamo.id, bearer(w.ioana, 'receptionist'));
    await members(w.dinamo.id, bearer(w.radu, 'garage'));

    expect([
      await prisma.activityLog.count(),
      await prisma.outboxEvent.count(),
    ]).toEqual(before);
  });
});

// @traces 102-FR-012
describe('who may read who has access', () => {
  it.each([
    ['a receptionist', 'ioana', 'receptionist'],
    ['a mechanic who may answer quotes', 'vlad', 'mechanic'],
    ['a mechanic with the other permissions', 'sorin', 'mechanic'],
  ] as const)(
    'answers %s of the garage 403 forbidden',
    async (_, who, role) => {
      const w = await world();

      const res = await members(w.dinamo.id, bearer(w[who], role));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
      expect(res.body).not.toHaveProperty('members');
    },
  );

  it.each([
    ["another garage's owner", 'radu', 'garage'],
    ['a driver', 'driver', 'driver'],
    ['an admin', 'admin', 'admin'],
  ] as const)('answers %s 404 not_found', async (_, who, role) => {
    const w = await world();

    const res = await members(w.dinamo.id, bearer(w[who], role));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 404 for a garage that does not exist', async () => {
    const w = await world();

    const res = await members(randomUUID(), bearer(w.mihai, 'garage'));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 400 for a garage id that is not a uuid', async () => {
    const w = await world();

    const res = await members('not-a-uuid', bearer(w.mihai, 'garage'));

    expect(res.status).toBe(400);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const w = await world();

    const res = await members(w.dinamo.id);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers the owner whatever the team switch says', async () => {
    const w = await world();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: w.dinamo.id, key: 'team_mechanics' },
    });

    const res = await members(w.dinamo.id, bearer(w.mihai, 'garage'));

    expect(res.status).toBe(200);
  });
});

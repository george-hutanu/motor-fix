// @traces 097-FR-005 097-FR-006
import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import type { Role } from './capabilities';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';
import { AuditService } from '../audit/audit.service';
import { noEvents, outbox } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const prisma = createPrisma(databaseUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule.register({ databaseUrl, redisUrl, tokenSecret })],
  }).compile();
  app = moduleRef.createNestApplication();
  // The API's own pipe (apps/api/src/bootstrap.ts).
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

async function account(name: string, roles: Role[]) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `${name}-${randomUUID()}` },
    name,
    roles,
  });
  return id;
}

const me = (accountId: string, role: Role) =>
  request(app.getHttpServer())
    .get('/me')
    .set(
      'Authorization',
      `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`,
    );

// Atelier Test (draft) with its owner, a receptionist and a mechanic.
async function garage() {
  const atelier = await prisma.garage.create({
    data: { name: 'Atelier Test', slug: `test-${randomUUID()}` },
  });
  const owner = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: atelier.id, role: 'owner' },
  });
  const receptionist = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: {
      accountId: receptionist,
      garageId: atelier.id,
      role: 'receptionist',
    },
  });
  const mechanic = await account('vlad', ['mechanic']);
  await prisma.mechanic.create({
    data: {
      accountId: mechanic,
      canAnswerQuotes: true,
      garageId: atelier.id,
      name: 'Vlad',
    },
  });
  return { atelier, mechanic, owner, receptionist };
}

const ALL = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

describe('who am I, at the garages I work at', () => {
  it('lists the owner’s garage with its name, status, role, permissions and features', async () => {
    const { atelier, owner } = await garage();

    const res = await me(owner, 'garage');

    expect(res.status).toBe(200);
    expect(res.body.garageId).toBe(atelier.id);
    expect(res.body.garageAccess).toEqual([
      {
        features: {},
        garageId: atelier.id,
        name: 'Atelier Test',
        permissions: ALL,
        role: 'owner',
        status: 'draft',
      },
    ]);
  });

  it('maps each feature row of the garage to its key, on or off', async () => {
    const { atelier, owner } = await garage();
    await prisma.garageFeature.createMany({
      data: [
        { enabled: false, garageId: atelier.id, key: 'team_mechanics' },
        { enabled: true, garageId: atelier.id, key: 'whatsapp' },
      ],
    });

    const res = await me(owner, 'garage');

    expect(res.body.garageAccess[0].features).toEqual({
      team_mechanics: false,
      whatsapp: true,
    });
  });

  it('carries the garage’s status as it changes', async () => {
    const { atelier, owner } = await garage();
    await prisma.garage.update({
      data: { status: 'approved' },
      where: { id: atelier.id },
    });

    const res = await me(owner, 'garage');

    expect(res.body.garageAccess[0].status).toBe('approved');
  });

  it('gives a receptionist every permission at their garage', async () => {
    const { atelier, receptionist } = await garage();

    const res = await me(receptionist, 'receptionist');

    expect(res.body.garageAccess).toEqual([
      expect.objectContaining({
        garageId: atelier.id,
        permissions: ALL,
        role: 'receptionist',
      }),
    ]);
  });

  it('gives a mechanic the permissions of their card', async () => {
    const { atelier, mechanic } = await garage();

    const res = await me(mechanic, 'mechanic');

    expect(res.body.garageAccess).toEqual([
      {
        features: {},
        garageId: atelier.id,
        name: 'Atelier Test',
        permissions: {
          canAnswerQuotes: true,
          canMoveBookings: false,
          canRecordFinalPrice: false,
        },
        role: 'mechanic',
        status: 'draft',
      },
    ]);
  });

  it('lists a garage once for a member who also has a mechanic card there, as the member', async () => {
    const { atelier, owner } = await garage();
    await prisma.mechanic.create({
      data: { accountId: owner, garageId: atelier.id, name: 'Mihai' },
    });

    const res = await me(owner, 'garage');

    expect(res.body.garageAccess).toEqual([
      expect.objectContaining({
        garageId: atelier.id,
        permissions: ALL,
        role: 'owner',
      }),
    ]);
  });

  it('answers an empty list to a driver and to a garage account with no garage', async () => {
    await garage();
    const driver = await account('andrei', ['driver']);
    const alone = await account('maria', ['garage']);

    for (const [id, role] of [
      [driver, 'driver'],
      [alone, 'garage'],
    ] as const) {
      const res = await me(id, role);
      expect(res.status).toBe(200);
      expect(res.body.garageAccess).toEqual([]);
    }
  });

  it('lists only the garages the person works at, never another one', async () => {
    const { owner } = await garage();
    const other = await prisma.garage.create({
      data: { name: 'Service Dobre', slug: `dobre-${randomUUID()}` },
    });

    const res = await me(owner, 'garage');

    expect(
      res.body.garageAccess.map((g: { garageId: string }) => g.garageId),
    ).not.toContain(other.id);
  });
});

const bearer = (accountId: string, role: Role = 'driver') =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const patch = (accountId: string | null, body: unknown) => {
  const call = request(app.getHttpServer())
    .patch('/me')
    .send(body as object);
  return accountId ? call.set('Authorization', bearer(accountId)) : call;
};

const saved = (id: string) =>
  prisma.account.findUniqueOrThrow({
    select: { city: true, name: true },
    where: { id },
  });

const entries = (id: string) =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { field: { in: ['name', 'city'] }, subjectId: id },
  });

const updates = (id: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'account.updated', subjectId: id },
  });

// @traces 139-edit-my-details-FR-004
describe('changing my name and city', () => {
  it('saves both, answers who am I, and records each field and one event', async () => {
    const id = await account('Andrei M', ['driver']);

    const res = await patch(id, { city: 'Cluj-Napoca', name: 'Andrei Marin' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      city: 'Cluj-Napoca',
      id,
      name: 'Andrei Marin',
    });
    expect(await saved(id)).toEqual({
      city: 'Cluj-Napoca',
      name: 'Andrei Marin',
    });
    const audit = await entries(id);
    expect(
      audit.map((e) => [e.field, e.action, e.oldValue, e.newValue]),
    ).toEqual([
      ['city', 'update', null, 'Cluj-Napoca'],
      ['name', 'update', 'Andrei M', 'Andrei Marin'],
    ]);
    expect(audit[0]).toMatchObject({ actorId: id, actorRole: 'driver' });
    const events = await updates(id);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      accountId: id,
      fields: ['city', 'name'],
    });
  });

  it('records only the field that changed', async () => {
    const id = await account('Andrei', ['driver']);

    await patch(id, { city: 'Iași', name: 'Andrei' });

    expect((await entries(id)).map((e) => e.field)).toEqual(['city']);
    expect((await updates(id))[0]?.payload).toEqual({
      accountId: id,
      fields: ['city'],
    });
  });

  it('writes nothing when nothing changed', async () => {
    const id = await account('Andrei', ['driver']);
    await prisma.account.update({ data: { city: 'Iași' }, where: { id } });

    const res = await patch(id, { city: ' Iași ', name: 'Andrei' });

    expect(res.status).toBe(200);
    expect(await entries(id)).toHaveLength(0);
    expect(await updates(id)).toHaveLength(0);
  });

  it('clears the city when it comes blank', async () => {
    const id = await account('Andrei', ['driver']);
    await prisma.account.update({ data: { city: 'Iași' }, where: { id } });

    const res = await patch(id, { city: '   ' });

    expect(res.status).toBe(200);
    expect(res.body.city).toBeNull();
    expect((await saved(id)).city).toBeNull();
    expect((await entries(id)).map((e) => [e.oldValue, e.newValue])).toEqual([
      ['Iași', null],
    ]);
  });

  it('changes only the caller’s own account', async () => {
    const andrei = await account('Andrei', ['driver']);
    const elena = await account('Elena', ['driver']);

    await patch(andrei, { city: 'Brașov' });

    expect((await saved(elena)).city).toBeNull();
  });

  it('marks the change as the assistant’s when a grant made it', async () => {
    const id = await account('Andrei', ['driver']);
    const service = new AccountsService(prisma, new AuditService(), outbox);
    const grant = randomUUID();
    const driver = {
      accountId: id,
      assistantGrantId: grant,
      garageId: null,
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'driver' as const,
      roles: ['driver' as const],
      via: 'assistant' as const,
    };

    await service.updateMe(driver, { city: 'Sibiu' });

    expect((await saved(id)).city).toBe('Sibiu');
    expect((await entries(id))[0]).toMatchObject({
      assistantGrantId: grant,
      viaAssistant: true,
    });
  });
});

// @traces 139-edit-my-details-FR-005
describe('a name or city that cannot be saved', () => {
  it.each([
    ['a name of 1 character', { name: 'A' }, 'name'],
    ['a name of 81 characters', { name: 'A'.repeat(81) }, 'name'],
    ['a name with a control character', { name: 'Andrei\u0007' }, 'name'],
    ['a city of 1 character', { city: 'C' }, 'city'],
    ['a city of 61 characters', { city: 'C'.repeat(61) }, 'city'],
    ['a city with a control character', { city: 'Cluj\u0000' }, 'city'],
    ['an unknown field', { city: 'Iași', phone: '+40722123456' }, 'phone'],
  ])(
    'refuses %s with 400 naming the field, and saves nothing',
    async (_, body, field) => {
      const id = await account('Andrei', ['driver']);

      const res = await patch(id, body);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain(field);
      expect(await saved(id)).toEqual({ city: null, name: 'Andrei' });
      expect(await entries(id)).toHaveLength(0);
    },
  );
});

// @traces 139-edit-my-details-FR-017
describe('who may change the details', () => {
  it('answers 401 sign_in_required with no session', async () => {
    const res = await patch(null, { city: 'Iași' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 403 account_suspended to a suspended account and saves nothing', async () => {
    const id = await account('Andrei', ['driver']);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await patch(id, { city: 'Iași' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
    expect((await saved(id)).city).toBeNull();
  });
});

// @traces 139-edit-my-details-FR-003
describe('who am I, for the details panel', () => {
  it('says no phone, no pending address and no password for a Google account', async () => {
    const id = await account('Maria', ['driver']);

    const res = await me(id, 'driver');

    expect(res.body).toMatchObject({
      hasPassword: false,
      pendingEmail: null,
      phone: null,
      phoneConfirmed: false,
    });
  });

  it('carries the phone, whether it is confirmed, and a password identity', async () => {
    const { id } = await accounts.createAccount({
      consent: CURRENT_CONSENT,
      email: `andrei-${randomUUID()}@example.test`,
      identity: {
        method: 'password',
        passwordHash: 'not-a-real-hash',
        subject: `andrei-${randomUUID()}@example.test`,
      },
      name: 'Andrei',
      phone: `+4072${Math.floor(1e7 + Math.random() * 9e7)}`,
      roles: ['driver'],
    });

    const unconfirmed = await me(id, 'driver');
    await prisma.account.update({
      data: { phoneVerifiedAt: new Date() },
      where: { id },
    });
    const confirmed = await me(id, 'driver');

    expect(unconfirmed.body).toMatchObject({
      hasPassword: true,
      phone: expect.stringMatching(/^\+4072/),
      phoneConfirmed: false,
    });
    expect(confirmed.body.phoneConfirmed).toBe(true);
  });

  it('shows the address of the latest live e-mail change only', async () => {
    const id = await account('Andrei', ['driver']);
    const token = (email: string, minutesAgo: number) =>
      prisma.accountToken.create({
        data: {
          accountId: id,
          createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
          email,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          purpose: 'email_change',
          tokenHash: randomUUID(),
        },
      });
    await token('nou@example.test', 1);
    await token('veche@example.test', 10);

    expect((await me(id, 'driver')).body.pendingEmail).toBe('nou@example.test');

    await prisma.accountToken.updateMany({
      data: { usedAt: new Date() },
      where: { accountId: id, email: 'nou@example.test' },
    });
    await prisma.accountToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { accountId: id, email: 'veche@example.test' },
    });

    expect((await me(id, 'driver')).body.pendingEmail).toBeNull();
  });

  it('never takes an e-mail confirmation link for a change', async () => {
    const id = await account('Andrei', ['driver']);
    await prisma.accountToken.create({
      data: {
        accountId: id,
        email: 'andrei@example.test',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        purpose: 'email_confirm',
        tokenHash: randomUUID(),
      },
    });

    expect((await me(id, 'driver')).body.pendingEmail).toBeNull();
  });
});

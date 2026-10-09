// @traces 097-FR-005 097-FR-006
import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import type { Role } from './capabilities';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';
import { AuditService } from '../audit/audit.service';
import { noEvents } from '../events/event.port';

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

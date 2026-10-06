import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuditService } from './audit.service';
import { signAccessToken } from '../auth/access-token';
import { AccountsService } from '../auth/accounts.service';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
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
  // The API's own pipe options (apps/api bootstrap).
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
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
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

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const get = (query: Record<string, string> = {}, auth?: string) => {
  const call = request(app.getHttpServer()).get('/audit-history').query(query);
  return auth ? call.set('Authorization', auth) : call;
};

// Service Auto Nord with an owner, a receptionist and a mechanic, and a second
// garage with its owner; one price change in each garage.
async function world() {
  const nord = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  });
  const sud = await prisma.garage.create({
    data: { name: 'Service Auto Sud', slug: `sud-${randomUUID()}` },
  });
  const ion = await account('Ion Popescu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: ion, garageId: nord.id, role: 'owner' },
  });
  const ioana = await account('Ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: nord.id, role: 'receptionist' },
  });
  const elena = await account('Elena', ['mechanic']);
  await prisma.mechanic.create({
    data: { accountId: elena, garageId: nord.id },
  });
  const mihai = await account('Mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: sud.id, role: 'owner' },
  });
  const change = (garageId: string, actorId: string) =>
    prisma.activityLog.create({
      data: {
        action: 'update',
        actorId,
        actorName: 'Ion',
        actorRole: 'owner',
        field: 'from_bani',
        garageId,
        newValue: 130000,
        oldValue: 120000,
        subjectId: randomUUID(),
        subjectType: 'garage_price',
      },
    });
  const nordPrice = await change(nord.id, ion);
  const sudPrice = await change(sud.id, mihai);
  return { elena, ioana, ion, mihai, nord, nordPrice, sud, sudPrice };
}

describe('GET /audit-history', () => {
  it('answers 401 sign_in_required without a token', async () => {
    const res = await get();

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it.each([
    ['owner', 'ion', 'garage'],
    ['receptionist', 'ioana', 'receptionist'],
    ['mechanic', 'elena', 'mechanic'],
  ] as const)('gives the %s their own garage’s page', async (_, who, role) => {
    const w = await world();

    const res = await get({}, bearer(w[who], role));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          action: 'update',
          actor: { id: w.ion, name: 'Ion', role: 'owner' },
          at: w.nordPrice.at.toISOString(),
          carId: null,
          field: 'from_bani',
          garageId: w.nord.id,
          id: w.nordPrice.id,
          internal: false,
          jobId: null,
          kind: null,
          newValue: 130000,
          oldValue: 120000,
          subjectId: w.nordPrice.subjectId,
          subjectType: 'garage_price',
          text: null,
          viaAssistant: false,
        },
      ],
      nextCursor: null,
      total: 1,
    });
  });

  it('answers 404 to another garage’s owner asking for this garage', async () => {
    const w = await world();

    const res = await get({ garageId: w.nord.id }, bearer(w.mihai, 'garage'));

    expect(res.status).toBe(404);
  });

  it('answers 404 to a driver, also one who holds the garage role', async () => {
    const w = await world();
    const andrei = await account('Andrei', ['driver']);
    await prisma.accountRole.create({
      data: { accountId: w.ion, role: 'driver' },
    });

    expect((await get({}, bearer(andrei, 'driver'))).status).toBe(404);
    expect((await get({}, bearer(w.ion, 'driver'))).status).toBe(404);
  });

  it('answers 404 to a mechanic who left the garage', async () => {
    const w = await world();
    await prisma.mechanic.delete({ where: { accountId: w.elena } });

    expect((await get({}, bearer(w.elena, 'mechanic'))).status).toBe(404);
  });

  it('lets the admin find the entry with the garage filter', async () => {
    const w = await world();
    const admin = await account('Admin', ['admin']);

    const res = await get({ garageId: w.nord.id }, bearer(admin, 'admin'));

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      w.nordPrice.id,
    ]);
  });

  it('answers 403 account_suspended before any right is checked', async () => {
    const w = await world();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: w.ion },
    });

    const res = await get({}, bearer(w.ion, 'garage'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
  });

  it.each([
    ['an unknown parameter', { limit: '100' }],
    ['a malformed garage id', { garageId: 'nord' }],
    ['a malformed person id', { actorId: '1' }],
    ['a malformed job id', { jobId: '1' }],
    ['a malformed cursor', { cursor: 'abc' }],
    ['an impossible date', { from: '2026-02-30T10:00:00Z' }],
    ['a date without a time', { from: '2026-10-01' }],
    ['a time without a zone', { to: '2026-10-01T10:00:00' }],
    ['not a date', { from: 'yesterday' }],
    ['an unknown area', { area: 'reviews' }],
  ])('answers 400 to %s', async (_, query) => {
    const w = await world();

    const res = await get(query, bearer(w.ion, 'garage'));

    expect(res.status).toBe(400);
  });

  it('accepts full date-times with a zone', async () => {
    const w = await world();

    const res = await get(
      { from: '2026-01-01T00:00:00+02:00', to: '2099-01-01T00:00:00.000Z' },
      bearer(w.ion, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('answers 400 invalid_cursor to another garage’s entry as cursor', async () => {
    const w = await world();

    const res = await get({ cursor: w.sudPrice.id }, bearer(w.ion, 'garage'));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('offers no way to change an entry', async () => {
    const w = await world();
    const http = request(app.getHttpServer());
    const entry = `/audit-history/${w.nordPrice.id}`;

    for (const call of [
      () => http.post('/audit-history'),
      () => http.patch(entry),
      () => http.delete(entry),
    ]) {
      const res = await call().set('Authorization', bearer(w.ion, 'garage'));
      expect(res.status).toBe(404);
    }
  });
});

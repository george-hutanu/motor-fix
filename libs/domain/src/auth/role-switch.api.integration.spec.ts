import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { verifyAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import type { Role } from './capabilities';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';
import { SignInService } from './sign-in.service';
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
let signIns: SignInService;

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
  signIns = moduleRef.get(SignInService);
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
    identity: { method: 'google', subject: `${name}-subject` },
    name,
    roles,
  });
  return id;
}

// The browser's session: the refresh cookie of a family just opened.
const session = async (accountId: string, role: Role = 'garage') =>
  (await signIns.openSession(accountId, role, true)).refreshToken as string;

const switchTo = (body: unknown, cookie?: string) => {
  const call = request(app.getHttpServer())
    .post('/auth/roles/switch')
    .set('Content-Type', 'application/json')
    .send(body as object);
  return cookie ? call.set('Cookie', `mf_refresh=${cookie}`) : call;
};

// The cookie the answer clears.
const CLEARED = /^mf_refresh=;.*Expires=Thu, 01 Jan 1970/;
const cleared = (res: { headers: Record<string, unknown> }) =>
  String(res.headers['set-cookie'] ?? '');

const rotated = (res: { headers: Record<string, unknown> }) =>
  String(res.headers['set-cookie'] ?? '').match(/mf_refresh=([^;]+)/)?.[1];

const lastRole = async (id: string) =>
  (await prisma.account.findUniqueOrThrow({ where: { id } })).lastRole;

const roleOf = (accessToken: string) =>
  verifyAccessToken(accessToken, tokenSecret)?.role;

async function refresh(accountId: string, body?: object) {
  const { refreshToken } = await signIns.openSession(accountId, 'garage', true);
  const call = request(app.getHttpServer())
    .post('/auth/refresh')
    .set('Cookie', `mf_refresh=${refreshToken}`);
  return body ? call.send(body) : call;
}

describe('switching my role', () => {
  it('stores the role switched to and answers a token for it', async () => {
    const id = await account('mihai', ['garage', 'driver']);

    const res = await switchTo({ role: 'driver' }, await session(id, 'garage'));

    expect(res.status).toBe(200);
    expect(roleOf(res.body.accessToken)).toBe('driver');
    expect(await lastRole(id)).toBe('driver');
  });

  it('opens the role switched to with the new token', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    const { body } = await switchTo(
      { role: 'driver' },
      await session(id, 'garage'),
    );

    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${body.accessToken}`);

    expect(me.body).toMatchObject({ landing: '/app/driver', role: 'driver' });
  });

  it('switches back with the cookie the switch rotated', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    const first = await switchTo({ role: 'driver' }, await session(id));
    const next = rotated(first);
    expect(next).toBeDefined();

    const res = await switchTo({ role: 'garage' }, next);

    expect(roleOf(res.body.accessToken)).toBe('garage');
    expect(await lastRole(id)).toBe('garage');
  });

  it('works for a mechanic who also drives', async () => {
    const id = await account('elena', ['mechanic', 'driver']);

    const res = await switchTo(
      { role: 'driver' },
      await session(id, 'mechanic'),
    );

    expect(roleOf(res.body.accessToken)).toBe('driver');
    expect(await lastRole(id)).toBe('driver');
  });

  it.each(['garage', 'admin', 'mechanic'] as const)(
    'answers 404 for %s, a role the account does not hold, and changes nothing',
    async (role) => {
      const id = await account('andrei', ['driver']);

      const res = await switchTo({ role }, await session(id, 'driver'));

      expect(res.status).toBe(404);
      expect(res.body.accessToken).toBeUndefined();
      expect(await lastRole(id)).toBe('driver');
    },
  );

  it.each([
    ['no role', {}],
    ['an unknown role', { role: 'owner' }],
    ['a role that is not text', { role: 1 }],
    ['an extra field', { accountId: 'x', role: 'driver' }],
  ])('answers 400 for %s', async (_, body) => {
    const id = await account('mihai', ['garage', 'driver']);

    const res = await switchTo(body, await session(id, 'garage'));

    expect(res.status).toBe(400);
    expect(await lastRole(id)).toBe('garage');
  });

  it('answers 401 without a signed-in account', async () => {
    const res = await switchTo({ role: 'driver' });

    expect(res.status).toBe(401);
  });

  it('answers 401 and changes nothing once this device signed out', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    const cookie = await session(id);
    await request(app.getHttpServer())
      .post('/auth/sign-out')
      .set('Cookie', `mf_refresh=${cookie}`);

    const res = await switchTo({ role: 'driver' }, cookie);

    expect(res.status).toBe(401);
    expect(cleared(res)).toMatch(CLEARED);
    expect(res.body.accessToken).toBeUndefined();
    expect(await lastRole(id)).toBe('garage');
  });

  it('answers 401 on every device once the account signed out everywhere', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    const here = await session(id);
    const elsewhere = await session(id);
    await request(app.getHttpServer())
      .post('/auth/sign-out-everywhere')
      .set('Cookie', `mf_refresh=${elsewhere}`);

    const res = await switchTo({ role: 'driver' }, here);

    expect(res.status).toBe(401);
    expect(cleared(res)).toMatch(CLEARED);
    expect(await lastRole(id)).toBe('garage');
  });

  it('refuses a request that is not JSON', async () => {
    const id = await account('mihai', ['garage', 'driver']);

    const res = await request(app.getHttpServer())
      .post('/auth/roles/switch')
      .set('Cookie', `mf_refresh=${await session(id)}`)
      .set('Content-Type', 'text/plain')
      .send('role=driver');

    expect(res.status).toBe(415);
    expect(await lastRole(id)).toBe('garage');
  });

  it('refuses a suspended account', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await switchTo({ role: 'driver' }, await session(id, 'garage'));

    expect(res.status).toBe(403);
    expect(cleared(res)).toMatch(CLEARED);
    expect(await lastRole(id)).toBe('garage');
  });

  it('switches with a cookie another tab renewed a moment ago, keeping the session', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    const cookie = await session(id);
    const renewal = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `mf_refresh=${cookie}`);
    const next = rotated(renewal);

    const res = await switchTo({ role: 'driver' }, cookie);

    expect(res.status).toBe(200);
    expect(roleOf(res.body.accessToken)).toBe('driver');
    expect(rotated(res)).toBeUndefined();
    expect(await lastRole(id)).toBe('driver');
    const later = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `mf_refresh=${next}`);
    expect(later.status).toBe(200);
  });

  it('keeps the cookie when the role is not held', async () => {
    const id = await account('andrei', ['driver']);

    const res = await switchTo({ role: 'garage' }, await session(id, 'driver'));

    expect(res.status).toBe(404);
    expect(cleared(res)).not.toMatch(CLEARED);
  });

  it('writes no audit entry', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    const before = await prisma.activityLog.count();

    await switchTo({ role: 'driver' }, await session(id, 'garage'));

    expect(await prisma.activityLog.count()).toBe(before);
  });
});

describe('renewing a tab that shows one role', () => {
  it('issues a token for the role the tab asks for when the account holds it', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    await prisma.account.update({
      data: { lastRole: 'driver' },
      where: { id },
    });

    const res = await refresh(id, { role: 'garage' });

    expect(res.status).toBe(200);
    expect(roleOf(res.body.accessToken)).toBe('garage');
    expect(await lastRole(id)).toBe('driver');
  });

  it('falls back to the role used last for a role the account does not hold', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    await prisma.account.update({
      data: { lastRole: 'driver' },
      where: { id },
    });

    const res = await refresh(id, { role: 'admin' });

    expect(res.status).toBe(200);
    expect(roleOf(res.body.accessToken)).toBe('driver');
  });

  it('issues the role used last without a body, as before', async () => {
    const id = await account('mihai', ['garage', 'driver']);
    await prisma.account.update({
      data: { lastRole: 'driver' },
      where: { id },
    });

    const res = await refresh(id);

    expect(res.status).toBe(200);
    expect(roleOf(res.body.accessToken)).toBe('driver');
  });

  it('answers 400 for a role that is not one of the five', async () => {
    const id = await account('mihai', ['garage', 'driver']);

    const res = await refresh(id, { role: 'owner' });

    expect(res.status).toBe(400);
  });
});

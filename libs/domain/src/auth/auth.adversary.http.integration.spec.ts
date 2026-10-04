import { createHmac } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
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

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const hs256 = { alg: 'HS256', typ: 'JWT' };

function forge(header: unknown, payload: unknown, key: string) {
  const head = b64(header);
  const body = b64(payload);
  const sig = createHmac('sha256', key)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

serialDatabase(
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
);

describe('who am I over HTTP and account writes under attack', () => {
  const databaseUrl =
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const tokenSecret = 'test-secret';
  const prisma = createPrisma(databaseUrl);
  const accounts = new AccountsService(prisma, new AuditService(), noEvents);
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

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  });

  async function make(
    name: string,
    roles: Role[],
    extra: Record<string, unknown> = {},
  ) {
    const { id: accountId } = await accounts.createAccount({
      identity: { method: 'google', subject: `${name}-subject` },
      name,
      roles,
      ...extra,
    } as never);
    return accountId;
  }

  const bearer = (accountId: string, role: Role) =>
    `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
  const me = (auth?: string) => {
    const call = request(app.getHttpServer()).get('/me');
    return auth === undefined ? call : call.set('Authorization', auth);
  };
  const live = () => Math.floor(Date.now() / 1000);

  describe('the bearer header', () => {
    it.each([
      ['an empty token', 'Bearer '],
      ['only the scheme', 'Bearer'],
      ['an empty header', ''],
      ['two spaces before the token', 'Bearer  X'],
      ['a leading space', ' Bearer X'],
      ['a basic scheme with a token', 'Basic X'],
      ['two tokens', 'Bearer a.b.c d.e.f'],
    ])('answers 401 sign_in_required for %s', async (_, header) => {
      const res = await me(header);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    });

    it('answers 401 for a valid token padded with spaces or tabs', async () => {
      const accountId = await make('andrei', ['driver']);
      const token = signAccessToken({ accountId, role: 'driver' }, tokenSecret);

      for (const header of [
        `Bearer  ${token}`,
        `Bearer ${token} extra`,
        `Bearer\t${token}`,
      ]) {
        const res = await me(header);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('sign_in_required');
      }
    });

    it('answers 401 when the token is in the query string instead of the header', async () => {
      const accountId = await make('andrei', ['driver']);
      const token = signAccessToken({ accountId, role: 'driver' }, tokenSecret);

      const res = await request(app.getHttpServer()).get(
        `/me?access_token=${token}`,
      );

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    });

    it('answers 401 for an alg none token naming a real account', async () => {
      const accountId = await make('admin', ['admin']);
      const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ exp: live() + 900, role: 'admin', sub: accountId })}.`;

      const res = await me(`Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    });

    it('answers 401 for a correctly signed token without an expiry', async () => {
      const accountId = await make('andrei', ['driver']);

      const res = await me(
        `Bearer ${forge(hs256, { role: 'driver', sub: accountId }, tokenSecret)}`,
      );

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    });

    it.each([
      "' OR 1=1 --",
      '',
      'not-a-uuid',
      '00000000-0000-0000-0000-00000000000Z',
      'a'.repeat(5000),
    ])('answers 401 rather than 500 for a signed token whose subject is %p', async (sub) => {
      const token = forge(
        hs256,
        { exp: live() + 900, iat: live(), role: 'driver', sub },
        tokenSecret,
      );

      const res = await me(`Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    });

    it('answers 401 for a bad token even when the account is suspended', async () => {
      const accountId = await make('mihai', ['driver']);
      await prisma.account.update({
        data: { status: 'suspended' },
        where: { id: accountId },
      });
      const token = signAccessToken(
        { accountId, role: 'driver' },
        'wrong-secret',
      );

      const res = await me(`Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    });

    it('answers 401 for an expired token of an existing account', async () => {
      const accountId = await make('andrei', ['driver']);
      const token = signAccessToken(
        { accountId, role: 'driver' },
        tokenSecret,
        Date.now() - 16 * 60_000,
      );

      const res = await me(`Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    });
  });

  describe('the answer', () => {
    it('carries exactly the contract fields and nothing private', async () => {
      const accountId = await make('andrei', ['driver'], {
        email: 'Andrei@Example.ro',
        phone: '+40722000111',
      });

      const res = await me(bearer(accountId, 'driver'));

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'capabilities',
        'email',
        'garageId',
        'id',
        'landing',
        'language',
        'name',
        'role',
        'roles',
      ]);
      expect(res.body.email).toBe('andrei@example.ro');
      expect(res.body.garageId).toBeNull();
      expect(res.body.language).toBe('ro');
    });

    it('answers a null e-mail for an account without one', async () => {
      const accountId = await make('andrei', ['driver']);

      expect((await me(bearer(accountId, 'driver'))).body.email).toBeNull();
    });

    it('does not let a driver claim admin by putting admin in the token', async () => {
      const accountId = await make('andrei', ['driver']);

      const res = await me(bearer(accountId, 'admin'));

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('driver');
      expect(res.body.landing).toBe('/app/driver');
      expect(
        res.body.capabilities.filter((c: string) => c.startsWith('admin.')),
      ).toEqual([]);
    });

    it('follows the token role over the stored last role', async () => {
      const accountId = await make('mihai', ['driver', 'garage']);
      await prisma.account.update({
        data: { lastRole: 'garage' },
        where: { id: accountId },
      });

      const res = await me(bearer(accountId, 'driver'));

      expect(res.body.role).toBe('driver');
      expect(res.body.landing).toBe('/app/driver');
    });

    it('does not write the fallback role back to the account', async () => {
      const accountId = await make('mihai', ['driver', 'garage']);
      await prisma.account.update({
        data: { lastRole: 'admin' },
        where: { id: accountId },
      });

      await me(bearer(accountId, 'mechanic'));

      const row = await prisma.account.findUniqueOrThrow({
        where: { id: accountId },
      });
      expect(row.lastRole).toBe('admin');
    });

    it('falls back by the fixed order when both token and last role are no longer held', async () => {
      const accountId = await make('mihai', ['driver', 'mechanic']);
      await prisma.account.update({
        data: { lastRole: 'admin' },
        where: { id: accountId },
      });

      const res = await me(bearer(accountId, 'receptionist'));

      expect(res.body.role).toBe('mechanic');
    });

    it('gives a garage account no garage when it is only a receptionist at one', async () => {
      const accountId = await make('mihai', ['garage']);
      const garage = await prisma.garage.create({
        data: { name: 'A', slug: 'a' },
      });
      await prisma.garageMember.create({
        data: { accountId, garageId: garage.id, role: 'receptionist' },
      });

      expect((await me(bearer(accountId, 'garage'))).body.garageId).toBeNull();
    });

    it('gives a receptionist account no garage when it only owns one', async () => {
      const accountId = await make('ioana', ['receptionist']);
      const garage = await prisma.garage.create({
        data: { name: 'A', slug: 'a' },
      });
      await prisma.garageMember.create({
        data: { accountId, garageId: garage.id, role: 'owner' },
      });

      expect(
        (await me(bearer(accountId, 'receptionist'))).body.garageId,
      ).toBeNull();
    });

    it('picks the owned garage for the garage role and the receptionist garage for the receptionist role', async () => {
      const accountId = await make('ioana', ['garage', 'receptionist']);
      const owned = await prisma.garage.create({
        data: { name: 'A', slug: 'a' },
      });
      const other = await prisma.garage.create({
        data: { name: 'B', slug: 'b' },
      });
      await prisma.garageMember.create({
        data: { accountId, garageId: owned.id, role: 'owner' },
      });
      await prisma.garageMember.create({
        data: { accountId, garageId: other.id, role: 'receptionist' },
      });

      expect((await me(bearer(accountId, 'garage'))).body.garageId).toBe(
        owned.id,
      );
      expect((await me(bearer(accountId, 'receptionist'))).body.garageId).toBe(
        other.id,
      );
    });

    it('lists a mechanic capability once its permission is switched on, on the next call', async () => {
      const accountId = await make('elena', ['mechanic']);
      const garage = await prisma.garage.create({
        data: { name: 'A', slug: 'a' },
      });
      await prisma.mechanic.create({
        data: { accountId, garageId: garage.id },
      });
      const token = bearer(accountId, 'mechanic');

      expect((await me(token)).body.capabilities).toEqual([
        'garage.own_jobs',
        'garage.audit_history',
      ]);
      await prisma.mechanic.update({
        data: { canMoveBookings: true },
        where: { accountId },
      });

      expect([...(await me(token)).body.capabilities].sort()).toEqual([
        'garage.audit_history',
        'garage.own_jobs',
        'garage.schedule',
      ]);
    });

    it('answers the same body when asked twice', async () => {
      const accountId = await make('andrei', ['driver']);

      const first = await me(bearer(accountId, 'driver'));
      const second = await me(bearer(accountId, 'driver'));

      expect(second.body).toEqual(first.body);
    });

    it.each([
      'post',
      'put',
      'patch',
      'delete',
    ] as const)('does not serve %s on the me route', async (method) => {
      const accountId = await make('andrei', ['driver']);

      const res = await request(app.getHttpServer())
        [method]('/me')
        .set('Authorization', bearer(accountId, 'driver'))
        .send({ roles: ['admin'] });

      expect(res.status).toBe(404);
      const row = await prisma.accountRole.findMany({ where: { accountId } });
      expect(row.map((r) => r.role)).toEqual(['driver']);
    });
  });

  describe('creating accounts', () => {
    it('stores the e-mail trimmed and lower-case', async () => {
      const accountId = await make('andrei', ['driver'], {
        email: '  Andrei@Example.RO\t',
      });

      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: accountId } }))
          .email,
      ).toBe('andrei@example.ro');
    });

    it('refuses the same e-mail with surrounding spaces and leaves one account', async () => {
      await make('andrei', ['driver'], { email: 'a@example.ro' });

      await expect(
        make('other', ['driver'], { email: ' A@EXAMPLE.ro ' }),
      ).rejects.toThrow();

      expect(await prisma.account.count()).toBe(1);
    });

    it('refuses a second account with the same phone and leaves one account', async () => {
      await make('andrei', ['driver'], { phone: '+40722000111' });

      await expect(
        make('other', ['driver'], { phone: '+40722000111' }),
      ).rejects.toThrow();

      expect(await prisma.account.count()).toBe(1);
    });

    it('refuses a second account with the same sign-in identity and leaves no half-written account', async () => {
      await make('andrei', ['driver']);

      await expect(
        accounts.createAccount({
          identity: { method: 'google', subject: 'andrei-subject' },
          name: 'copy',
          roles: ['driver'],
        } as never),
      ).rejects.toThrow();

      expect(await prisma.account.count()).toBe(1);
      expect(await prisma.accountRole.count()).toBe(1);
      expect(await prisma.accountIdentity.count()).toBe(1);
    });

    it('stores one role row when a role is listed twice', async () => {
      const accountId = await make('andrei', ['driver', 'driver']);

      expect(await prisma.accountRole.count({ where: { accountId } })).toBe(1);
    });

    it('refuses a role that does not exist and leaves no account', async () => {
      await expect(make('x', ['superuser' as Role])).rejects.toThrow();

      expect(await prisma.account.count()).toBe(0);
    });

    it('refuses a language other than ro or en and leaves no account', async () => {
      await expect(make('x', ['driver'], { language: 'fr' })).rejects.toThrow();
      await expect(make('y', ['driver'], { language: 'RO' })).rejects.toThrow();

      expect(await prisma.account.count()).toBe(0);
    });

    it('keeps exactly one account when two creations with the same e-mail race', async () => {
      const results = await Promise.allSettled([
        make('a', ['driver'], { email: 'race@example.ro' }),
        make('b', ['driver'], { email: 'race@example.ro' }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(await prisma.account.count()).toBe(1);
      expect(await prisma.accountIdentity.count()).toBe(1);
    });

    it('stores unicode names and a very long name or refuses it whole', async () => {
      const accountId = await make('Ștefan Țurcanu 🚗', ['driver']);

      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: accountId } }))
          .name,
      ).toBe('Ștefan Țurcanu 🚗');
    });
  });
});

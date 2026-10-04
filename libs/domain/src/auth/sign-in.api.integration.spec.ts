import { createHash } from 'node:crypto';

import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { verifyAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import type { Role } from './capabilities';
import { MAINTENANCE } from './maintenance';
import * as password from './password';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';
import { AuditService } from '../audit/audit.service';
import { noEvents } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const PASSWORD = 'parola-de-test';
const prisma = createPrisma(databaseUrl);
const redis = new Redis(redisUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let maintenance = false;
let hash: string;

async function start(redisAt = redisUrl) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl: redisAt, tokenSecret }),
    ],
  })
    .overrideProvider(MAINTENANCE)
    .useValue({ on: async () => maintenance })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  nest.set('trust proxy', 'loopback');
  nest.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await nest.init();
  return nest;
}

let app: NestExpressApplication;

beforeAll(async () => {
  hash = await password.hashPassword(PASSWORD);
  app = await start();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  maintenance = false;
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  const keys = await redis.keys('auth:fail:*');
  if (keys.length) await redis.del(...keys);
  jest.restoreAllMocks();
});

let addresses = 0;
// Each test signs in from its own address, so the per-address count of one
// test never reaches another.
const address = () => `203.0.113.${++addresses % 250}`;

async function person(
  email: string,
  roles: Role[],
  {
    lastRole,
    withPassword = true,
  }: { lastRole?: Role; withPassword?: boolean } = {},
) {
  const { id } = await accounts.createAccount({
    email,
    identity: withPassword
      ? { method: 'password', passwordHash: hash, subject: email }
      : { method: 'google', subject: `${email}-google` },
    name: email.split('@')[0] ?? 'x',
    roles,
  });
  if (lastRole) {
    await prisma.account.update({ data: { lastRole }, where: { id } });
  }
  return id;
}

const signIn = (
  body: Record<string, unknown>,
  from = address(),
  server = app,
) =>
  request(server.getHttpServer())
    .post('/auth/sign-in')
    .set('X-Forwarded-For', from)
    .send(body);

const refresh = (cookie?: string) => {
  const call = request(app.getHttpServer()).post('/auth/refresh');
  return cookie ? call.set('Cookie', `mf_refresh=${cookie}`) : call;
};

const signOut = (cookie?: string) => {
  const call = request(app.getHttpServer()).post('/auth/sign-out');
  return cookie ? call.set('Cookie', `mf_refresh=${cookie}`) : call;
};

function setCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith('mf_refresh='));
}

const cookieValue = (res: request.Response) =>
  setCookie(res)?.split(';')[0]?.slice('mf_refresh='.length) ?? '';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('base64url');

const claims = (res: request.Response) =>
  verifyAccessToken(res.body.accessToken, tokenSecret);

describe('signing in with the right e-mail and password', () => {
  it('answers an access token for the account and sets the refresh cookie', async () => {
    const id = await person('andrei@example.test', ['driver']);

    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['accessToken']);
    expect(claims(res)).toEqual({ accountId: id, role: 'driver' });
    const cookie = setCookie(res) ?? '';
    expect(cookie).toMatch(/^mf_refresh=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=2592000');
  });

  it('stores only the hash of the refresh token, in a new family that remembers the device', async () => {
    const id = await person('andrei@example.test', ['driver']);

    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });

    const rows = await prisma.refreshToken.findMany({
      where: { accountId: id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(sha256(cookieValue(res)));
    expect(rows[0]?.tokenHash).not.toBe(cookieValue(res));
    expect(rows[0]?.remember).toBe(true);
    expect(rows[0]?.usedAt).toBeNull();
    const days =
      ((rows[0]?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('opens a new family at every sign-in', async () => {
    const id = await person('andrei@example.test', ['driver']);

    await signIn({ email: 'andrei@example.test', password: PASSWORD });
    await signIn({ email: 'andrei@example.test', password: PASSWORD });

    const rows = await prisma.refreshToken.findMany({
      where: { accountId: id },
    });
    expect(new Set(rows.map((r) => r.familyId)).size).toBe(2);
  });

  it('without "keep me signed in", sets a browser-session cookie the server accepts for 12 hours', async () => {
    const id = await person('andrei@example.test', ['driver']);

    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
      remember: false,
    });

    expect(res.status).toBe(200);
    expect(setCookie(res)).not.toMatch(/Max-Age|Expires/);
    const row = await prisma.refreshToken.findFirstOrThrow({
      where: { accountId: id },
    });
    expect(row.remember).toBe(false);
    const hours = (row.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
  });

  it('trims the e-mail and compares it without letter case', async () => {
    await person('andrei@example.test', ['driver']);

    const res = await signIn({
      email: '  Andrei@Example.TEST ',
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
  });

  it('records when the account was last active', async () => {
    const id = await person('andrei@example.test', ['driver']);
    const before = Date.now();

    await signIn({ email: 'andrei@example.test', password: PASSWORD });

    const { lastActiveAt } = await prisma.account.findUniqueOrThrow({
      where: { id },
    });
    expect(lastActiveAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it.each([
    ['a driver', ['driver'], undefined, 'driver', '/app/driver'],
    ['a garage owner', ['garage'], undefined, 'garage', '/app/garage'],
    [
      'a receptionist',
      ['receptionist'],
      undefined,
      'receptionist',
      '/app/garage',
    ],
    ['a mechanic', ['mechanic'], undefined, 'mechanic', '/app/garage'],
    ['an admin', ['admin'], undefined, 'admin', '/app/admin'],
    [
      'a driver and garage who used the garage last',
      ['driver', 'garage'],
      'garage',
      'garage',
      '/app/garage',
    ],
  ] as const)('gives %s a token for the role in use, which lands on its dashboard', async (_, roles, lastRole, role, landing) => {
    await person('p@example.test', [...roles], { lastRole });

    const res = await signIn({ email: 'p@example.test', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(claims(res)?.role).toBe(role);
    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.body.landing).toBe(landing);
  });
});

describe('signing in with credentials that do not match', () => {
  async function answers() {
    await person('andrei@example.test', ['driver']);
    await person('google@example.test', ['driver'], { withPassword: false });
    const gone = await person('gone@example.test', ['driver']);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: gone },
    });
    return Promise.all([
      signIn({ email: 'andrei@example.test', password: 'wrong-password' }),
      signIn({ email: 'nobody@example.test', password: PASSWORD }),
      signIn({ email: 'google@example.test', password: PASSWORD }),
      signIn({ email: 'gone@example.test', password: PASSWORD }),
    ]);
  }

  it('answers the same 401 invalid_credentials for a wrong password, an unknown e-mail, no password and a deleted account', async () => {
    const results = await answers();

    for (const res of results) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('invalid_credentials');
      expect(res.body).toEqual(results[0]?.body);
      expect(setCookie(res)).toBeUndefined();
    }
  });

  it('runs the password check in every one of those cases', async () => {
    const check = jest.spyOn(password, 'verifyPassword');

    await answers();

    expect(check).toHaveBeenCalledTimes(4);
    expect(check).toHaveBeenCalledWith(PASSWORD, password.DECOY_HASH);
  });

  it('refuses a suspended account with the right password as suspended, and with a wrong one as not matching', async () => {
    const id = await person('mihai@example.test', ['garage']);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const right = await signIn({
      email: 'mihai@example.test',
      password: PASSWORD,
    });
    const wrong = await signIn({
      email: 'mihai@example.test',
      password: 'wrong-password',
    });

    expect(right.status).toBe(403);
    expect(right.body.code).toBe('account_suspended');
    expect(setCookie(right)).toBeUndefined();
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('invalid_credentials');
  });

  it('logs a failed attempt with its reason and no e-mail, password or address', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          lines.push(JSON.stringify(args));
        });
    }
    await person('andrei@example.test', ['driver']);

    await signIn(
      { email: 'andrei@example.test', password: 'secret-typo' },
      '198.51.100.7',
    );

    const all = lines.join('\n');
    expect(all).toContain('invalid_credentials');
    expect(all).not.toMatch(/andrei|secret-typo|198\.51\.100\.7/i);
  });
});

describe('attempt limits', () => {
  const failures = async (email: string, n: number, from = address()) => {
    for (let i = 0; i < n; i++) {
      await signIn({ email, password: `wrong-${i}` }, from);
    }
  };

  it('refuses the sixth attempt for one e-mail within 15 minutes, even with the right password', async () => {
    await person('andrei@example.test', ['driver']);
    await failures('andrei@example.test', 5);

    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_attempts');
    expect(setCookie(res)).toBeUndefined();
  });

  it('counts per e-mail across addresses, and leaves other e-mails alone', async () => {
    await person('andrei@example.test', ['driver']);
    await person('elena@example.test', ['driver']);
    for (let i = 0; i < 5; i++) {
      await signIn({ email: 'andrei@example.test', password: 'x' }, address());
    }

    expect(
      (await signIn({ email: 'andrei@example.test', password: PASSWORD }))
        .status,
    ).toBe(429);
    expect(
      (await signIn({ email: 'elena@example.test', password: PASSWORD }))
        .status,
    ).toBe(200);
  });

  it('keeps the counter in Redis under a hash of the e-mail, for 15 minutes from the last failure', async () => {
    await failures('Andrei@Example.test', 3);

    const keys = await redis.keys('auth:fail:email:*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toMatch(/andrei/i);
    expect(Number(await redis.get(keys[0] ?? ''))).toBe(3);
    const ttl = await redis.ttl(keys[0] ?? '');
    expect(ttl).toBeGreaterThan(890);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it('does not count a refused attempt, so retrying cannot keep the lock forever', async () => {
    await person('andrei@example.test', ['driver']);
    await failures('andrei@example.test', 5);
    const [key] = await redis.keys('auth:fail:email:*');
    await redis.expire(key ?? '', 100);

    await signIn({ email: 'andrei@example.test', password: 'again' });

    expect(Number(await redis.get(key ?? ''))).toBe(5);
    expect(await redis.ttl(key ?? '')).toBeLessThanOrEqual(100);
  });

  it('clears the e-mail count at a successful sign-in', async () => {
    await person('andrei@example.test', ['driver']);
    await failures('andrei@example.test', 4);

    expect(
      (await signIn({ email: 'andrei@example.test', password: PASSWORD }))
        .status,
    ).toBe(200);
    await failures('andrei@example.test', 4);
    expect(
      (await signIn({ email: 'andrei@example.test', password: PASSWORD }))
        .status,
    ).toBe(200);
  });

  it('refuses an address after 20 failures, for any e-mail, and leaves other addresses alone', async () => {
    await person('andrei@example.test', ['driver']);
    const from = '192.0.2.50';
    for (let i = 0; i < 20; i++) {
      await signIn({ email: `guess-${i}@example.test`, password: 'x' }, from);
    }

    const blocked = await signIn(
      { email: 'andrei@example.test', password: PASSWORD },
      from,
    );
    const other = await signIn(
      { email: 'andrei@example.test', password: PASSWORD },
      '192.0.2.51',
    );

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('too_many_attempts');
    expect(other.status).toBe(200);
  });

  it('reads the address from the right of X-Forwarded-For behind a trusted hop', async () => {
    await person('andrei@example.test', ['driver']);
    for (let i = 0; i < 20; i++) {
      await signIn(
        { email: `guess-${i}@example.test`, password: 'x' },
        `10.9.9.${i}, 192.0.2.60`,
      );
    }

    const res = await signIn(
      { email: 'andrei@example.test', password: PASSWORD },
      '192.0.2.60',
    );

    expect(res.status).toBe(429);
  });

  it('neither counts nor clears a suspended, a maintenance or an invalid attempt', async () => {
    const id = await person('mihai@example.test', ['garage']);
    await failures('mihai@example.test', 2);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });
    await signIn({ email: 'mihai@example.test', password: PASSWORD });
    await prisma.account.update({ data: { status: 'active' }, where: { id } });
    maintenance = true;
    await signIn({ email: 'mihai@example.test', password: PASSWORD });
    maintenance = false;
    await signIn({ email: 'mihai@example.test' });

    const [key] = await redis.keys('auth:fail:email:*');
    expect(Number(await redis.get(key ?? ''))).toBe(2);
  });

  it('still signs in when Redis cannot be reached', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await person('andrei@example.test', ['driver']);
    const offline = await start('redis://127.0.0.1:1');

    try {
      const wrong = await signIn(
        { email: 'andrei@example.test', password: 'x' },
        address(),
        offline,
      );
      const right = await signIn(
        { email: 'andrei@example.test', password: PASSWORD },
        address(),
        offline,
      );

      expect(wrong.status).toBe(401);
      expect(right.status).toBe(200);
    } finally {
      await offline.close();
    }
  }, 20_000);
});

describe('maintenance mode', () => {
  it.each([
    ['a driver', 'driver'],
    ['a garage owner', 'garage'],
    ['a receptionist', 'receptionist'],
    ['a mechanic', 'mechanic'],
  ] as const)('refuses %s with the right password', async (_, role) => {
    await person('p@example.test', [role]);
    maintenance = true;

    const res = await signIn({ email: 'p@example.test', password: PASSWORD });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('maintenance');
    expect(setCookie(res)).toBeUndefined();
  });

  it('lets an admin sign in, also one who used another role last', async () => {
    await person('a@example.test', ['driver', 'admin'], { lastRole: 'driver' });
    maintenance = true;

    const res = await signIn({ email: 'a@example.test', password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it('still answers invalid_credentials for a wrong password', async () => {
    await person('p@example.test', ['driver']);
    maintenance = true;

    const res = await signIn({ email: 'p@example.test', password: 'x' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_credentials');
  });
});

describe('the sign-in request', () => {
  it.each([
    ['no e-mail', { password: PASSWORD }],
    ['no password', { email: 'a@example.test' }],
    ['an empty password', { email: 'a@example.test', password: '' }],
    ['an empty e-mail', { email: '   ', password: PASSWORD }],
    ['a number for the e-mail', { email: 42, password: PASSWORD }],
    [
      'an object for the password',
      { email: 'a@example.test', password: { $ne: '' } },
    ],
    [
      'a text for remember',
      { email: 'a@example.test', password: PASSWORD, remember: 'yes' },
    ],
    [
      'an unknown field',
      { email: 'a@example.test', password: PASSWORD, role: 'admin' },
    ],
    [
      'a password over 1024 characters',
      { email: 'a@example.test', password: 'x'.repeat(1025) },
    ],
  ])('answers 400 for %s', async (_, body) => {
    const res = await signIn(body);

    expect(res.status).toBe(400);
  });
});

describe('renewing with the refresh token', () => {
  async function signedIn(remember = true) {
    const id = await person('andrei@example.test', ['driver', 'garage'], {
      lastRole: 'garage',
    });
    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
      remember,
    });
    return { cookie: cookieValue(res), id };
  }

  it('rotates the token: a new access token, a new cookie, the old row used, the family kept', async () => {
    const { cookie, id } = await signedIn();

    const res = await refresh(cookie);

    expect(res.status).toBe(200);
    expect(claims(res)).toEqual({ accountId: id, role: 'garage' });
    const next = cookieValue(res);
    expect(next).not.toBe(cookie);
    expect(setCookie(res)).toContain('Max-Age=2592000');
    const rows = await prisma.refreshToken.findMany({
      orderBy: { createdAt: 'asc' },
      where: { accountId: id },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.usedAt).not.toBeNull();
    expect(rows[1]?.tokenHash).toBe(sha256(next));
    expect(rows[1]?.familyId).toBe(rows[0]?.familyId);
    expect(rows[1]?.remember).toBe(true);
  });

  it('keeps a browser-session family a browser-session family', async () => {
    const { cookie, id } = await signedIn(false);

    const res = await refresh(cookie);

    expect(res.status).toBe(200);
    expect(setCookie(res)).not.toMatch(/Max-Age|Expires/);
    const latest = await prisma.refreshToken.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      where: { accountId: id },
    });
    expect(latest.remember).toBe(false);
  });

  it('gives a second tab presenting the just-rotated token an access token, no new cookie, and keeps the family', async () => {
    const { cookie, id } = await signedIn();
    const first = await refresh(cookie);

    const second = await refresh(cookie);

    expect(second.status).toBe(200);
    expect(claims(second)?.accountId).toBe(id);
    expect(setCookie(second)).toBeUndefined();
    expect((await refresh(cookieValue(first))).status).toBe(200);
  });

  it('closes the whole family when a used token comes back after the grace', async () => {
    const { cookie, id } = await signedIn();
    const first = await refresh(cookie);
    await prisma.refreshToken.updateMany({
      data: { usedAt: new Date(Date.now() - 30_000) },
      where: { tokenHash: sha256(cookie) },
    });

    const replay = await refresh(cookie);

    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('sign_in_required');
    expect(setCookie(replay)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
    expect((await refresh(cookieValue(first))).status).toBe(401);
  });

  it.each([
    ['no cookie', undefined],
    ['an unknown token', 'A'.repeat(43)],
    ['a malformed token', 'not a token;'],
  ])('answers 401 sign_in_required and clears the cookie for %s', async (_, cookie) => {
    const res = await refresh(cookie);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
    expect(setCookie(res)).toMatch(/^mf_refresh=;.*Path=\/api\/v1\/auth/);
  });

  it('answers 401 for an expired token', async () => {
    const { cookie } = await signedIn();
    await prisma.refreshToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await refresh(cookie)).status).toBe(401);
  });

  it('refuses a suspended account with 403 and closes its family', async () => {
    const { cookie, id } = await signedIn();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await refresh(cookie);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
    expect(setCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
  });

  it.each([
    ['a deleted account', { status: 'deleted' as const }],
  ])('answers 401 and closes the family for %s', async (_, data) => {
    const { cookie, id } = await signedIn();
    await prisma.account.update({ data, where: { id } });

    const res = await refresh(cookie);

    expect(res.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
  });

  it('answers 401 and closes the family for an account holding no role', async () => {
    const { cookie, id } = await signedIn();
    await prisma.accountRole.deleteMany({ where: { accountId: id } });

    const res = await refresh(cookie);

    expect(res.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
  });

  it('updates the last active time at most once an hour', async () => {
    const { cookie, id } = await signedIn();
    const recent = new Date(Date.now() - 10 * 60_000);
    await prisma.account.update({
      data: { lastActiveAt: recent },
      where: { id },
    });

    const first = await refresh(cookie);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id } })).lastActiveAt,
    ).toEqual(recent);

    const old = new Date(Date.now() - 2 * 3_600_000);
    await prisma.account.update({ data: { lastActiveAt: old }, where: { id } });
    await refresh(cookieValue(first));
    const after = await prisma.account.findUniqueOrThrow({ where: { id } });
    expect(after.lastActiveAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('signing out', () => {
  it('closes the family, clears the cookie and answers 204', async () => {
    const id = await person('andrei@example.test', ['driver']);
    const cookie = cookieValue(
      await signIn({ email: 'andrei@example.test', password: PASSWORD }),
    );

    const res = await signOut(cookie);

    expect(res.status).toBe(204);
    expect(setCookie(res)).toMatch(/^mf_refresh=;.*Expires=Thu, 01 Jan 1970/);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
    expect((await refresh(cookie)).status).toBe(401);
  });

  it('leaves the account signed in on another device', async () => {
    await person('andrei@example.test', ['driver']);
    const phone = cookieValue(
      await signIn({ email: 'andrei@example.test', password: PASSWORD }),
    );
    const laptop = cookieValue(
      await signIn({ email: 'andrei@example.test', password: PASSWORD }),
    );

    await signOut(phone);

    expect((await refresh(laptop)).status).toBe(200);
  });

  it.each([
    ['no cookie', undefined],
    ['an unknown token', 'A'.repeat(43)],
  ])('answers 204 for %s, and twice in a row', async (_, cookie) => {
    expect((await signOut(cookie)).status).toBe(204);
    expect((await signOut(cookie)).status).toBe(204);
  });
});

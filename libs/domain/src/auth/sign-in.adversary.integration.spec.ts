import { CURRENT_CONSENT } from '@motor-fix/contracts';
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
let app: NestExpressApplication;

beforeAll(async () => {
  hash = await password.hashPassword(PASSWORD);
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule.register({ databaseUrl, redisUrl, tokenSecret })],
  })
    .overrideProvider(MAINTENANCE)
    .useValue({ on: async () => maintenance })
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 'loopback');
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
const address = () =>
  `198.18.${Math.floor(addresses / 250)}.${++addresses % 250}`;

async function person(
  email: string,
  roles: Role[] = ['driver'],
  { lastRole, pass = hash }: { lastRole?: Role; pass?: string } = {},
) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    email,
    identity: { method: 'password', passwordHash: pass, subject: email },
    name: 'Test',
    roles,
  });
  if (lastRole) {
    await prisma.account.update({ data: { lastRole }, where: { id } });
  }
  return id;
}

const signIn = (body: unknown, from = address()) =>
  request(app.getHttpServer())
    .post('/auth/sign-in')
    .set('X-Forwarded-For', from)
    .send(body as object);

const withCookie = (path: string, cookie?: string) => {
  const call = request(app.getHttpServer()).post(path);
  return cookie === undefined ? call : call.set('Cookie', cookie);
};
const refresh = (value?: string) =>
  withCookie('/auth/refresh', value ? `mf_refresh=${value}` : undefined);
const signOut = (value?: string) =>
  withCookie('/auth/sign-out', value ? `mf_refresh=${value}` : undefined);

function setCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith('mf_refresh='));
}
const cookieValue = (res: request.Response) =>
  setCookie(res)?.split(';')[0]?.slice('mf_refresh='.length) ?? '';
const claims = (res: request.Response) =>
  verifyAccessToken(res.body.accessToken, tokenSecret);

async function login(email = 'andrei@example.test') {
  const res = await signIn({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return cookieValue(res);
}

async function wrongInOrder(email: string, from: string, n: number) {
  for (let i = 0; i < n; i++) {
    await signIn({ email, password: `wrong-${i}` }, from);
  }
}

describe('reading the refresh cookie', () => {
  it('finds the token among other cookies', async () => {
    await person('andrei@example.test');
    const token = await login();

    const res = await withCookie(
      '/auth/refresh',
      `theme=dark; mf_refresh=${token}; lang=ro`,
    );

    expect(res.status).toBe(200);
  });

  it('tolerates spaces around the cookie pair', async () => {
    await person('andrei@example.test');
    const token = await login();

    const res = await withCookie('/auth/refresh', `  mf_refresh=${token}  `);

    expect(res.status).toBe(200);
  });

  it('does not take a cookie whose name only ends with mf_refresh', async () => {
    await person('andrei@example.test');
    const token = await login();

    const res = await withCookie('/auth/refresh', `x_mf_refresh=${token}`);

    expect(res.status).toBe(401);
  });

  it('never answers a server error for two mf_refresh cookies, and a garbage one cannot revoke the real family', async () => {
    const id = await person('andrei@example.test');
    const token = await login();

    const res = await withCookie(
      '/auth/refresh',
      `mf_refresh=${'Z'.repeat(43)}; mf_refresh=${token}`,
    );

    expect([200, 401]).toContain(res.status);
    expect(
      await prisma.refreshToken.count({ where: { accountId: id } }),
    ).toBeGreaterThan(0);
  });

  it.each([
    ['a broken percent escape', 'mf_refresh=%E0%A4%A'],
    ['a quoted value', 'mf_refresh="abc"'],
    ['an empty value', 'mf_refresh='],
    ['a name without a value', 'mf_refresh'],
    ['a 5000-character value', `mf_refresh=${'a'.repeat(5000)}`],
  ])(
    'answers 401 sign_in_required and clears the cookie for %s',
    async (_, cookie) => {
      const res = await withCookie('/auth/refresh', cookie);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
      expect(setCookie(res)).toMatch(/^mf_refresh=;/);
    },
  );

  it('rejects a token with its letter case changed', async () => {
    await person('andrei@example.test');
    const token = await login();
    const swapped = [...token]
      .map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
      .join('');

    const res = await refresh(swapped);

    expect(res.status).toBe(401);
  });

  it('does not accept the access token as a refresh token, nor the refresh token as a bearer', async () => {
    await person('andrei@example.test');
    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });

    expect((await refresh(res.body.accessToken)).status).toBe(401);
    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${cookieValue(res)}`);
    expect(me.status).toBe(401);
  });
});

describe('sign-in input at its limits', () => {
  const email = (total: number) => `${'a'.repeat(total - 13)}@example.test`;

  it('treats an e-mail of 254 characters as a normal unknown e-mail', async () => {
    const res = await signIn({ email: email(254), password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_credentials');
  });

  it('measures the e-mail after trimming', async () => {
    const res = await signIn({
      email: `   ${email(254)}   `,
      password: PASSWORD,
    });

    expect(res.status).toBe(401);
  });

  it('refuses an e-mail of 255 characters with 400', async () => {
    const res = await signIn({ email: email(255), password: PASSWORD });

    expect(res.status).toBe(400);
  });

  it('accepts a password of exactly 1024 characters, and refuses one more', async () => {
    const at = await signIn({
      email: 'a@example.test',
      password: 'x'.repeat(1024),
    });
    const over = await signIn({
      email: 'a@example.test',
      password: 'x'.repeat(1025),
    });

    expect(at.status).toBe(401);
    expect(over.status).toBe(400);
  });

  it('accepts a one-character password', async () => {
    const res = await signIn({ email: 'a@example.test', password: 'x' });

    expect(res.status).toBe(401);
  });

  it('keeps spaces and unicode in a password significant', async () => {
    const odd = '  pă ssw🔑rd  ';
    await person('andrei@example.test', ['driver'], {
      pass: await password.hashPassword(odd),
    });

    const exact = await signIn({ email: 'andrei@example.test', password: odd });
    const trimmed = await signIn({
      email: 'andrei@example.test',
      password: odd.trim(),
    });

    expect(exact.status).toBe(200);
    expect(trimmed.status).toBe(401);
  });

  it.each([
    [
      'a null byte in the e-mail',
      { email: 'a\u0000@example.test', password: 'x' },
    ],
    [
      'a null byte in the password',
      { email: 'andrei@example.test', password: 'a\u0000b' },
    ],
    [
      'an unpaired surrogate in the password',
      { email: 'andrei@example.test', password: '\ud800' },
    ],
    [
      'an unpaired surrogate in the e-mail',
      { email: '\ud800@example.test', password: 'x' },
    ],
    ['a unicode e-mail', { email: 'ăndrei@exămple.test', password: 'x' }],
    [
      'a full-width e-mail',
      { email: 'ＡＮＤＲＥＩ＠example.test', password: 'x' },
    ],
  ])('does not answer a server error for %s', async (_, body) => {
    const res = await signIn(body);

    expect([400, 401]).toContain(res.status);
  });

  it('signs in an account from any casing and padding of its e-mail', async () => {
    await person('andrei@example.test');

    const results = await Promise.all(
      [
        'ANDREI@EXAMPLE.TEST',
        '\tandrei@example.test\n',
        ' AnDrEi@Example.Test',
      ].map((typed) => signIn({ email: typed, password: PASSWORD })),
    );

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a bare string', '"andrei"'],
    ['broken JSON', '{"email":'],
  ])('answers 400 for a body that is %s', async (_, raw) => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(res.status).toBe(400);
  });

  it('answers 415 for a plain-text body', async () => {
    const text = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .type('text/plain')
      .send('email=a@example.test&password=x');

    expect(text.status).toBe(415);
  });

  it('refuses a null password and a null e-mail with 400', async () => {
    const a = await signIn({ email: 'a@example.test', password: null });
    const b = await signIn({ email: null, password: 'x' });

    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });

  it('does not count a malformed request toward any limit', async () => {
    const from = '192.0.2.200';
    for (let i = 0; i < 30; i++) {
      await signIn({ email: 'a@example.test' }, from);
    }

    expect(await redis.keys('auth:fail:*')).toEqual([]);
  });

  it('keeps remember true when the field is left out or true', async () => {
    await person('andrei@example.test');
    const omitted = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });
    const explicit = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
      remember: true,
    });

    expect(setCookie(omitted)).toContain('Max-Age=2592000');
    expect(setCookie(explicit)).toContain('Max-Age=2592000');
  });

  it('survives a request with no forwarded address header and a nonsense one', async () => {
    const bare = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: 'a@example.test', password: 'x' });
    const junk = await signIn(
      { email: 'a@example.test', password: 'x' },
      'not-an-address, ,,',
    );
    const v6 = await signIn(
      { email: 'a@example.test', password: 'x' },
      '2001:db8::1',
    );

    expect([bare.status, junk.status, v6.status]).toEqual([401, 401, 401]);
  });
});

describe('attempt limits at their boundaries', () => {
  it('still signs in after 4 failures for the e-mail', async () => {
    await person('andrei@example.test');
    await wrongInOrder('andrei@example.test', address(), 4);

    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
  });

  it('refuses after exactly 5 failures, and the fifth failure itself still answers 401', async () => {
    await person('andrei@example.test');
    const from = address();
    await wrongInOrder('andrei@example.test', from, 4);

    const fifth = await signIn(
      { email: 'andrei@example.test', password: 'nope' },
      from,
    );
    const sixth = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });

    expect(fifth.status).toBe(401);
    expect(sixth.status).toBe(429);
  });

  it('counts the same e-mail typed in different cases and paddings as one', async () => {
    await person('andrei@example.test');
    const variants = [
      'ANDREI@example.test',
      ' andrei@example.test',
      'Andrei@Example.Test ',
      'andrei@EXAMPLE.test',
      '\tandrei@example.test',
    ];
    for (const typed of variants) {
      await signIn({ email: typed, password: 'x' });
    }

    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });

    expect(res.status).toBe(429);
  });

  it('counts failures on an unknown e-mail the same way as on a known one', async () => {
    await wrongInOrder('nobody@example.test', address(), 5);

    const res = await signIn({
      email: 'nobody@example.test',
      password: PASSWORD,
    });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_attempts');
  });

  it('counts failures on a deleted account', async () => {
    const gone = await person('gone@example.test');
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: gone },
    });
    await wrongInOrder('gone@example.test', address(), 5);

    const res = await signIn({
      email: 'gone@example.test',
      password: PASSWORD,
    });

    expect(res.status).toBe(429);
  });

  it('answers 429 before the password check, even for a suspended account', async () => {
    const id = await person('mihai@example.test');
    await wrongInOrder('mihai@example.test', address(), 5);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });
    const check = jest.spyOn(password, 'verifyPassword');

    const res = await signIn({
      email: 'mihai@example.test',
      password: PASSWORD,
    });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_attempts');
    expect(check).not.toHaveBeenCalled();
  });

  it('answers 429 before maintenance is considered', async () => {
    await person('andrei@example.test');
    await wrongInOrder('andrei@example.test', address(), 5);
    maintenance = true;

    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });

    expect(res.status).toBe(429);
  });

  it('keeps one address open after 19 failures', async () => {
    await person('andrei@example.test');
    const from = '192.0.2.77';
    for (let i = 0; i < 19; i++) {
      await signIn({ email: `guess-${i}@example.test`, password: 'x' }, from);
    }

    const res = await signIn(
      { email: 'andrei@example.test', password: PASSWORD },
      from,
    );

    expect(res.status).toBe(200);
  });

  it('does not clear the address count at a successful sign-in', async () => {
    await person('andrei@example.test');
    const from = '192.0.2.78';
    for (let i = 0; i < 19; i++) {
      await signIn({ email: `guess-${i}@example.test`, password: 'x' }, from);
    }
    await signIn({ email: 'andrei@example.test', password: PASSWORD }, from);
    await signIn({ email: 'guess-last@example.test', password: 'x' }, from);

    const res = await signIn(
      { email: 'andrei@example.test', password: PASSWORD },
      from,
    );

    expect(res.status).toBe(429);
  });

  it('does not count attempts refused for an e-mail against the address that sent them', async () => {
    await person('andrei@example.test');
    await person('elena@example.test');
    const attacker = '192.0.2.90';
    await wrongInOrder('andrei@example.test', attacker, 5);
    for (let i = 0; i < 25; i++) {
      await signIn({ email: 'andrei@example.test', password: 'x' }, attacker);
    }

    const sameAddress = await signIn(
      { email: 'elena@example.test', password: PASSWORD },
      attacker,
    );

    expect(sameAddress.status).toBe(200);
  });

  it('does not let a forged leftmost X-Forwarded-For hop dodge the address limit', async () => {
    await person('andrei@example.test');
    for (let i = 0; i < 20; i++) {
      await signIn(
        { email: `guess-${i}@example.test`, password: 'x' },
        `203.0.113.${i}, 192.0.2.120`,
      );
    }

    const res = await signIn(
      { email: 'andrei@example.test', password: PASSWORD },
      '198.51.100.1, 192.0.2.120',
    );

    expect(res.status).toBe(429);
  });

  it('applies the limit after a burst of simultaneous wrong guesses', async () => {
    await person('andrei@example.test');
    const from = address();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        signIn({ email: 'andrei@example.test', password: `w${i}` }, from),
      ),
    );

    const res = await signIn({
      email: 'andrei@example.test',
      password: PASSWORD,
    });

    expect(res.status).toBe(429);
    const [key] = await redis.keys('auth:fail:email:*');
    expect(Number(await redis.get(key ?? ''))).toBeGreaterThanOrEqual(5);
  });

  it('never stores the e-mail or password in a Redis key or value', async () => {
    await wrongInOrder('Secret.Person@example.test', address(), 2);

    const keys = await redis.keys('auth:fail:*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toMatch(/secret|person|example/i);
      expect(String(await redis.get(key))).not.toMatch(/secret|wrong/i);
    }
  });

  it('logs no e-mail, password or address for a refused attempt or a bad request', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...a: unknown[]) => {
          lines.push(JSON.stringify(a));
        });
    }
    await person('andrei@example.test');
    const from = '198.51.100.9';
    await wrongInOrder('andrei@example.test', from, 5);
    await signIn(
      { email: 'andrei@example.test', password: 'hunter2-secret' },
      from,
    );
    await signIn({ email: 'andrei@example.test', password: 12345 }, from);

    expect(lines.join('\n')).not.toMatch(/andrei|hunter2|198\.51\.100\.9/i);
  });
});

describe('signing in twice at once', () => {
  it('opens two independent families, each with a working token', async () => {
    const id = await person('andrei@example.test');

    const [a, b] = await Promise.all([
      signIn({ email: 'andrei@example.test', password: PASSWORD }),
      signIn({ email: 'andrei@example.test', password: PASSWORD }),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(cookieValue(a)).not.toBe(cookieValue(b));
    const rows = await prisma.refreshToken.findMany({
      where: { accountId: id },
    });
    expect(new Set(rows.map((r) => r.familyId)).size).toBe(2);
    expect((await refresh(cookieValue(a))).status).toBe(200);
    expect((await refresh(cookieValue(b))).status).toBe(200);
  });
});

describe('concurrent renewals', () => {
  it('lets only one of several simultaneous renewals of one token set a cookie, and keeps one successor', async () => {
    const id = await person('andrei@example.test');
    const token = await login();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => refresh(token)),
    );

    expect(results.map((r) => r.status)).toEqual([
      200, 200, 200, 200, 200, 200,
    ]);
    expect(results.filter((r) => setCookie(r) !== undefined)).toHaveLength(1);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      2,
    );
    const winner = results.find((r) => setCookie(r) !== undefined);
    expect(
      (await refresh(cookieValue(winner as request.Response))).status,
    ).toBe(200);
  });
});

describe('families and accounts', () => {
  it("replaying one account's used token closes only its own family", async () => {
    const a = await person('andrei@example.test');
    await person('elena@example.test');
    const first = await login('andrei@example.test');
    const other = await login('elena@example.test');
    const second = await login('andrei@example.test');
    const rotated = await refresh(first);
    await prisma.refreshToken.updateMany({
      data: { usedAt: new Date(Date.now() - 60_000) },
      where: { accountId: a, usedAt: { not: null } },
    });

    const replay = await refresh(first);

    expect(replay.status).toBe(401);
    expect((await refresh(cookieValue(rotated))).status).toBe(401);
    expect((await refresh(other)).status).toBe(200);
    expect((await refresh(second)).status).toBe(200);
  });

  it('follows the role the account uses now when renewing', async () => {
    const id = await person('andrei@example.test', ['driver', 'garage'], {
      lastRole: 'driver',
    });
    const token = await login();
    await prisma.account.update({
      data: { lastRole: 'garage' },
      where: { id },
    });

    const res = await refresh(token);

    expect(claims(res)).toEqual({
      accountId: id,
      expiresAt: expect.any(Number),
      role: 'garage',
    });
  });

  it('never signs a role the account no longer holds when renewing', async () => {
    const id = await person('andrei@example.test', ['driver', 'garage'], {
      lastRole: 'garage',
    });
    const token = await login();
    await prisma.accountRole.deleteMany({
      where: { accountId: id, role: 'garage' },
    });

    const res = await refresh(token);

    expect([200, 401]).toContain(res.status);
    if (res.status === 200) expect(claims(res)?.role).toBe('driver');
  });

  it('keeps a browser-session family at 12 hours from each renewal, and a remembered one at 30 days', async () => {
    const id = await person('andrei@example.test');
    const short = cookieValue(
      await signIn({
        email: 'andrei@example.test',
        password: PASSWORD,
        remember: false,
      }),
    );
    const long = await login();
    await refresh(short);
    await refresh(long);

    const rows = await prisma.refreshToken.findMany({
      where: { accountId: id, usedAt: null },
    });

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const hours = (row.expiresAt.getTime() - Date.now()) / 3_600_000;
      if (row.remember) {
        expect(hours).toBeGreaterThan(29.9 * 24);
        expect(hours).toBeLessThanOrEqual(30 * 24);
      } else {
        expect(hours).toBeGreaterThan(11.9);
        expect(hours).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('the replay grace', () => {
  async function rotatedAgo(seconds: number) {
    const id = await person('andrei@example.test');
    const token = await login();
    const next = await refresh(token);
    await prisma.refreshToken.updateMany({
      data: { usedAt: new Date(Date.now() - seconds * 1000) },
      where: { accountId: id, usedAt: { not: null } },
    });
    return { id, next, token };
  }

  it('answers an access token, no cookie and no revocation at 19 seconds', async () => {
    const { id, next, token } = await rotatedAgo(19);

    const res = await refresh(token);

    expect(res.status).toBe(200);
    expect(setCookie(res)).toBeUndefined();
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      2,
    );
    expect((await refresh(cookieValue(next))).status).toBe(200);
  });

  it('closes the family at 21 seconds and clears the cookie', async () => {
    const { id, next, token } = await rotatedAgo(21);

    const res = await refresh(token);

    expect(res.status).toBe(401);
    expect(setCookie(res)).toMatch(/^mf_refresh=;/);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
    expect((await refresh(cookieValue(next))).status).toBe(401);
  });

  it('gives the grace replay of a suspended account a 403 and closes the family', async () => {
    const { id, next, token } = await rotatedAgo(2);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await refresh(token);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
    expect((await refresh(cookieValue(next))).status).toBe(401);
  });

  it('gives the grace replay of an expired family a 401', async () => {
    const { token } = await rotatedAgo(2);
    await prisma.refreshToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await refresh(token)).status).toBe(401);
  });

  it('never turns repeated replays inside the grace into a second live token', async () => {
    const { id, token } = await rotatedAgo(5);

    await refresh(token);
    await refresh(token);

    expect(
      await prisma.refreshToken.count({
        where: { accountId: id, usedAt: null },
      }),
    ).toBe(1);
  });
});

describe('signing out', () => {
  it('closes the family when presented with an already rotated token', async () => {
    await person('andrei@example.test');
    const old = await login();
    const next = await refresh(old);

    expect((await signOut(old)).status).toBe(204);

    expect((await refresh(cookieValue(next))).status).toBe(401);
  });

  it('closes the family when presented with the newest token, and the old one fails too', async () => {
    await person('andrei@example.test');
    const old = await login();
    const next = cookieValue(await refresh(old));

    await signOut(next);

    expect((await refresh(next)).status).toBe(401);
    expect((await refresh(old)).status).toBe(401);
  });

  it('answers 204 and clears the cookie with every flag for garbage, an expired token and other cookies', async () => {
    const id = await person('andrei@example.test');
    const expired = await login();
    await prisma.refreshToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { accountId: id },
    });

    const results = await Promise.all([
      withCookie('/auth/sign-out', 'mf_refresh=%E0%A4%A'),
      withCookie('/auth/sign-out', `mf_refresh=${expired}`),
      withCookie('/auth/sign-out', 'other=1'),
      withCookie('/auth/sign-out', `mf_refresh=${'a'.repeat(5000)}`),
    ]);

    for (const res of results) {
      expect(res.status).toBe(204);
      expect(setCookie(res)).toMatch(/^mf_refresh=;/);
      expect(setCookie(res)).toContain('Path=/api/v1/auth');
      expect(setCookie(res)).toContain('HttpOnly');
      expect(setCookie(res)).toContain('Secure');
      expect(setCookie(res)).toContain('SameSite=Strict');
      expect(setCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    }
  });

  it('leaves a device that renews at the same moment signed in', async () => {
    await person('andrei@example.test');
    const phone = await login();
    const laptop = await login();

    const [out, renewed] = await Promise.all([signOut(phone), refresh(laptop)]);

    expect(out.status).toBe(204);
    expect(renewed.status).toBe(200);
  });

  it('is harmless twice at once', async () => {
    await person('andrei@example.test');
    const token = await login();

    const results = await Promise.all([signOut(token), signOut(token)]);

    expect(results.map((r) => r.status)).toEqual([204, 204]);
  });

  it("does not close another account's family for a token that differs by one character", async () => {
    await person('andrei@example.test');
    await person('elena@example.test');
    const andrei = await login('andrei@example.test');
    const elena = await login('elena@example.test');

    await signOut(`${andrei.slice(0, -1)}${andrei.endsWith('A') ? 'B' : 'A'}`);

    expect((await refresh(andrei)).status).toBe(200);
    expect((await refresh(elena)).status).toBe(200);
  });
});

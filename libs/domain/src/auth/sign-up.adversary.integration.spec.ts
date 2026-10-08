import { createServer, type Server } from 'node:net';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { verifyAccessToken } from './access-token';
import { AuthModule } from './auth.module';
import { MAINTENANCE } from './maintenance';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const PASSWORD = 'o-parola-lunga';
const prisma = createPrisma(databaseUrl);
const redis = new Redis(redisUrl);
serialDatabase(databaseUrl);

let maintenance = false;

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
  const keys = await redis.keys('auth:*');
  if (keys.length) await redis.del(...keys);
  jest.restoreAllMocks();
});

let addresses = 0;
const address = () => `192.0.2.${++addresses % 250}`;

const body = (overrides: Record<string, unknown> = {}) => ({
  consent: CURRENT_CONSENT,
  email: 'andrei@example.test',
  language: 'ro',
  name: 'Andrei Marin',
  password: PASSWORD,
  ...overrides,
});

const signUp = (
  sent: unknown = body(),
  from: string | undefined = address(),
  server = app,
) => {
  const req = request(server.getHttpServer()).post('/auth/sign-up');
  if (from !== undefined) req.set('X-Forwarded-For', from);
  return req.send(sent as object);
};

const raw = (payload: string | Buffer, type = 'application/json') =>
  request(app.getHttpServer())
    .post('/auth/sign-up')
    .set('X-Forwarded-For', address())
    .set('Content-Type', type)
    .send(payload);

const cookies = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).filter(
    (c) => c.startsWith('mf_refresh='),
  );

const accountCount = () => prisma.account.count();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the shape of a body', () => {
  it.each([
    ['an array for the name', { name: ['Andrei'] }],
    ['an object for the name', { name: { first: 'Andrei' } }],
    ['null for the name', { name: null }],
    ['an array for the e-mail', { email: ['andrei@example.test'] }],
    ['an object for the e-mail', { email: { address: 'a@example.test' } }],
    ['null for the e-mail', { email: null }],
    ['an array for the password', { password: [PASSWORD] }],
    ['an object for the password', { password: { value: PASSWORD } }],
    ['null for the password', { password: null }],
    ['a boolean for the password', { password: true }],
    ['an array for the language', { language: ['ro'] }],
    ['null for the language', { language: null }],
    ['a language in capitals', { language: 'RO' }],
    ['a language with a trailing space', { language: 'ro ' }],
    ['an empty language', { language: '' }],
    ['an extra field set to null', { extra: null }],
  ])(
    'answers 400 for %s, with no cookie and no account',
    async (_, overrides) => {
      const res = await signUp(body(overrides));

      expect(res.status).toBe(400);
      expect(cookies(res)).toEqual([]);
      expect(await accountCount()).toBe(0);
    },
  );

  it.each([
    ['an empty object', '{}'],
    ['an empty array', '[]'],
    ['null', 'null'],
    ['a bare string', '"andrei@example.test"'],
    ['a number', '42'],
    ['broken JSON', '{"email":'],
    ['an empty body', ''],
  ])('answers 400 for %s sent as JSON, with no cookie', async (_, payload) => {
    const res = await raw(payload);

    expect(res.status).toBe(400);
    expect(cookies(res)).toEqual([]);
    expect(await accountCount()).toBe(0);
  });

  it('refuses a body with a __proto__ key and leaves Object.prototype alone', async () => {
    const res = await raw(
      `{"__proto__":{"role":"admin","admin":true},"name":"Andrei Marin","email":"andrei@example.test","password":"${PASSWORD}","language":"ro"}`,
    );

    expect(res.status).toBe(400);
    expect(await accountCount()).toBe(0);
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
    const next = await signUp();
    expect(next.status).toBe(201);
    expect(({} as Record<string, unknown>)['role']).toBeUndefined();
    expect(verifyAccessToken(next.body.accessToken, tokenSecret)?.role).toBe(
      'driver',
    );
  });

  it('refuses a body with a constructor.prototype key', async () => {
    const res = await raw(
      `{"constructor":{"prototype":{"role":"admin"}},"name":"Andrei Marin","email":"andrei@example.test","password":"${PASSWORD}","language":"ro"}`,
    );

    expect(res.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });

  it('never creates the first e-mail when a key is repeated', async () => {
    const res = await raw(
      `{"name":"Andrei Marin","email":"first@example.test","email":"second@example.test","password":"${PASSWORD}","language":"ro"}`,
    );

    expect(res.status).toBeLessThan(500);
    expect(
      await prisma.account.count({ where: { email: 'first@example.test' } }),
    ).toBe(0);
  });

  it('ignores the query string and creates a driver whatever it asks', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up?role=admin&roles=admin&status=suspended')
      .set('X-Forwarded-For', address())
      .send(body());

    expect(res.status).toBe(201);
    const account = await prisma.account.findUniqueOrThrow({
      include: { roles: true },
      where: { email: 'andrei@example.test' },
    });
    expect(account.roles.map((r) => r.role)).toEqual(['driver']);
    expect(account.status).toBe('active');
  });

  it('answers 404 to a GET of the sign-up route', async () => {
    const res = await request(app.getHttpServer()).get('/auth/sign-up');

    expect(res.status).toBe(404);
  });

  it('refuses a body of several megabytes without creating anything', async () => {
    const res = await signUp(body({ name: 'n'.repeat(5_000_000) }));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(cookies(res)).toEqual([]);
    expect(await accountCount()).toBe(0);
  });

  it('refuses a name of 90 thousand characters with 400', async () => {
    const res = await signUp(body({ name: 'n'.repeat(90_000) }));

    expect(res.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });
});

describe('text encodings', () => {
  const utf16 = () =>
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(JSON.stringify(body()), 'utf16le'),
    ]);

  it.each([
    ['UTF-16 with a byte order mark', 'application/json; charset=utf-16le'],
    ['Latin-1', 'application/json; charset=iso-8859-1'],
  ])('refuses a body declared as %s, creating nothing', async (_, type) => {
    const res = await raw(utf16(), type);

    expect([400, 415]).toContain(res.status);
    expect(cookies(res)).toEqual([]);
    expect(await accountCount()).toBe(0);
  });

  it('answers 400 to UTF-16 bytes declared as UTF-8', async () => {
    const res = await raw(utf16());

    expect(res.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });

  it('never answers 500 to a UTF-8 byte order mark before the JSON', async () => {
    const res = await raw(
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(JSON.stringify(body())),
      ]),
    );

    expect(res.status).toBeLessThan(500);
    expect(cookies(res)).toHaveLength(res.status === 201 ? 1 : 0);
  });

  it('never answers 500 to invalid UTF-8 bytes inside the name', async () => {
    const res = await raw(
      Buffer.concat([
        Buffer.from('{"name":"Andrei '),
        Buffer.from([0xff, 0xfe, 0xfa]),
        Buffer.from(
          `","email":"andrei@example.test","password":"${PASSWORD}","language":"ro"}`,
        ),
      ]),
    );

    expect(res.status).toBeLessThan(500);
  });

  it.each([
    ['name', { name: 'Andrei \ud800 Marin' }],
    ['e-mail', { email: 'andrei\ud800@example.test' }],
  ])(
    'never answers 500 to a lone surrogate in the %s',
    async (_, overrides) => {
      const res = await raw(JSON.stringify(body(overrides)));

      expect(res.status).toBeLessThan(500);
    },
  );

  it('keeps a name of accents, CJK and emoji exactly as typed', async () => {
    const name = 'Zoë Müller 田中 😀';
    await signUp(body({ name }));

    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'andrei@example.test' },
    });
    expect(account.name).toBe(name);
  });

  it('keeps markup and quotes in a name as text, and the tables intact', async () => {
    const name = `Robert'); DROP TABLE account;-- <b>x</b>`;
    const res = await signUp(body({ name }));

    expect(res.status).toBe(201);
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'andrei@example.test' },
    });
    expect(account.name).toBe(name);
    expect(await accountCount()).toBe(1);
  });

  it('stores an e-mail with a quote and a dash as one lower-case address', async () => {
    const res = await signUp(body({ email: "O'Brien--x@Example.TEST" }));

    expect(res.status).toBe(201);
    expect(
      await prisma.account.count({
        where: { email: "o'brien--x@example.test" },
      }),
    ).toBe(1);
  });
});

describe('the length and the characters of every field', () => {
  it.each([
    ['2 characters', 'Al'],
    ['80 characters', 'n'.repeat(80)],
    ['80 accented letters', 'é'.repeat(80)],
  ])('accepts a name of %s', async (_, name) => {
    expect((await signUp(body({ name }))).status).toBe(201);
  });

  it('accepts a name of 80 code points that are 160 UTF-16 units', async () => {
    const res = await signUp(body({ name: '😀'.repeat(80) }));

    expect(res.status).toBe(201);
  });

  it('refuses a name of one emoji, which is one character', async () => {
    const res = await signUp(body({ name: '😀' }));

    expect(res.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });

  it('refuses a name of 81 code points', async () => {
    const res = await signUp(body({ name: '😀'.repeat(81) }));

    expect(res.status).toBe(400);
  });

  it.each([
    ['a tab', 'Andrei\tMarin'],
    ['a line feed', 'Andrei\nMarin'],
    ['a delete character', 'Andrei\u007fMarin'],
    ['a next-line control', 'Andrei\u0085Marin'],
    ['an escape', 'Andrei\u001bMarin'],
  ])('refuses a name with %s inside', async (_, name) => {
    const res = await signUp(body({ name }));

    expect(res.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });

  it('trims a line feed and a no-break space around the name', async () => {
    const res = await signUp(body({ name: '\n Andrei Marin \t' }));

    expect(res.status).toBe(201);
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'andrei@example.test' },
    });
    expect(account.name).toBe('Andrei Marin');
  });

  it('accepts an e-mail of exactly 254 characters and refuses 255', async () => {
    const at254 = `${'a'.repeat(241)}@example.test`;
    const at255 = `${'a'.repeat(242)}@example.test`;

    const ok = await signUp(body({ email: at254 }));
    const tooLong = await signUp(body({ email: at255 }));

    expect(at254).toHaveLength(254);
    expect(ok.status).toBe(201);
    expect(tooLong.status).toBe(400);
    expect(await accountCount()).toBe(1);
  });

  it.each([
    ['no local part', '@example.test'],
    ['an empty label after the at sign', 'andrei@.test'],
    ['nothing after the last dot', 'andrei@example.'],
    ['two at signs', 'andrei@x@example.test'],
    ['a no-break space', 'an drei@example.test'],
    ['a line separator', 'an drei@example.test'],
    ['a tab inside', 'an\tdrei@example.test'],
    ['a null character', 'andrei\u0000@example.test'],
    ['a delete character', 'andrei\u007f@example.test'],
    ['a display name', 'Andrei <andrei@example.test>'],
  ])('refuses an e-mail with %s', async (_, email) => {
    const res = await signUp(body({ email }));

    expect(res.status).toBe(400);
    expect(await accountCount()).toBe(0);
  });

  it('treats an e-mail in capitals with a non-ASCII letter as the lower-case one', async () => {
    await signUp(body({ email: 'émile@example.test' }));

    const again = await signUp(body({ email: 'ÉMILE@EXAMPLE.TEST' }));

    expect(again.status).toBe(409);
    expect(await accountCount()).toBe(1);
  });

  it('treats newlines and tabs around the e-mail as spaces to trim', async () => {
    await signUp();

    const again = await signUp(
      body({ email: '\n\t Andrei@Example.Test \r\n' }),
    );

    expect(again.status).toBe(409);
    expect(await accountCount()).toBe(1);
  });
});

describe('the password rule at its edges', () => {
  it.each([
    ['128 emoji', '😀'.repeat(128), 201],
    ['129 emoji', '😀'.repeat(129), 400],
    ['1024 characters', 'x'.repeat(1024), 400],
    ['1025 characters', 'x'.repeat(1025), 400],
    ['an empty string', '', 400],
    ['8 NUL characters', '\u0000'.repeat(8), 201],
    ['mixed case of a common one', 'PassWord1', 400],
    ['a common one in capitals with digits', 'QWERTY123', 400],
  ])('answers %s with %i', async (_, password, status) => {
    const res = await signUp(body({ password }));

    expect(res.status).toBe(status);
    expect(await accountCount()).toBe(status === 201 ? 1 : 0);
  });

  it('answers weak_password and never echoes the password', async () => {
    const res = await signUp(body({ password: 'Sup3rS3' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('weak_password');
    expect(res.text).not.toContain('Sup3rS3');
  });

  it('keeps the spaces of a password: only the exact text signs in', async () => {
    const spaced = '  parola-lunga  ';
    await signUp(body({ password: spaced }));

    const exact = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('X-Forwarded-For', address())
      .send({ email: 'andrei@example.test', password: spaced });
    const trimmed = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('X-Forwarded-For', address())
      .send({ email: 'andrei@example.test', password: spaced.trim() });

    expect(exact.status).toBe(200);
    expect(trimmed.status).toBe(401);
  });

  it('signs in with a password of accents exactly as typed', async () => {
    const password = 'parolă-țară';
    await signUp(body({ password }));

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('X-Forwarded-For', address())
      .send({ email: 'andrei@example.test', password });

    expect(res.status).toBe(200);
  });

  it('holds the password nowhere in the account rows, the answer or the token', async () => {
    const res = await signUp();

    const rows = JSON.stringify(
      await prisma.account.findMany({ include: { identities: true } }),
    );
    expect(rows).not.toContain(PASSWORD);
    expect(res.text).not.toContain(PASSWORD);
    const payload = Buffer.from(
      res.body.accessToken.split('.')[1] ?? '',
      'base64url',
    ).toString();
    expect(payload).not.toContain('andrei');
    expect(payload).not.toContain(PASSWORD);
  });
});

describe('what a refusal says', () => {
  it('answers a taken e-mail with the same body whoever asks and whatever they type', async () => {
    await signUp();

    const answers = [];
    for (const overrides of [
      {},
      { email: 'ANDREI@EXAMPLE.TEST' },
      { name: 'Altcineva', password: 'alta-parola-lunga' },
      { language: 'en' },
    ]) {
      const res = await signUp(body(overrides));
      answers.push({ body: res.body, status: res.status });
    }

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]?.status).toBe(409);
    expect(JSON.stringify(answers[0]?.body)).not.toMatch(
      /andrei|marin|suspend|active|driver|garage|admin|password|[0-9a-f]{8}-[0-9a-f]{4}/i,
    );
  });

  it('echoes nothing the person typed in a body refusal', async () => {
    const res = await signUp(
      body({ email: 'not-an-address-zzq', name: 'x', password: 'qq-secret-9' }),
    );

    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(/not-an-address-zzq|qq-secret-9/);
  });

  it('answers a bad language with a body error, not weak_password, when the password is weak too', async () => {
    const res = await signUp(body({ language: 'de', password: 'scurta' }));

    expect(res.status).toBe(400);
    expect(res.body.code).not.toBe('weak_password');
  });

  it('answers a bad e-mail with a body error, not weak_password, when the password is weak too', async () => {
    const res = await signUp(body({ email: 'nope', password: 'scurta' }));

    expect(res.status).toBe(400);
    expect(res.body.code).not.toBe('weak_password');
  });

  it('sets no cookie on any refusal', async () => {
    await signUp();
    const refusals = [
      await signUp(body({ name: '' })),
      await signUp(body({ password: 'scurta' })),
      await signUp(),
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .type('form')
        .send('a=b'),
    ];
    maintenance = true;
    refusals.push(await signUp(body({ email: 'nou@example.test' })));

    expect(refusals.map((r) => r.status)).toEqual([400, 400, 409, 415, 503]);
    for (const res of refusals) expect(cookies(res)).toEqual([]);
  });
});

describe('a form post', () => {
  it.each([
    ['unrelated fields', 'a=b'],
    ['no fields', ''],
    [
      'every sign-up field',
      'name=Andrei+Marin&email=andrei%40example.test&password=o-parola-lunga&language=ro',
    ],
  ])('is refused with 415 for %s, with no cookie', async (_, fields) => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .set('X-Forwarded-For', address())
      .type('form')
      .send(fields);

    expect(res.status).toBe(415);
    expect(cookies(res)).toEqual([]);
    expect(await accountCount()).toBe(0);
  });
});

describe('the cookie and the token of a new account', () => {
  it('sets exactly one refresh cookie with every protective flag', async () => {
    const res = await signUp();

    const list = cookies(res);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/;\s*HttpOnly/i);
    expect(list[0]).toMatch(/;\s*Secure/i);
    expect(list[0]).toMatch(/;\s*SameSite=Strict/i);
    expect(list[0]).toMatch(/;\s*Path=\/api\/v1\/auth(;|$)/);
    expect(list[0]).toMatch(/;\s*Max-Age=2592000/);
    expect(list[0]).not.toMatch(/Domain=/i);
  });

  it('gives two accounts different refresh cookies, tokens and subjects', async () => {
    const one = await signUp();
    const two = await signUp(body({ email: 'maria@example.test' }));

    expect(cookies(one)[0]).not.toBe(cookies(two)[0]);
    expect(one.body.accessToken).not.toBe(two.body.accessToken);
    expect(
      verifyAccessToken(one.body.accessToken, tokenSecret)?.accountId,
    ).not.toBe(verifyAccessToken(two.body.accessToken, tokenSecret)?.accountId);
  });

  it('does not verify the access token under another secret', async () => {
    const res = await signUp();

    expect(
      verifyAccessToken(res.body.accessToken, 'another-secret'),
    ).toBeNull();
  });
});

describe('sign-ups at the same moment', () => {
  it('admits one of ten racing sign-ups for one e-mail in different spellings', async () => {
    const spellings = [
      'andrei@example.test',
      'Andrei@example.test',
      'ANDREI@EXAMPLE.TEST',
      ' andrei@example.test',
      'andrei@example.test ',
      'aNdReI@eXaMpLe.TeSt',
      '\tandrei@example.test',
      'ANDREI@example.test',
      'andrei@EXAMPLE.test',
      'Andrei@Example.Test',
    ];

    const results = await Promise.all(
      spellings.map((email) => signUp(body({ email }))),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await accountCount()).toBe(1);
    expect(
      results.filter((r) => cookies(r).length > 0 && r.status !== 201),
    ).toEqual([]);
  });
});

describe('the hourly limit', () => {
  it('admits exactly ten of twenty-five simultaneous attempts from one address', async () => {
    const from = address();

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        signUp(body({ email: `p${i}@example.test` }), from),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 429)).toHaveLength(15);
    expect(await accountCount()).toBe(10);
    for (const refused of results.filter((r) => r.status === 429)) {
      expect(refused.body.code).toBe('too_many_attempts');
      expect(cookies(refused)).toEqual([]);
    }
  });

  it('counts exactly ten refused weak passwords out of twenty simultaneous ones', async () => {
    const from = address();

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        signUp(body({ password: 'scurta' }), from),
      ),
    );

    expect(results.filter((r) => r.status === 400)).toHaveLength(10);
    expect(results.filter((r) => r.status === 429)).toHaveLength(10);
  });

  it('does not count bodies that fail the check, nor form posts', async () => {
    const from = address();
    for (let i = 0; i < 12; i++) {
      await signUp(body({ name: '' }), from);
      await request(app.getHttpServer())
        .post('/auth/sign-up')
        .set('X-Forwarded-For', from)
        .type('form')
        .send('a=b');
    }

    for (let i = 0; i < 10; i++) {
      expect((await signUp(body({ password: 'scurta' }), from)).status).toBe(
        400,
      );
    }
    expect((await signUp(body(), from)).status).toBe(429);
  });

  it('does not count attempts refused for maintenance', async () => {
    const from = address();
    maintenance = true;
    for (let i = 0; i < 10; i++) {
      expect((await signUp(body(), from)).status).toBe(503);
    }
    maintenance = false;

    expect((await signUp(body(), from)).status).toBe(201);
  });

  it('answers maintenance ahead of a bad body', async () => {
    maintenance = true;

    const res = await signUp(body({ name: '' }));

    expect(res.status).toBe(503);
  });

  it('does not extend the window with the attempts it refuses', async () => {
    const from = address();
    for (let i = 0; i < 10; i++) await signUp(body({ password: 'x' }), from);
    const [key] = await redis.keys('auth:signup:*');
    await redis.expire(key ?? '', 100);

    expect((await signUp(body(), from)).status).toBe(429);

    expect(await redis.ttl(key ?? '')).toBeLessThanOrEqual(100);
    expect(await redis.ttl(key ?? '')).toBeGreaterThan(0);
  });

  it('admits the address again once its hour has ended', async () => {
    const from = address();
    for (let i = 0; i < 10; i++) await signUp(body({ password: 'x' }), from);
    expect((await signUp(body(), from)).status).toBe(429);
    const [key] = await redis.keys('auth:signup:*');
    await redis.expire(key ?? '', 1);
    await sleep(1500);

    expect((await signUp(body(), from)).status).toBe(201);
  });

  it('gives a counter that lost its expiry a new one', async () => {
    const from = address();
    await signUp(body({ password: 'x' }), from);
    const [key] = await redis.keys('auth:signup:*');
    await redis.persist(key ?? '');
    expect(await redis.ttl(key ?? '')).toBe(-1);

    await signUp(body({ password: 'x' }), from);

    expect(await redis.ttl(key ?? '')).toBeGreaterThan(0);
  });

  it('never answers 500 when the counter holds something that is not a number', async () => {
    const from = address();
    await signUp(body({ password: 'x' }), from);
    const [key] = await redis.keys('auth:signup:*');
    await redis.set(key ?? '', 'not-a-number', 'EX', 100);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const res = await signUp(body(), from);

    expect(res.status).toBeLessThan(500);
  });

  it('keeps the limit when a leading forwarded address is made up on each request', async () => {
    const from = address();
    for (let i = 0; i < 10; i++) {
      const res = await signUp(
        body({ password: 'x' }),
        `203.0.113.${i + 1}, ${from}`,
      );
      expect(res.status).toBe(400);
    }

    const res = await signUp(body(), `203.0.113.200, ${from}`);

    expect(res.status).toBe(429);
  });

  it('shares one count between an address and its IPv4-mapped IPv6 form', async () => {
    const from = address();
    for (let i = 0; i < 5; i++) await signUp(body({ password: 'x' }), from);
    for (let i = 0; i < 5; i++) {
      await signUp(body({ password: 'x' }), `::ffff:${from}`);
    }

    expect((await signUp(body(), from)).status).toBe(429);
  });

  it('shares one count between spellings of one IPv6 address', async () => {
    for (let i = 0; i < 5; i++) {
      await signUp(body({ password: 'x' }), '2001:DB8::ABCD');
    }
    for (let i = 0; i < 5; i++) {
      await signUp(body({ password: 'x' }), '2001:db8:0:0:0:0:0:abcd');
    }

    expect((await signUp(body(), '2001:db8::abcd')).status).toBe(429);
  });

  it.each([
    ['a word', 'not-an-address'],
    ['empty entries', ', ,'],
    ['a very long chain', Array(500).fill('203.0.113.9').join(', ')],
  ])(
    'answers a sign-up forwarded from %s without a server error',
    async (_, from) => {
      const res = await signUp(body(), from);

      expect(res.status).toBeLessThan(500);
    },
  );

  it('answers a sign-up with no forwarding header at all', async () => {
    const res = await signUp(body(), undefined);

    expect(res.status).toBe(201);
  });

  it('stores no address, e-mail or name in any key or value of the counter', async () => {
    await signUp(body(), '192.0.2.251');

    const keys = await redis.keys('auth:*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toMatch(/192\.0\.2\.251|andrei|marin/i);
      expect(String(await redis.get(key))).not.toMatch(
        /192\.0\.2\.251|andrei|marin/i,
      );
    }
  });
});

describe('Redis that never answers', () => {
  let silent: Server;
  let port: number;

  beforeAll(async () => {
    silent = createServer(() => undefined);
    await new Promise<void>((resolve) =>
      silent.listen(0, '127.0.0.1', resolve),
    );
    const bound = silent.address();
    port = typeof bound === 'object' && bound ? bound.port : 0;
  });

  afterAll(() => {
    silent.close();
  });

  it('signs up within a few seconds, and logs the failure', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const hung = await start(`redis://127.0.0.1:${port}`);
    const began = Date.now();

    try {
      const res = await signUp(body(), address(), hung);

      expect(res.status).toBe(201);
      expect(Date.now() - began).toBeLessThan(6000);
      expect(JSON.stringify(warn.mock.calls)).toMatch(/Redis/);
    } finally {
      await hung.close();
    }
  }, 30_000);
});

describe('the log of refused attempts', () => {
  it('holds no name, e-mail, password or address for a bad body and a limit refusal', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          lines.push(JSON.stringify(args));
        });
    }
    const from = '192.0.2.252';

    await signUp(
      body({
        email: 'zorro@example.test',
        name: 'Zorro Quux',
        password: 'zq-secret-77',
      }),
      from,
    );
    await signUp(body({ email: 'zorro@example.test', name: '' }), from);
    await signUp(body({ email: 'zorro-bad', name: 'Zorro Quux' }), from);
    for (let i = 0; i < 10; i++) {
      await signUp(
        body({ email: 'zorro@example.test', password: 'zq-secret-77' }),
        from,
      );
    }

    expect(lines.join('\n')).not.toMatch(
      /zorro|quux|zq-secret-77|192\.0\.2\.252/i,
    );
  });
});

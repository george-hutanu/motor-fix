import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { verifyAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import { MAINTENANCE } from './maintenance';
import { verifyPassword } from './password';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';
import { AuditService } from '../audit/audit.service';
import { EVENT_PORT, type EventPort, noEvents } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const PASSWORD = 'o-parola-lunga';
const prisma = createPrisma(databaseUrl);
const redis = new Redis(redisUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let maintenance = false;
let events: EventPort = noEvents;

async function start(redisAt = redisUrl) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl: redisAt, tokenSecret }),
    ],
  })
    .overrideProvider(MAINTENANCE)
    .useValue({ on: async () => maintenance })
    .overrideProvider(EVENT_PORT)
    .useValue({ record: (tx, event) => events.record(tx, event) } as EventPort)
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
  events = noEvents;
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  const keys = await redis.keys('auth:*');
  if (keys.length) await redis.del(...keys);
  jest.restoreAllMocks();
});

let addresses = 0;
// Each test signs up from its own address, so one test's count never reaches
// another.
const address = () => `198.51.100.${++addresses % 250}`;

const body = (overrides: Record<string, unknown> = {}) => ({
  email: 'andrei@example.test',
  language: 'ro',
  name: 'Andrei Marin',
  password: PASSWORD,
  ...overrides,
});

const signUp = (
  sent: Record<string, unknown> = body(),
  from = address(),
  server = app,
) =>
  request(server.getHttpServer())
    .post('/auth/sign-up')
    .set('X-Forwarded-For', from)
    .send(sent);

function setCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith('mf_refresh='));
}

const cookieValue = (res: request.Response) =>
  setCookie(res)?.split(';')[0]?.slice('mf_refresh='.length) ?? '';

const accountCount = () => prisma.account.count();

describe('creating a driver account', () => {
  it('answers 201 with an access token for the role driver and opens a remembered session', async () => {
    const res = await signUp();

    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['accessToken']);
    const claims = verifyAccessToken(res.body.accessToken, tokenSecret);
    expect(claims?.role).toBe('driver');
    const cookie = setCookie(res) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/Max-Age=2592000/);
  });

  it('writes the account, the driver role, the password identity, the language and the last role', async () => {
    await signUp(body({ language: 'en' }));

    const account = await prisma.account.findUniqueOrThrow({
      include: { identities: true, roles: true },
      where: { email: 'andrei@example.test' },
    });
    expect(account.name).toBe('Andrei Marin');
    expect(account.language).toBe('en');
    expect(account.lastRole).toBe('driver');
    expect(account.status).toBe('active');
    expect(account.lastActiveAt).not.toBeNull();
    expect(account.roles.map((r) => r.role)).toEqual(['driver']);
    expect(account.identities).toHaveLength(1);
    const [identity] = account.identities;
    expect(identity?.method).toBe('password');
    expect(identity?.subject).toBe('andrei@example.test');
    expect(identity?.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(identity?.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, identity?.passwordHash ?? '')).toBe(
      true,
    );
  });

  it('records the audit entry, with the new account as its actor', async () => {
    await signUp();

    const { id } = await prisma.account.findUniqueOrThrow({
      where: { email: 'andrei@example.test' },
    });
    const entries = await prisma.activityLog.findMany({
      where: { subjectId: id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: id,
      actorRole: 'driver',
      subjectType: 'account',
    });
  });

  it('records account.created with the method password, and creates nothing when that fails', async () => {
    const recorded: unknown[] = [];
    events = {
      record: async (_tx, event) => {
        recorded.push(event);
      },
    };
    await signUp();
    expect(recorded).toEqual([
      expect.objectContaining({
        kind: 'account.created',
        payload: expect.objectContaining({
          method: 'password',
          roles: ['driver'],
        }),
      }),
    ]);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    events = {
      record: async () => {
        throw new Error('outbox down');
      },
    };
    const failed = await signUp(body({ email: 'maria@example.test' }));

    expect(failed.status).toBe(500);
    expect(
      await prisma.account.count({ where: { email: 'maria@example.test' } }),
    ).toBe(0);
    expect(setCookie(failed)).toBeUndefined();
  });

  it('stores the e-mail trimmed and in lower case', async () => {
    await signUp(body({ email: '  Andrei@Example.TEST ' }));

    expect(
      await prisma.account.count({ where: { email: 'andrei@example.test' } }),
    ).toBe(1);
  });

  it('trims the name', async () => {
    await signUp(body({ name: '  Andrei Marin  ' }));

    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'andrei@example.test' },
    });
    expect(account.name).toBe('Andrei Marin');
  });

  it('hands out a refresh cookie that renews like a sign-in one', async () => {
    const res = await signUp();

    const renewed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `mf_refresh=${cookieValue(res)}`);

    expect(renewed.status).toBe(200);
    expect(verifyAccessToken(renewed.body.accessToken, tokenSecret)?.role).toBe(
      'driver',
    );
  });

  it('lets the new account sign in with its password', async () => {
    await signUp();

    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('X-Forwarded-For', address())
      .send({ email: 'ANDREI@example.test', password: PASSWORD });

    expect(res.status).toBe(200);
  });
});

describe('an e-mail that already has an account', () => {
  it('answers 409 email_taken in any letter case, and creates nothing', async () => {
    await signUp();

    const again = await signUp(
      body({ email: 'ANDREI@Example.Test', name: 'Altcineva' }),
    );

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('email_taken');
    expect(setCookie(again)).toBeUndefined();
    expect(await accountCount()).toBe(1);
  });

  it('says the same for an account of another role, a suspended one and one without a password', async () => {
    const answers: unknown[] = [];
    for (const [email, roles, method] of [
      ['garage@example.test', ['garage'], 'password'],
      ['admin@example.test', ['admin'], 'password'],
      ['google@example.test', ['driver'], 'google'],
    ] as const) {
      await accounts.createAccount({
        email,
        identity: { method, subject: email },
        name: 'x',
        roles: [...roles],
      });
    }
    await accounts.createAccount({
      email: 'suspendat@example.test',
      identity: { method: 'password', subject: 'suspendat@example.test' },
      name: 'x',
      roles: ['driver'],
    });
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { email: 'suspendat@example.test' },
    });

    for (const email of [
      'garage@example.test',
      'admin@example.test',
      'google@example.test',
      'suspendat@example.test',
    ]) {
      const res = await signUp(body({ email }));
      answers.push({ body: res.body, status: res.status });
    }

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toMatchObject({
      body: { code: 'email_taken' },
      status: 409,
    });
    expect(await accountCount()).toBe(4);
  });

  it('creates one account when two sign-ups for one e-mail race', async () => {
    const [first, second] = await Promise.all([
      signUp(body({ name: 'Unu' })),
      signUp(body({ email: 'Andrei@example.test', name: 'Doi' })),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await accountCount()).toBe(1);
  });

  it('answers a weak password first, when the e-mail is also taken', async () => {
    await signUp();

    const res = await signUp(body({ password: 'scurta' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('weak_password');
  });
});

describe('the password rule', () => {
  it.each([
    ['7 characters', 'scurta7'],
    ['129 characters', 'a'.repeat(129)],
    ['7 emoji, 14 UTF-16 units', '😀'.repeat(7)],
    ['a common password', 'password1'],
    ['a common password in capitals', 'PAROLA123'],
  ])('refuses %s with weak_password on the password field, creating nothing', async (_, password) => {
    const res = await signUp(body({ password }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('weak_password');
    expect(res.body.errors).toEqual([
      { code: 'weak_password', field: 'password' },
    ]);
    expect(setCookie(res)).toBeUndefined();
    expect(await accountCount()).toBe(0);
  });

  it.each([
    ['8 characters', 'opt-chr8'],
    ['128 characters', 'b'.repeat(128)],
    ['8 emoji', '😀'.repeat(8)],
  ])('accepts %s', async (_, password) => {
    const res = await signUp(body({ password }));

    expect(res.status).toBe(201);
  });
});

describe('a body that is not a sign-up', () => {
  it.each([
    ['no name', { name: undefined }],
    ['no e-mail', { email: undefined }],
    ['no password', { password: undefined }],
    ['no language', { language: undefined }],
    ['a name of 1 character once trimmed', { name: '  A  ' }],
    ['a name of spaces', { name: '    ' }],
    ['a name of 81 characters', { name: 'n'.repeat(81) }],
    ['a name with a control character', { name: 'Andrei\u0000Marin' }],
    ['an e-mail without "@"', { email: 'andrei.example.test' }],
    ['an e-mail without a domain dot', { email: 'andrei@example' }],
    ['an e-mail with a space', { email: 'an drei@example.test' }],
    [
      'an e-mail of 255 characters',
      { email: `${'a'.repeat(242)}@example.test` },
    ],
    ['an e-mail with a control character', { email: 'andrei\n@example.test' }],
    ['a language other than ro or en', { language: 'de' }],
    ['a name that is not text', { name: 42 }],
    ['a password that is not text', { password: 12345678 }],
    ['a chosen role', { role: 'admin' }],
    ['a chosen list of roles', { roles: ['admin'] }],
    ['a chosen status', { status: 'active' }],
  ])('answers 400 for %s, creating nothing', async (_, overrides) => {
    const res = await signUp(body(overrides));

    expect(res.status).toBe(400);
    expect(setCookie(res)).toBeUndefined();
    expect(await accountCount()).toBe(0);
  });

  it('refuses a form post with 415, and a text body, never parsed, with 400; no cookie either way', async () => {
    const fields =
      'name=Andrei+Marin&email=andrei%40example.test&password=o-parola-lunga&language=ro';
    const form = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .type('form')
      .send(fields);
    const text = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(body()));

    expect(form.status).toBe(415);
    expect(text.status).toBe(400);
    for (const answer of [form, text]) {
      expect(setCookie(answer)).toBeUndefined();
    }
    expect(await accountCount()).toBe(0);
  });
});

describe('the hourly limit per address', () => {
  it('refuses the eleventh attempt from one address within the hour, before anything is checked', async () => {
    const from = address();
    await signUp(body(), from);
    for (let i = 0; i < 9; i++) {
      const taken = await signUp(body(), from);
      expect(taken.status).toBe(409);
    }

    const eleventh = await signUp(
      body({ email: 'nou@example.test', password: 'scurta' }),
      from,
    );

    expect(eleventh.status).toBe(429);
    expect(eleventh.body.code).toBe('too_many_attempts');
    expect(await accountCount()).toBe(1);
  });

  it('counts weak passwords too, but not bodies that are not a sign-up', async () => {
    const from = address();
    for (let i = 0; i < 5; i++) {
      await signUp(body({ name: '' }), from);
    }
    for (let i = 0; i < 10; i++) {
      expect((await signUp(body({ password: 'scurta' }), from)).status).toBe(
        400,
      );
    }

    expect((await signUp(body(), from)).status).toBe(429);
  });

  it('leaves other addresses alone', async () => {
    const from = address();
    for (let i = 0; i < 10; i++) {
      await signUp(body({ password: 'scurta' }), from);
    }

    expect((await signUp(body(), address())).status).toBe(201);
  });

  it('keeps the count under a hash of the address, for an hour from the first attempt', async () => {
    await signUp(body(), '198.51.100.250');

    const keys = await redis.keys('auth:signup:*');
    expect(keys).toHaveLength(1);
    const [key] = keys;
    expect(key).not.toContain('198.51.100.250');
    const ttl = await redis.ttl(key ?? '');
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);

    await signUp(body({ password: 'scurta' }), '198.51.100.250');
    expect(await redis.ttl(key ?? '')).toBeLessThanOrEqual(ttl);
    expect(Number(await redis.get(key ?? ''))).toBe(2);
  });

  it('refuses before maintenance is read', async () => {
    const from = address();
    for (let i = 0; i < 10; i++) {
      await signUp(body({ password: 'scurta' }), from);
    }
    maintenance = true;

    expect((await signUp(body(), from)).status).toBe(429);
  });

  it('still signs up when Redis cannot be reached, and says so in the log', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const offline = await start('redis://127.0.0.1:1');

    try {
      const res = await signUp(body(), address(), offline);

      expect(res.status).toBe(201);
      expect(JSON.stringify(warn.mock.calls)).toMatch(/Redis unavailable/);
    } finally {
      await offline.close();
    }
  }, 20_000);
});

describe('maintenance mode', () => {
  it('refuses sign-up with 503 maintenance and creates nothing', async () => {
    maintenance = true;

    const res = await signUp();

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('maintenance');
    expect(setCookie(res)).toBeUndefined();
    expect(await accountCount()).toBe(0);
  });
});

describe('the log', () => {
  it('holds the codes, and never the name, the e-mail, the password or the address', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          lines.push(JSON.stringify(args));
        });
    }
    const from = '198.51.100.249';

    await signUp(body(), from);
    await signUp(body(), from);
    await signUp(
      body({ email: 'maria@example.test', password: 'password1' }),
      from,
    );

    const all = lines.join('\n');
    expect(all).toContain('email_taken');
    expect(all).toContain('weak_password');
    expect(all).not.toMatch(
      /andrei|marin|maria|o-parola-lunga|password1|198\.51\.100\.249/i,
    );
  });
});

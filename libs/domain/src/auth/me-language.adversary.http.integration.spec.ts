import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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
    identity: { method: 'google', subject: `${name}-subject` },
    name,
    roles,
  });
  return id;
}

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const send = (raw: string, auth?: string, type = 'application/json') => {
  const call = request(app.getHttpServer())
    .patch('/me')
    .set('Content-Type', type)
    .send(raw);
  return auth ? call.set('Authorization', auth) : call;
};

const patch = (body: unknown, auth?: string) =>
  send(JSON.stringify(body), auth);

const savedLanguage = async (id: string) =>
  (await prisma.account.findUniqueOrThrow({ where: { id } })).language;

const entries = (id: string) =>
  prisma.activityLog.findMany({
    where: { field: 'language', subjectId: id, subjectType: 'account' },
  });

describe('PATCH /me with hostile bodies', () => {
  it.each([
    ['null', null],
    ['a string', 'en'],
    ['an array', ['en']],
    ['an array of bodies', [{ language: 'en' }]],
    ['a null language', { language: null }],
    ['a boolean language', { language: true }],
    ['an array language', { language: ['en'] }],
    ['an object language', { language: { value: 'en' } }],
    ['a padded language', { language: ' en' }],
    ['a language with a newline', { language: 'en\n' }],
    ['a language with a null byte', { language: 'en\u0000' }],
    ['a full-width language', { language: 'ｅｎ' }],
    ['an uppercase language', { language: 'EN' }],
    ['an inherited key name', { language: 'constructor' }],
    ['a very long language', { language: 'e'.repeat(100000) }],
  ])('refuses %s with 400 and changes nothing', async (_, body) => {
    const id = await account('andrei', ['driver']);

    const res = await patch(body, bearer(id, 'driver'));

    expect(res.status).toBe(400);
    expect(await savedLanguage(id)).toBe('ro');
    expect(await entries(id)).toHaveLength(0);
  });

  it.each(['id', 'name', 'email', 'roles', 'role', 'garageId', 'status'])(
    'refuses an extra %s field, names it, and changes nothing',
    async (field) => {
      const id = await account('andrei', ['driver']);

      const res = await patch(
        { language: 'en', [field]: 'x' },
        bearer(id, 'driver'),
      );

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain(field);
      expect(await savedLanguage(id)).toBe('ro');
      expect(await entries(id)).toHaveLength(0);
    },
  );

  it('answers 400, not 500, for malformed JSON', async () => {
    const id = await account('andrei', ['driver']);

    const res = await send('{"language":', bearer(id, 'driver'));

    expect(res.status).toBe(400);
    expect(await savedLanguage(id)).toBe('ro');
  });

  // Every field of PATCH /me is optional since 139-edit-my-details.
  // @traces 139-edit-my-details-FR-004
  it('takes an empty body and changes nothing', async () => {
    const id = await account('andrei', ['driver']);

    const res = await send('', bearer(id, 'driver'));

    expect(res.status).toBe(200);
    expect(await savedLanguage(id)).toBe('ro');
  });
});

describe('PATCH /me order of checks', () => {
  it('answers 401 before validation when there is no token and the body is invalid', async () => {
    const res = await patch({ language: 'fr' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 403 account_suspended before validation for a suspended account with a bad body', async () => {
    const id = await account('mihai', ['driver']);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await patch({ language: 'fr' }, bearer(id, 'driver'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
  });

  it('answers 401 for a token of an account that no longer exists', async () => {
    const id = await account('ghost', ['driver']);
    const token = bearer(id, 'driver');
    await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');

    const res = await patch({ language: 'en' }, token);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 401 for an expired token and changes nothing', async () => {
    const id = await account('andrei', ['driver']);
    const expired = signAccessToken(
      { accountId: id, role: 'driver' },
      tokenSecret,
      Date.parse('2020-01-01T00:00:00Z'),
    );

    const res = await patch({ language: 'en' }, `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
    expect(await savedLanguage(id)).toBe('ro');
  });

  it('refuses a bare token without the scheme', async () => {
    const id = await account('andrei', ['driver']);
    const token = bearer(id, 'driver').slice('Bearer '.length);

    const res = await patch({ language: 'en' }, token);

    expect(res.status).toBe(401);
    expect(await savedLanguage(id)).toBe('ro');
  });
});

describe('PATCH /me idempotency and concurrency', () => {
  it('adds one audit entry for the same change sent twice', async () => {
    const id = await account('andrei', ['driver']);

    const first = await patch({ language: 'en' }, bearer(id, 'driver'));
    const second = await patch({ language: 'en' }, bearer(id, 'driver'));

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await entries(id)).toHaveLength(1);
  });

  it('adds exactly one audit entry when the same change arrives ten times at once', async () => {
    const id = await account('andrei', ['driver']);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        patch({ language: 'en' }, bearer(id, 'driver')),
      ),
    );

    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await savedLanguage(id)).toBe('en');
    expect(await entries(id)).toHaveLength(1);
  });

  it('keeps the audit chain consistent when changes alternate concurrently', async () => {
    const id = await account('andrei', ['driver']);

    await Promise.all(
      ['en', 'ro', 'en', 'ro', 'en', 'ro'].map((language) =>
        patch({ language }, bearer(id, 'driver')),
      ),
    );

    const final = await savedLanguage(id);
    const log = await prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: { field: 'language', subjectId: id },
    });
    expect(log.at(-1)?.newValue).toBe(final);
    for (const entry of log) expect(entry.oldValue).not.toBe(entry.newValue);
  });

  it('does not change another account through a body that names its id', async () => {
    const andrei = await account('andrei', ['driver']);
    const elena = await account('elena', ['driver']);

    const res = await send(
      `{"language":"en","id":"${elena}"}`,
      bearer(andrei, 'driver'),
    );

    expect(res.status).toBe(400);
    expect(await savedLanguage(elena)).toBe('ro');
    expect(await savedLanguage(andrei)).toBe('ro');
  });
});

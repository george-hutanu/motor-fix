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

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
});

async function account(name: string, roles: Role[]) {
  const { id } = await accounts.createAccount({
    identity: { method: 'google', subject: `${name}-subject` },
    name,
    roles,
  });
  return id;
}

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const patch = (body: unknown, auth?: string) => {
  const call = request(app.getHttpServer())
    .patch('/me')
    .send(body as object);
  return auth ? call.set('Authorization', auth) : call;
};

const savedLanguage = async (id: string) =>
  (await prisma.account.findUniqueOrThrow({ where: { id } })).language;

const languageEntries = (id: string) =>
  prisma.activityLog.findMany({
    where: { field: 'language', subjectId: id, subjectType: 'account' },
  });

describe('changing my language', () => {
  it.each(['driver', 'garage', 'receptionist', 'mechanic', 'admin'] as const)(
    'saves en for a %s and answers with who am I',
    async (role) => {
      const id = await account(`ana-${role}`, [role]);

      const res = await patch({ language: 'en' }, bearer(id, role));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, language: 'en', role });
      const me = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', bearer(id, role));
      expect(me.body).toEqual(res.body);
    },
  );

  it('gives a fresh account Romanian', async () => {
    const id = await account('andrei', ['driver']);

    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', bearer(id, 'driver'));

    expect(me.body.language).toBe('ro');
  });

  it('changes back to ro', async () => {
    const id = await account('andrei', ['driver']);
    await patch({ language: 'en' }, bearer(id, 'driver'));

    const res = await patch({ language: 'ro' }, bearer(id, 'driver'));

    expect(res.body.language).toBe('ro');
    expect(await savedLanguage(id)).toBe('ro');
  });

  it.each([
    ['no header', undefined],
    ['a malformed token', 'Bearer abc.def.ghi'],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
  ])('answers 401 sign_in_required with %s', async (_, auth) => {
    const res = await patch({ language: 'en' }, auth);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 401 for a token signed with another key and changes nothing', async () => {
    const id = await account('andrei', ['driver']);
    const token = signAccessToken(
      { accountId: id, role: 'driver' },
      'other-secret',
    );

    const res = await patch({ language: 'en' }, `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(await savedLanguage(id)).toBe('ro');
  });

  it('answers 403 account_suspended for a suspended account and changes nothing', async () => {
    const id = await account('mihai', ['driver']);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await patch({ language: 'en' }, bearer(id, 'driver'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
    expect(await savedLanguage(id)).toBe('ro');
  });

  it.each([
    ['fr', { language: 'fr' }],
    ['RO', { language: 'RO' }],
    ['an empty value', { language: '' }],
    ['a number', { language: 1 }],
    ['no language', {}],
  ])('refuses %s with 400 naming language', async (_, body) => {
    const id = await account('andrei', ['driver']);

    const res = await patch(body, bearer(id, 'driver'));

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain('language');
    expect(await savedLanguage(id)).toBe('ro');
    expect(await languageEntries(id)).toHaveLength(0);
  });

  it('refuses an extra field with 400 naming it, and changes nothing', async () => {
    const id = await account('andrei', ['driver']);

    const res = await patch(
      { language: 'en', role: 'admin' },
      bearer(id, 'driver'),
    );

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain('role');
    expect(await savedLanguage(id)).toBe('ro');
  });

  it('changes only the caller’s own account', async () => {
    const andrei = await account('andrei', ['driver']);
    const elena = await account('elena', ['driver']);

    await patch({ id: elena, language: 'en' }, bearer(andrei, 'driver'));
    await patch({ language: 'en' }, bearer(andrei, 'driver'));

    expect(await savedLanguage(andrei)).toBe('en');
    expect(await savedLanguage(elena)).toBe('ro');
  });
});

describe('the audit history of a language change', () => {
  it('records one update of language from ro to en by the account in its role', async () => {
    const id = await account('mihai', ['driver', 'garage']);

    await patch({ language: 'en' }, bearer(id, 'garage'));

    const entries = await languageEntries(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: id,
      actorName: 'mihai',
      actorRole: 'owner',
      newValue: 'en',
      oldValue: 'ro',
    });
  });

  it('records nothing when the language is already the account’s', async () => {
    const id = await account('andrei', ['driver']);

    const res = await patch({ language: 'ro' }, bearer(id, 'driver'));

    expect(res.status).toBe(200);
    expect(res.body.language).toBe('ro');
    expect(await languageEntries(id)).toHaveLength(0);
  });

  it('records each change, in order', async () => {
    const id = await account('andrei', ['driver']);

    await patch({ language: 'en' }, bearer(id, 'driver'));
    await patch({ language: 'ro' }, bearer(id, 'driver'));

    const entries = await prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: { field: 'language', subjectId: id },
    });
    expect(entries.map((e) => [e.oldValue, e.newValue])).toEqual([
      ['ro', 'en'],
      ['en', 'ro'],
    ]);
  });
});

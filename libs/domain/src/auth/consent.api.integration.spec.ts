import {
  CURRENT_CONSENT,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '@motor-fix/contracts';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import { MAINTENANCE } from './maintenance';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';
import { AuditService } from '../audit/audit.service';
import { noEvents } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const prisma = createPrisma(databaseUrl);
const redis = new Redis(redisUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let app: NestExpressApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
    ],
  })
    .overrideProvider(MAINTENANCE)
    .useValue({ on: async () => false })
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

// The audit history is append-only: count from where each test starts.
let consentEntries = 0;
const countConsentEntries = () =>
  prisma.activityLog.count({ where: { field: 'consent' } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  consentEntries = await countConsentEntries();
  const keys = await redis.keys('auth:*');
  if (keys.length) await redis.del(...keys);
});

let addresses = 0;
const signUp = (overrides: Record<string, unknown> = {}) =>
  request(app.getHttpServer())
    .post('/auth/sign-up')
    .set('X-Forwarded-For', `203.0.113.${++addresses % 250}`)
    .send({
      consent: CURRENT_CONSENT,
      email: 'ioana@example.test',
      language: 'ro',
      name: 'Ioana Pop',
      password: 'o-parola-lunga',
      ...overrides,
    });

const nothingWritten = async () => {
  expect(await prisma.account.count()).toBe(0);
  expect(await prisma.accountConsent.count()).toBe(0);
  expect(await countConsentEntries()).toBe(consentEntries);
};

const refusedForConsent = (res: request.Response) => {
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({
    code: 'consent_required',
    errors: [{ code: 'consent_required', field: 'consent' }],
  });
  expect(res.headers['set-cookie']).toBeUndefined();
};

describe('consent at sign-up', () => {
  it('stores the terms and the privacy notice accepted, with versions, language and method', async () => {
    const before = new Date();
    const res = await signUp();

    expect(res.status).toBe(201);
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'ioana@example.test' },
    });
    const rows = await prisma.accountConsent.findMany({
      orderBy: { kind: 'asc' },
      where: { accountId: account.id },
    });
    expect(
      rows.map(({ kind, language, method, textVersion }) => ({
        kind,
        language,
        method,
        textVersion,
      })),
    ).toEqual([
      {
        kind: 'terms',
        language: 'ro',
        method: 'password',
        textVersion: TERMS_VERSION,
      },
      {
        kind: 'privacy_notice',
        language: 'ro',
        method: 'password',
        textVersion: PRIVACY_VERSION,
      },
    ]);
    for (const row of rows)
      expect(row.acceptedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
  });

  it('records one "consent given" entry by the new account carrying both versions', async () => {
    await signUp();

    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'ioana@example.test' },
    });
    const entries = await prisma.activityLog.findMany({
      where: { field: 'consent', subjectId: account.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: account.id,
      actorRole: 'driver',
      newValue: {
        privacyVersion: PRIVACY_VERSION,
        termsVersion: TERMS_VERSION,
      },
      subjectType: 'account',
    });
  });

  it('records the English language for a sign-up in English', async () => {
    await signUp({ language: 'en' });

    const rows = await prisma.accountConsent.findMany();
    expect(rows.map((r) => r.language)).toEqual(['en', 'en']);
  });

  it('refuses a sign-up without the consent and writes nothing', async () => {
    const res = await signUp({ consent: undefined });

    refusedForConsent(res);
    await nothingWritten();
  });

  it.each([
    [
      'an old terms version',
      { ...CURRENT_CONSENT, termsVersion: '2020-01-01' },
    ],
    [
      'an old privacy version',
      { ...CURRENT_CONSENT, privacyVersion: '2020-01-01' },
    ],
    ['empty versions', { privacyVersion: '', termsVersion: '' }],
    ['no terms version', { privacyVersion: PRIVACY_VERSION }],
    ['an empty object', {}],
  ])(
    'refuses %s with consent_required and writes nothing',
    async (_, consent) => {
      const res = await signUp({ consent });

      refusedForConsent(res);
      await nothingWritten();
    },
  );

  it('refuses a version that is not a string by validation and writes nothing', async () => {
    const res = await signUp({
      consent: { privacyVersion: 1, termsVersion: TERMS_VERSION },
    });

    expect(res.status).toBe(400);
    await nothingWritten();
  });
});

describe('consent on every path that creates an account', () => {
  const google = {
    email: 'mihai@example.test',
    identity: { method: 'google' as const, subject: 'google-sub-1' },
    language: 'en' as const,
    name: 'Mihai',
    roles: ['driver' as const],
  };

  it('refuses an account without current consent whatever the method', async () => {
    await expect(
      accounts.createAccount({
        ...google,
        consent: { privacyVersion: PRIVACY_VERSION, termsVersion: 'old' },
      }),
    ).rejects.toMatchObject({
      response: { code: 'consent_required' },
      status: 400,
    });
    await nothingWritten();
  });

  it('stores the method of the identity created', async () => {
    const { id } = await accounts.createAccount({
      ...google,
      consent: CURRENT_CONSENT,
    });

    const rows = await prisma.accountConsent.findMany({
      where: { accountId: id },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.every((r) => r.method === 'google' && r.language === 'en'),
    ).toBe(true);
  });
});

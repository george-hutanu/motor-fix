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
const nextAddress = () => `198.51.100.${++addresses % 250}`;
const signUp = (
  overrides: Record<string, unknown> = {},
  from = nextAddress(),
) =>
  request(app.getHttpServer())
    .post('/auth/sign-up')
    .set('X-Forwarded-For', from)
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

describe('sign-up consent under hostile input', () => {
  it.each([
    ['a leading space', ` ${TERMS_VERSION}`, PRIVACY_VERSION],
    ['a trailing space', TERMS_VERSION, `${PRIVACY_VERSION} `],
    ['a trailing newline', `${TERMS_VERSION}\n`, PRIVACY_VERSION],
    ['a zero-width space', `${TERMS_VERSION}​`, PRIVACY_VERSION],
    ['full-width digits', '２０２６-１０-０５', PRIVACY_VERSION],
    ['a different dash', '2026‑10‑05', PRIVACY_VERSION],
    ['the versions swapped in kind', 'terms', 'privacy'],
  ])(
    'refuses a version with %s and writes nothing',
    async (_, termsVersion, privacyVersion) => {
      const res = await signUp({ consent: { privacyVersion, termsVersion } });

      refusedForConsent(res);
      await nothingWritten();
    },
  );

  it('refuses the current version with a suffix appended', async () => {
    const res = await signUp({
      consent: {
        ...CURRENT_CONSENT,
        termsVersion: `${TERMS_VERSION}x`,
      },
    });

    refusedForConsent(res);
    await nothingWritten();
  });

  it('refuses with consent_required a version of exactly 32 characters that is not current', async () => {
    const res = await signUp({
      consent: { ...CURRENT_CONSENT, termsVersion: 'x'.repeat(32) },
    });

    refusedForConsent(res);
    await nothingWritten();
  });

  it('refuses by validation a version of 33 characters', async () => {
    const res = await signUp({
      consent: { ...CURRENT_CONSENT, termsVersion: 'x'.repeat(33) },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).not.toBe('consent_required');
    await nothingWritten();
  });

  it('refuses by validation a megabyte-long version without writing', async () => {
    const res = await signUp({
      consent: { ...CURRENT_CONSENT, privacyVersion: 'x'.repeat(100_000) },
    });

    expect(res.status).toBe(400);
    await nothingWritten();
  });

  it.each([
    ['a string', 'accepted'],
    ['the current terms version as a string', TERMS_VERSION],
    ['an array', [CURRENT_CONSENT]],
    ['an empty array', []],
    ['a number', 1],
    ['true', true],
    ['null', null],
  ])('refuses consent given as %s and writes nothing', async (_, consent) => {
    const res = await signUp({ consent });

    expect(res.status).toBe(400);
    expect(res.headers['set-cookie']).toBeUndefined();
    await nothingWritten();
  });

  it.each([
    ['an array', [TERMS_VERSION]],
    ['an object', { v: TERMS_VERSION }],
    ['null', null],
    ['a number', 20261005],
    ['true', true],
  ])('refuses a terms version given as %s', async (_, termsVersion) => {
    const res = await signUp({
      consent: { ...CURRENT_CONSENT, termsVersion },
    });

    expect(res.status).toBe(400);
    expect(res.headers['set-cookie']).toBeUndefined();
    await nothingWritten();
  });

  it('refuses an extra key under consent and writes nothing', async () => {
    const res = await signUp({
      consent: { ...CURRENT_CONSENT, accepted: true },
    });

    expect(res.status).toBe(400);
    await nothingWritten();
  });

  it('does not let a consent flag beside the object stand in for it', async () => {
    const res = await signUp({ accepted: true, consent: undefined });

    expect(res.status).toBe(400);
    await nothingWritten();
  });

  it.each([
    [
      '__proto__',
      '{"__proto__":{"termsVersion":"2026-10-05","privacyVersion":"2026-10-05"}}',
    ],
    [
      'constructor',
      '{"consent":{"constructor":{"prototype":{"termsVersion":"2026-10-05","privacyVersion":"2026-10-05"}}}}',
    ],
    [
      'a prototype key in consent',
      '{"consent":{"__proto__":{"termsVersion":"2026-10-05","privacyVersion":"2026-10-05"}}}',
    ],
  ])('does not take the current versions from %s', async (_, raw) => {
    const base = {
      email: 'ioana@example.test',
      language: 'ro',
      name: 'Ioana Pop',
      password: 'o-parola-lunga',
    };
    const merged = `{${raw.slice(1, -1)},${JSON.stringify(base).slice(1, -1)}}`;
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .set('X-Forwarded-For', nextAddress())
      .set('Content-Type', 'application/json')
      .send(merged);

    expect(res.status).toBe(400);
    expect(res.headers['set-cookie']).toBeUndefined();
    await nothingWritten();
    expect(({} as Record<string, unknown>)['termsVersion']).toBeUndefined();
  });

  it('answers consent_required before the password rule when both fail', async () => {
    const res = await signUp({ consent: undefined, password: '123' });

    refusedForConsent(res);
    await nothingWritten();
  });

  it('answers consent_required before the password rule for a stale version', async () => {
    const res = await signUp({
      consent: { ...CURRENT_CONSENT, privacyVersion: '2020-01-01' },
      password: 'password',
    });

    refusedForConsent(res);
  });

  it('answers weak_password when the consent is current and the password is weak', async () => {
    const res = await signUp({ password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('weak_password');
    await nothingWritten();
  });

  it('counts a consent refusal toward the hourly limit of the address', async () => {
    const from = '192.0.2.77';
    for (let i = 0; i < 10; i++)
      refusedForConsent(await signUp({ consent: undefined }, from));

    const res = await signUp({}, from);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_attempts');
    await nothingWritten();
  });

  it('answers too_many_attempts, not consent_required, once the limit is reached', async () => {
    const from = '192.0.2.78';
    for (let i = 0; i < 10; i++) await signUp({ consent: undefined }, from);

    const res = await signUp({ consent: undefined }, from);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_attempts');
  });

  it('does not leave consent rows when the e-mail is taken', async () => {
    expect((await signUp()).status).toBe(201);
    const rows = await prisma.accountConsent.count();
    const entries = await countConsentEntries();

    const again = await signUp({ name: 'Other' });

    expect(again.status).toBe(409);
    expect(await prisma.accountConsent.count()).toBe(rows);
    expect(await countConsentEntries()).toBe(entries);
  });

  it('stores exactly two consent rows and one audit entry when the same sign-up is sent twice', async () => {
    await signUp();
    await signUp();

    expect(await prisma.account.count()).toBe(1);
    expect(await prisma.accountConsent.count()).toBe(2);
    expect(await countConsentEntries()).toBe(consentEntries + 1);
  });

  it('creates exactly one account from simultaneous identical sign-ups', async () => {
    await Promise.all(
      Array.from({ length: 6 }, () => signUp({}, nextAddress())),
    );

    expect(await prisma.account.count()).toBe(1);
    expect(await prisma.accountConsent.count()).toBe(2);
    expect(await countConsentEntries()).toBe(consentEntries + 1);
  });

  it('records the versions stored from the current constants and nothing the caller added', async () => {
    await signUp({ language: 'en' });

    const rows = await prisma.accountConsent.findMany({
      orderBy: { kind: 'asc' },
    });
    expect(rows.map((r) => [r.kind, r.textVersion])).toEqual([
      ['terms', TERMS_VERSION],
      ['privacy_notice', PRIVACY_VERSION],
    ]);
  });
});

describe('the shared account creation under hostile consent', () => {
  const account = {
    email: 'mihai@example.test',
    identity: { method: 'apple' as const, subject: 'apple-sub-9' },
    name: 'Mihai',
    roles: ['driver' as const],
  };

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'yes'],
    ['an array', []],
    ['an empty object', {}],
    ['numbers for versions', { privacyVersion: 1, termsVersion: 1 }],
    ['empty versions', { privacyVersion: '', termsVersion: '' }],
    [
      'padded versions',
      { privacyVersion: ` ${PRIVACY_VERSION}`, termsVersion: TERMS_VERSION },
    ],
  ])('refuses %s as consent and writes nothing', async (_, consent) => {
    await expect(
      accounts.createAccount({ ...account, consent } as never),
    ).rejects.toMatchObject({
      response: { code: 'consent_required' },
      status: 400,
    });
    await nothingWritten();
  });

  it('refuses a missing consent for a phone identity too', async () => {
    await expect(
      accounts.createAccount({
        identity: { method: 'whatsapp_phone', subject: '+40712345678' },
        name: 'Ana',
        phone: '+40712345678',
        roles: ['driver'],
      } as never),
    ).rejects.toMatchObject({ response: { code: 'consent_required' } });
    await nothingWritten();
  });

  it('defaults the consent language to ro when none is passed', async () => {
    const { id } = await accounts.createAccount({
      ...account,
      consent: CURRENT_CONSENT,
    });

    const rows = await prisma.accountConsent.findMany({
      where: { accountId: id },
    });
    expect(rows.map((r) => r.language)).toEqual(['ro', 'ro']);
  });

  it('writes no consent row when the account itself cannot be created', async () => {
    await accounts.createAccount({ ...account, consent: CURRENT_CONSENT });
    const rows = await prisma.accountConsent.count();
    const entries = await countConsentEntries();

    await expect(
      accounts.createAccount({
        ...account,
        consent: CURRENT_CONSENT,
        identity: { method: 'google', subject: 'g-2' },
      }),
    ).rejects.toBeDefined();
    expect(await prisma.accountConsent.count()).toBe(rows);
    expect(await countConsentEntries()).toBe(entries);
  });
});

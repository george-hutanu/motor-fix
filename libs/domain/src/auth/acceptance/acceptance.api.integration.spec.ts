// @traces 1204-FR-004
import { randomUUID } from 'node:crypto';

import {
  CURRENT_CONSENT,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuditService } from '../../audit/audit.service';
import { noEvents } from '../../events/event.port';
import { signAccessToken } from '../access-token';
import { AccountsService } from '../accounts.service';
import { AuthModule } from '../auth.module';
import { createPrisma } from '../prisma';
import { serialDatabase } from '../serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const prisma = createPrisma(databaseUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

const IN_FORCE = {
  privacyVersion: PRIVACY_VERSION,
  termsVersion: TERMS_VERSION,
};
const OLD = '2026-10-11';

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

async function person(
  role: Role = 'driver',
  { language = 'ro' as 'ro' | 'en' } = {},
) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `${role}-${randomUUID()}` },
    language,
    name: 'Andrei',
    roles: [role],
  });
  return {
    authorization: `Bearer ${signAccessToken({ accountId: id, role }, tokenSecret)}`,
    id,
  };
}

const stale = (accountId: string, kind?: 'terms' | 'privacy_notice') =>
  prisma.accountConsent.updateMany({
    data: { textVersion: OLD },
    where: { accountId, ...(kind ? { kind } : {}) },
  });

const accept = (body: unknown, authorization?: string) => {
  const call = request(app.getHttpServer())
    .post('/me/acceptance')
    .send(body as object);
  return authorization ? call.set('Authorization', authorization) : call;
};

const rows = (accountId: string) =>
  prisma.accountConsent.findMany({
    orderBy: { acceptedAt: 'asc' },
    where: { accountId },
  });

const consentEntries = (accountId: string) =>
  prisma.activityLog.findMany({
    where: { actorId: accountId, field: 'consent', subjectId: accountId },
  });

describe('recording the acceptance of the texts in force', () => {
  it('writes one row per pending kind, keeps the earlier rows and opens the account again', async () => {
    const { authorization, id } = await person();
    await stale(id);
    const entriesBefore = (await consentEntries(id)).length;

    const res = await accept(IN_FORCE, authorization);

    expect(res.status).toBe(204);
    const after = await rows(id);
    expect(after).toHaveLength(4);
    expect(after.filter((r) => r.textVersion === OLD)).toHaveLength(2);
    expect(
      after
        .filter((r) => r.textVersion !== OLD)
        .map((r) => [r.kind, r.textVersion])
        .sort(),
    ).toEqual([
      ['privacy_notice', PRIVACY_VERSION],
      ['terms', TERMS_VERSION],
    ]);
    const entries = await consentEntries(id);
    expect(entries).toHaveLength(entriesBefore + 1);
    expect(entries.at(-1)).toMatchObject({ newValue: IN_FORCE });
    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', authorization)
      .expect(200);
  });

  it('writes a row only for the kind whose version changed', async () => {
    const { authorization, id } = await person();
    await stale(id, 'terms');

    await accept(IN_FORCE, authorization).expect(204);

    const fresh = (await rows(id)).slice(2);
    expect(fresh.map((r) => [r.kind, r.textVersion])).toEqual([
      ['terms', TERMS_VERSION],
    ]);
  });

  it("stores the account's language and its sign-in method", async () => {
    const { authorization, id } = await person('driver', { language: 'en' });
    await stale(id);

    await accept(IN_FORCE, authorization).expect(204);

    const fresh = (await rows(id)).slice(2);
    expect(fresh.map((r) => [r.language, r.method])).toEqual([
      ['en', 'google'],
      ['en', 'google'],
    ]);
  });

  it('writes a row for an account that held no acceptance at all', async () => {
    const { authorization, id } = await person();
    await prisma.accountConsent.deleteMany({ where: { accountId: id } });

    await accept(IN_FORCE, authorization).expect(204);

    expect((await rows(id)).map((r) => r.kind).sort()).toEqual([
      'privacy_notice',
      'terms',
    ]);
  });

  it('answers 204 and writes nothing when nothing is pending', async () => {
    const { authorization, id } = await person();
    const entriesBefore = (await consentEntries(id)).length;

    await accept(IN_FORCE, authorization).expect(204);

    expect(await rows(id)).toHaveLength(2);
    expect(await consentEntries(id)).toHaveLength(entriesBefore);
  });

  it.each([
    ['older terms', { ...IN_FORCE, termsVersion: OLD }],
    ['an older privacy notice', { ...IN_FORCE, privacyVersion: OLD }],
  ])(
    'refuses %s with 400 consent_required naming the versions in force, and writes nothing',
    async (_, body) => {
      const { authorization, id } = await person();
      await stale(id);

      const res = await accept(body, authorization);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'consent_required', ...IN_FORCE });
      expect(await rows(id)).toHaveLength(2);
    },
  );

  it.each([
    ['no versions', {}],
    ['a version that is not text', { ...IN_FORCE, termsVersion: 12 }],
    ['an over-long version', { ...IN_FORCE, termsVersion: 'x'.repeat(33) }],
  ])('refuses %s as a validation failure', async (_, body) => {
    const { authorization, id } = await person();
    await stale(id);

    const res = await accept(body, authorization);

    expect(res.status).toBe(400);
    expect(res.body.code).not.toBe('consent_required');
    expect(await rows(id)).toHaveLength(2);
  });

  it('asks a visitor to sign in', async () => {
    const res = await accept(IN_FORCE);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('still tells a suspended account so', async () => {
    const { authorization, id } = await person();
    await stale(id);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await accept(IN_FORCE, authorization);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'account_suspended' });
  });

  it('records a second acceptance from another tab as another row', async () => {
    const { authorization, id } = await person();
    await stale(id);

    await Promise.all([
      accept(IN_FORCE, authorization).expect(204),
      accept(IN_FORCE, authorization).expect(204),
    ]);

    expect((await rows(id)).length).toBeGreaterThanOrEqual(4);
  });
});

// @traces 1204-FR-002
describe('who am I for a pending account', () => {
  it('is refused with consent_required until the acceptance is recorded', async () => {
    const { authorization, id } = await person('garage');
    await stale(id);
    const me = () =>
      request(app.getHttpServer())
        .get('/me')
        .set('Authorization', authorization);

    const refused = await me();
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      code: 'consent_required',
      ...IN_FORCE,
    });

    await accept(IN_FORCE, authorization).expect(204);
    await me().expect(200);
  });
});

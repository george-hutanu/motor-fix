import { randomUUID } from 'node:crypto';

import {
  ANALYTICS_CONSENT_VERSION,
  CURRENT_CONSENT,
} from '@motor-fix/contracts';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuditService } from '../../audit/audit.service';
import { noEvents } from '../../events/event.port';
import { signAccessToken } from '../access-token';
import { AccountsService } from '../accounts.service';
import { AuthModule } from '../auth.module';
import type { Role } from '../capabilities';
import { MAINTENANCE } from '../maintenance';
import { createPrisma } from '../prisma';
import { serialDatabase } from '../serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const prisma = createPrisma(databaseUrl);
const redis = new Redis(redisUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule.register({ databaseUrl, redisUrl, tokenSecret })],
  })
    .overrideProvider(MAINTENANCE)
    .useValue({ on: async () => false })
    .compile();
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
  redis.disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, consent_record CASCADE');
  const keys = await redis.keys('consents:*');
  if (keys.length) await redis.del(...keys);
});

const account = async (roles: Role[] = ['driver']) =>
  (
    await accounts.createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: randomUUID() },
      name: 'Ioana Pop',
      roles,
    })
  ).id;

const bearer = (accountId: string, role: Role = 'driver') =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const choice = (overrides: Record<string, unknown> = {}) => ({
  at: new Date().toISOString(),
  browserConsentId: randomUUID(),
  decision: 'granted',
  language: 'ro',
  textVersion: ANALYTICS_CONSENT_VERSION,
  ...overrides,
});

const post = (path: string, body: object, auth?: string) => {
  const call = request(app.getHttpServer()).post(path).send(body);
  return auth ? call.set('Authorization', auth) : call;
};

// @traces 244-FR-009
describe('POST /consents', () => {
  it('stores a visitor choice with no session and answers only its id', async () => {
    const res = await post('/consents', choice());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String) });
    expect(await prisma.consentRecord.count()).toBe(1);
  });

  it('files a choice sent with a session under no account', async () => {
    const id = await account();

    await post('/consents', choice(), bearer(id)).expect(201);

    const [row] = await prisma.consentRecord.findMany();
    expect(row?.accountId).toBeNull();
  });

  it.each([
    ['an older text version', { textVersion: '2025-01-01' }],
    ['an unknown decision', { decision: 'maybe' }],
    ['an account in the body', { accountId: randomUUID() }],
  ])('refuses %s', async (_, overrides) => {
    const res = await post('/consents', choice(overrides));

    expect(res.status).toBe(400);
    expect(await prisma.consentRecord.count()).toBe(0);
  });
});

// @traces 244-FR-010
describe('POST /me/consents', () => {
  it('asks a visitor to sign in', async () => {
    const res = await post('/me/consents', choice());

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
    expect(await prisma.consentRecord.count()).toBe(0);
  });

  it('files the choice on the account of the session', async () => {
    const id = await account();

    const res = await post('/me/consents', choice(), bearer(id));

    expect(res.status).toBe(201);
    const [row] = await prisma.consentRecord.findMany();
    expect(row?.accountId).toBe(id);
  });

  it('never files a choice on an account named in the body, even for an admin', async () => {
    const admin = await account(['admin']);
    const other = await account();

    const res = await post(
      '/me/consents',
      choice({ accountId: other }),
      bearer(admin, 'admin'),
    );

    expect(res.status).toBe(400);
    expect(
      await prisma.consentRecord.count({ where: { accountId: other } }),
    ).toBe(0);
  });
});

// @traces 244-FR-011
describe('GET /me/consents', () => {
  it('asks a visitor to sign in', async () => {
    const res = await request(app.getHttpServer()).get('/me/consents');

    expect(res.status).toBe(401);
  });

  it('answers the latest analytics choice and the accepted texts', async () => {
    const id = await account();
    const at = '2026-10-10T09:00:00.000Z';
    await post(
      '/me/consents',
      choice({ at, decision: 'refused', language: 'en' }),
      bearer(id),
    ).expect(201);

    const res = await request(app.getHttpServer())
      .get('/me/consents')
      .set('Authorization', bearer(id));

    expect(res.status).toBe(200);
    expect(res.body.analytics).toEqual({
      at,
      decision: 'refused',
      language: 'en',
      textVersion: ANALYTICS_CONSENT_VERSION,
    });
    expect(
      res.body.accepted.map((a: { kind: string }) => a.kind).sort(),
    ).toEqual(['privacy_notice', 'terms']);
  });
});

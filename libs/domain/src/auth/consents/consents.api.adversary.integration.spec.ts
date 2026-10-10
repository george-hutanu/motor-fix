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

const get = (auth: string) =>
  request(app.getHttpServer()).get('/me/consents').set('Authorization', auth);

const minutesFromNow = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

// @traces 244-FR-009
describe('the clock tolerance', () => {
  it('accepts a time 4 minutes ahead', async () => {
    await post('/consents', choice({ at: minutesFromNow(4) })).expect(201);
  });

  it('refuses a time 6 minutes ahead with consent_time_ahead and writes nothing', async () => {
    const res = await post('/consents', choice({ at: minutesFromNow(6) }));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'consent_time_ahead' });
    expect(await prisma.consentRecord.count()).toBe(0);
  });

  it('refuses a time a year ahead on the signed-in route too', async () => {
    const id = await account();

    const res = await post(
      '/me/consents',
      choice({ at: minutesFromNow(60 * 24 * 365) }),
      bearer(id),
    );

    expect(res.status).toBe(400);
    expect(await prisma.consentRecord.count()).toBe(0);
  });

  it('keeps the choice own time when it is days in the past', async () => {
    const at = '2020-01-01T00:00:00.000Z';

    await post('/consents', choice({ at })).expect(201);

    const [row] = await prisma.consentRecord.findMany();
    expect(row?.at.toISOString()).toBe(at);
  });

  it('keeps a time given with an offset as the same instant', async () => {
    await post(
      '/consents',
      choice({ at: '2026-10-10T12:30:00.000+03:00' }),
    ).expect(201);

    const [row] = await prisma.consentRecord.findMany();
    expect(row?.at.toISOString()).toBe('2026-10-10T09:30:00.000Z');
  });
});

// @traces 244-FR-008
describe('the table is append-only', () => {
  it('stores the same body twice as two rows', async () => {
    const body = choice();

    const first = await post('/consents', body);
    const second = await post('/consents', body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
    expect(await prisma.consentRecord.count()).toBe(2);
  });

  it('refuses an update of a stored row at the database', async () => {
    await post('/consents', choice()).expect(201);

    await expect(
      prisma.$executeRawUnsafe(
        "UPDATE consent_record SET decision = 'refused'",
      ),
    ).rejects.toThrow();
  });

  it('does not let a second browser id overwrite the first browser rows', async () => {
    const browserConsentId = randomUUID();
    await post('/consents', choice({ browserConsentId })).expect(201);
    await post(
      '/consents',
      choice({ browserConsentId, decision: 'withdrawn' }),
    ).expect(201);

    const rows = await prisma.consentRecord.findMany({
      orderBy: { at: 'asc' },
    });
    expect(rows.map((r) => r.decision).sort()).toEqual([
      'granted',
      'withdrawn',
    ]);
  });
});

// @traces 244-FR-011
describe('the latest choice wins by time, not by arrival', () => {
  it('answers the choice with the latest at even when it arrived first', async () => {
    const id = await account();
    await post(
      '/me/consents',
      choice({ at: '2026-10-10T10:00:00.000Z', decision: 'withdrawn' }),
      bearer(id),
    ).expect(201);
    await post(
      '/me/consents',
      choice({ at: '2026-10-10T08:00:00.000Z', decision: 'granted' }),
      bearer(id),
    ).expect(201);

    const res = await get(bearer(id));

    expect(res.body.analytics).toMatchObject({
      at: '2026-10-10T10:00:00.000Z',
      decision: 'withdrawn',
    });
  });

  it('answers the same result when asked twice', async () => {
    const id = await account();
    await post('/me/consents', choice(), bearer(id)).expect(201);

    const first = await get(bearer(id));
    const second = await get(bearer(id));

    expect(second.body).toEqual(first.body);
  });

  it('answers null analytics and both texts for an account with no choice', async () => {
    const id = await account();

    const res = await get(bearer(id));

    expect(res.status).toBe(200);
    expect(res.body.analytics).toBeNull();
    expect(res.body.accepted).toHaveLength(2);
  });

  it('never shows another account choice', async () => {
    const mine = await account();
    const other = await account();
    await post('/me/consents', choice(), bearer(other)).expect(201);

    const res = await get(bearer(mine));

    expect(res.body.analytics).toBeNull();
  });

  it('never shows a visitor choice on an account', async () => {
    const id = await account();
    await post('/consents', choice()).expect(201);

    const res = await get(bearer(id));

    expect(res.body.analytics).toBeNull();
  });

  it('answers 401 sign_in_required for a forged token', async () => {
    const res = await get('Bearer not.a.token');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('answers 401 for a token signed with another secret', async () => {
    const forged = signAccessToken(
      { accountId: randomUUID(), role: 'admin' },
      'other-secret',
    );

    const res = await get(`Bearer ${forged}`);

    expect(res.status).toBe(401);
  });
});

// @traces 244-FR-010
describe('the audit entry of a signed-in choice', () => {
  const entries = (accountId: string) =>
    prisma.activityLog.findMany({
      where: { field: 'analyticsConsent', subjectId: accountId },
    });

  it('writes one entry per stored record by the person', async () => {
    const id = await account();

    await post('/me/consents', choice(), bearer(id)).expect(201);
    await post(
      '/me/consents',
      choice({ decision: 'withdrawn' }),
      bearer(id),
    ).expect(201);

    const rows = await entries(id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actorId === id)).toBe(true);
  });

  it('writes no entry and no row when the time is refused', async () => {
    const id = await account();

    await post(
      '/me/consents',
      choice({ at: minutesFromNow(30) }),
      bearer(id),
    ).expect(400);

    expect(await entries(id)).toHaveLength(0);
    expect(await prisma.consentRecord.count()).toBe(0);
  });

  it('writes no entry on the account for a visitor choice sent with a session', async () => {
    const id = await account();

    await post('/consents', choice(), bearer(id)).expect(201);

    expect(await entries(id)).toHaveLength(0);
  });

  it('keeps the admin own account as the subject when posting as an admin', async () => {
    const admin = await account(['admin']);

    await post('/me/consents', choice(), bearer(admin, 'admin')).expect(201);

    const [row] = await prisma.consentRecord.findMany();
    expect(row?.accountId).toBe(admin);
  });
});

// @traces 244-FR-009
describe('the address limit', () => {
  it('stores 20 records and refuses the 21st with 429 and no row', async () => {
    for (let i = 0; i < 20; i++) {
      await post('/consents', choice()).expect(201);
    }

    const res = await post('/consents', choice());

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'consent_rate_limited' });
    expect(await prisma.consentRecord.count()).toBe(20);
  });

  it('counts the visitor and the signed-in route against the same address', async () => {
    const id = await account();
    for (let i = 0; i < 10; i++) {
      await post('/consents', choice()).expect(201);
      await post('/me/consents', choice(), bearer(id)).expect(201);
    }

    const res = await post('/me/consents', choice(), bearer(id));

    expect(res.status).toBe(429);
  });

  it('does not count a refused body against the limit', async () => {
    for (let i = 0; i < 25; i++) {
      await post('/consents', choice({ decision: 'maybe' })).expect(400);
    }

    await post('/consents', choice()).expect(201);
  });

  it('does not count a time-ahead refusal against the limit', async () => {
    for (let i = 0; i < 25; i++) {
      await post('/consents', choice({ at: minutesFromNow(30) })).expect(400);
    }

    await post('/consents', choice()).expect(201);
  });

  it('does not let a forged forwarded-for header buy a fresh allowance', async () => {
    for (let i = 0; i < 20; i++) {
      await post('/consents', choice()).expect(201);
    }

    const res = await post('/consents', choice()).set(
      'X-Forwarded-For',
      '203.0.113.9',
    );

    expect(res.status).toBe(429);
  });
});

// @traces 244-FR-009
describe('malformed requests', () => {
  it('refuses a body that is not JSON', async () => {
    const res = await request(app.getHttpServer())
      .post('/consents')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(choice()));

    expect([400, 415]).toContain(res.status);
    expect(await prisma.consentRecord.count()).toBe(0);
  });

  it('refuses broken JSON with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/consents')
      .set('Content-Type', 'application/json')
      .send('{"decision":');

    expect(res.status).toBe(400);
    expect(await prisma.consentRecord.count()).toBe(0);
  });

  it('refuses an empty body with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/consents')
      .set('Content-Type', 'application/json')
      .send('');

    expect(res.status).toBe(400);
  });

  it('refuses a JSON array body with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/consents')
      .send([choice()]);

    expect(res.status).toBe(400);
    expect(await prisma.consentRecord.count()).toBe(0);
  });

  it('refuses the literal null body with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/consents')
      .set('Content-Type', 'application/json')
      .send('null');

    expect(res.status).toBe(400);
  });

  it('answers 401 and writes nothing for a bad body on the signed-in route without a session', async () => {
    const res = await post('/me/consents', { decision: 'maybe' });

    expect(res.status).toBe(401);
    expect(await prisma.consentRecord.count()).toBe(0);
  });

  it('refuses a unicode look-alike decision', async () => {
    const res = await post('/consents', choice({ decision: 'grаnted' }));

    expect(res.status).toBe(400);
  });

  it('answers a visitor with a garbage bearer token as a visitor, not 401', async () => {
    const res = await post('/consents', choice(), 'Bearer garbage');

    expect(res.status).toBe(201);
    const [row] = await prisma.consentRecord.findMany();
    expect(row?.accountId).toBeNull();
  });

  it('answers only the id, never the account, address or browser id', async () => {
    const id = await account();

    const res = await post('/me/consents', choice(), bearer(id));

    expect(Object.keys(res.body)).toEqual(['id']);
  });
});

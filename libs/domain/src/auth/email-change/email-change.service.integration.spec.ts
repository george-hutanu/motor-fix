// @traces 139-FR-006
// @traces 139-FR-007
// @traces 139-FR-012
// @traces 139-FR-016
// @traces 139-FR-017
import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { Logger, NotFoundException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { EmailChangeService } from './email-change.service';
import { NotificationsModule } from '../../notifications/notifications.module';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { signAccessToken } from '../access-token';
import { AUTH_REDIS } from '../attempts';
import { AuthModule } from '../auth.module';
import { hashToken } from '../email-confirmation/email-confirmation';
import { EmailConfirmationModule } from '../email-confirmation/email-confirmation.module';
import type { Actor } from '../policy';
import { serialDatabase } from '../serial-db.testing';

const redisUrl = redisUrlFor(9);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const redis = new Redis(redisUrl);
let app: NestExpressApplication;
let changes: EmailChangeService;

beforeAll(async () => {
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email: testConfig('http://127.0.0.1:9'), redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      EmailConfirmationModule.register({ webUrl }, notifications),
    ],
  }).compile();
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
  changes = app.get(EmailChangeService);
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.flushdb();
  jest.restoreAllMocks();
});

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;
const PASSWORD = 'o-parola-lunga';
const OLD = 'andrei@example.test';
const NEW = 'andrei.nou@example.test';
const DAY_MS = 24 * 60 * 60 * 1000;

const http = () => request(app.getHttpServer());

// An account with a password, made through sign-up.
async function signedUp(email = OLD, language: 'ro' | 'en' = 'ro') {
  await http()
    .post('/auth/sign-up')
    .set('X-Forwarded-For', address())
    .send({
      consent: CURRENT_CONSENT,
      email,
      language,
      name: 'Andrei Marin',
      password: PASSWORD,
    })
    .expect(201);
  const { id } = await prisma.account.findUniqueOrThrow({
    select: { id: true },
    where: { email },
  });
  // Only what this story sends is read below.
  await prisma.notification.deleteMany({ where: { accountId: id } });
  return id;
}

const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, tokenSecret)}`;

const ask = (accountId: string | null, email: unknown) => {
  const call = http().post('/me/email').send({ email });
  return accountId ? call.set('Authorization', bearer(accountId)) : call;
};

const emails = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, channel: 'email', kind: 'ACCOUNT_EMAIL' },
  });

const paramsOf = (row: { params: unknown }) =>
  row.params as Record<string, string>;

const changeTokens = (accountId: string) =>
  prisma.accountToken.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, purpose: 'email_change' },
  });

const emailOf = async (id: string) =>
  (
    await prisma.account.findUniqueOrThrow({
      select: { email: true },
      where: { id },
    })
  ).email;

const signIn = (email: string) =>
  http()
    .post('/auth/sign-in')
    .set('X-Forwarded-For', address())
    .send({ email, password: PASSWORD });

const driver = (accountId: string): Actor => ({
  accountId,
  garageId: null,
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
});

describe('asking to change my e-mail', () => {
  it('sends the link to the new address and a notice to the old one, and keeps the old address', async () => {
    const id = await signedUp();

    const res = await ask(id, NEW).expect(202);

    expect(res.body).toEqual({ pendingEmail: NEW });
    expect(await emailOf(id)).toBe(OLD);
    const sent = await emails(id);
    expect(sent.map((row) => paramsOf(row)['purpose']).sort()).toEqual([
      'email_change_notice',
      'email_check',
    ]);
    const link = sent.find((row) => paramsOf(row)['purpose'] === 'email_check');
    expect(paramsOf(link ?? { params: {} })).toMatchObject({ to: NEW });
    expect(paramsOf(link ?? { params: {} })['link']).toMatch(
      /^https:\/\/motorfix\.test\/ro\/confirm-email\/[A-Za-z0-9_-]{43}$/,
    );
    const notice = sent.find(
      (row) => paramsOf(row)['purpose'] === 'email_change_notice',
    );
    expect(paramsOf(notice ?? { params: {} })['to']).toBeUndefined();
  });

  it('keeps only the hash of a single-use token valid 24 hours, for the new address', async () => {
    const id = await signedUp();
    const before = Date.now();

    await ask(id, NEW).expect(202);

    const [link] = (await emails(id)).filter(
      (row) => paramsOf(row)['purpose'] === 'email_check',
    );
    const token = String(paramsOf(link ?? { params: {} })['link'])
      .split('/')
      .at(-1);
    const rows = await changeTokens(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: NEW,
      tokenHash: hashToken(String(token)),
      usedAt: null,
    });
    const expires = rows[0]?.expiresAt.getTime() ?? 0;
    expect(expires).toBeGreaterThanOrEqual(before + DAY_MS - 5000);
    expect(expires).toBeLessThanOrEqual(Date.now() + DAY_MS + 5000);
    expect(JSON.stringify(rows)).not.toContain(String(token));
  });

  it('trims the address and stores it in lower case', async () => {
    const id = await signedUp();

    const res = await ask(id, '  Andrei.Nou@Example.TEST ').expect(202);

    expect(res.body.pendingEmail).toBe(NEW);
    expect((await changeTokens(id))[0]?.email).toBe(NEW);
  });

  it('writes the link in the account language', async () => {
    const id = await signedUp('ann@example.test', 'en');

    await ask(id, NEW).expect(202);

    const links = (await emails(id)).map((row) => paramsOf(row)['link']);
    expect(links.some((link) => /\/en\/confirm-email\//.test(link ?? ''))).toBe(
      true,
    );
  });

  it('voids the older link when a newer one is asked for, and shows the latest address', async () => {
    const id = await signedUp();

    await ask(id, 'prima@example.test').expect(202);
    await ask(id, NEW).expect(202);

    const [older, newer] = await changeTokens(id);
    expect(older?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(newer?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const me = await http()
      .get('/me')
      .set('Authorization', bearer(id))
      .expect(200);
    expect(me.body.pendingEmail).toBe(NEW);
  });

  it('sends a first address of an account with none, with no notice', async () => {
    const id = await account('fara', ['driver'], { email: null });

    await ask(id, NEW).expect(202);

    const sent = await emails(id);
    expect(sent).toHaveLength(1);
    expect(paramsOf(sent[0] ?? { params: {} })).toMatchObject({
      purpose: 'email_check',
      to: NEW,
    });
  });
});

describe('an address that cannot be asked for', () => {
  it('refuses an address another account holds, whatever its case, and sends nothing', async () => {
    const id = await signedUp();
    await account('elena', ['driver'], { email: 'elena@example.test' });

    const res = await ask(id, 'Elena@Example.test').expect(409);

    expect(res.body.code).toBe('email_taken');
    expect(await emails(id)).toHaveLength(0);
    expect(await changeTokens(id)).toHaveLength(0);
  });

  it('refuses the address of a suspended account too', async () => {
    const id = await signedUp();
    await account('elena', ['driver'], {
      email: 'elena@example.test',
      status: 'suspended',
    });

    const res = await ask(id, 'elena@example.test').expect(409);

    expect(res.body.code).toBe('email_taken');
  });

  it('refuses the account own address as unchanged and sends nothing', async () => {
    const id = await signedUp();

    const res = await ask(id, 'Andrei@Example.test').expect(409);

    expect(res.body.code).toBe('email_unchanged');
    expect(await emails(id)).toHaveLength(0);
    expect(await changeTokens(id)).toHaveLength(0);
  });

  it.each([
    ['an address without a domain', 'andrei@'],
    ['an address of 255 characters', `${'a'.repeat(244)}@exemplu.ro`],
    ['a number', 42],
  ])('refuses %s with 400', async (_, email) => {
    const id = await signedUp();

    await ask(id, email).expect(400);

    expect(await changeTokens(id)).toHaveLength(0);
  });

  it('keeps no pending change when the e-mail cannot be sent', async () => {
    const id = await signedUp();
    jest
      .spyOn(app.get(NotificationsService), 'sendAccountEmail')
      .mockRejectedValue(new Error('Redis did not answer'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const res = await ask(id, NEW).expect(503);

    expect(res.body.code).toBe('send_failed');
    expect(await changeTokens(id)).toHaveLength(0);
    const me = await http()
      .get('/me')
      .set('Authorization', bearer(id))
      .expect(200);
    expect(me.body.pendingEmail).toBeNull();
  });
});

describe('the hourly limit', () => {
  it('refuses the sixth link in an hour and sends nothing for it', async () => {
    const id = await signedUp();
    for (let i = 1; i <= 5; i++) {
      await ask(id, `nou${i}@example.test`).expect(202);
    }

    const res = await ask(id, 'nou6@example.test').expect(429);

    expect(res.body.code).toBe('too_many_attempts');
    expect(await changeTokens(id)).toHaveLength(5);
  });

  it('does not count a refused address', async () => {
    const id = await signedUp();
    for (let i = 0; i < 5; i++) await ask(id, OLD).expect(409);

    await ask(id, NEW).expect(202);
  });

  it('is skipped, and logged, when Redis is down', async () => {
    const id = await signedUp();
    const client = app.get<Redis>(AUTH_REDIS);
    jest.spyOn(client, 'multi').mockImplementation(() => {
      const chain = {
        exec: () => Promise.reject(new Error('Connection is closed.')),
        expire: () => chain,
        incr: () => chain,
      };
      return chain as unknown as ReturnType<Redis['multi']>;
    });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    for (let i = 1; i <= 6; i++) {
      await ask(id, `nou${i}@example.test`).expect(202);
    }

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Redis unavailable'),
    );
  });
});

describe('signing in while a change waits', () => {
  it('still signs in with the old address and not with the new one', async () => {
    const id = await signedUp();

    await ask(id, NEW).expect(202);

    await signIn(OLD).expect(200);
    await signIn(NEW).expect(401);
    expect(await emailOf(id)).toBe(OLD);
  });
});

describe('who may ask', () => {
  it('answers 401 sign_in_required with no session', async () => {
    const res = await ask(null, NEW).expect(401);

    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 403 account_suspended to a suspended account and sends nothing', async () => {
    const id = await signedUp();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await ask(id, NEW).expect(403);

    expect(res.body.code).toBe('account_suspended');
    expect(await changeTokens(id)).toHaveLength(0);
  });

  it('does not exist for an assistant acting for the account', async () => {
    const id = await signedUp();

    await expect(
      changes.request({ ...driver(id), via: 'assistant' }, NEW),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await changeTokens(id)).toHaveLength(0);
    expect(await emails(id)).toHaveLength(0);
  });
});

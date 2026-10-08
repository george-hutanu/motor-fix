import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { PasswordResetModule } from './password-reset.module';
import { PasswordResetService } from './password-reset.service';
import { AuditService } from '../../../audit/audit.service';
import {
  EVENT_PORT,
  type EventPort,
  noEvents,
} from '../../../events/event.port';
import { NotificationsModule } from '../../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { until } from '../../../waits.testing';
import { AccountsService } from '../../accounts.service';
import { AuthModule } from '../../auth.module';
import { hashToken } from '../../email-confirmation/email-confirmation';
import { MAINTENANCE } from '../../maintenance';
import { serialDatabase } from '../../serial-db.testing';
import * as password from '../password';

const redisUrl = redisUrlFor(8);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const OLD = 'parola-veche-de-test';
const NEW = 'parola-noua-de-test';
const { account, prisma, reset } = fixtures();
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

const redis = new Redis(redisUrl);
const subscriber = new Redis(redisUrl);
const published: string[] = [];
let app: NestExpressApplication;
let resets: PasswordResetService;
let maintenance = false;
let oldHash: string;
let failing: Error | undefined;

beforeAll(async () => {
  oldHash = await password.hashPassword(OLD);
  await subscriber.subscribe('live:events');
  subscriber.on('message', (_channel, message) => published.push(message));
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email: testConfig('http://127.0.0.1:9'), redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      PasswordResetModule.register({ webUrl }, notifications),
    ],
  })
    .overrideProvider(MAINTENANCE)
    .useValue({ on: async () => maintenance })
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
  resets = app.get(PasswordResetService);
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  subscriber.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resets.drain();
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  await redis.flushdb();
  published.length = 0;
  maintenance = false;
  jest.restoreAllMocks();
  const real = app.get<EventPort>(EVENT_PORT);
  const record = real.record.bind(real);
  jest.spyOn(real, 'record').mockImplementation(async (tx, event) => {
    if (failing) throw failing;
    return record(tx, event);
  });
  failing = undefined;
  resets.now = () => new Date();
});

let addresses = 0;
const address = () => `203.0.113.${++addresses % 250}`;
const http = () => request(app.getHttpServer());
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MINUTE = 60_000;

async function person(
  email = 'andrei@example.test',
  options: { language?: 'ro' | 'en'; roles?: ('driver' | 'admin')[] } = {},
) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    email,
    identity: { method: 'password', passwordHash: oldHash, subject: email },
    language: options.language,
    name: 'Andrei Marin',
    roles: options.roles ?? ['driver'],
  });
  return id;
}

const complete = (token: unknown, newPassword: unknown = NEW) =>
  http()
    .post('/auth/password-reset/complete')
    .send({ password: newPassword, token });
const check = (token: unknown) =>
  http().post('/auth/password-reset/check').send({ token });
const signIn = (email: string, secret: string) =>
  http()
    .post('/auth/sign-in')
    .set('X-Forwarded-For', address())
    .send({ email, password: secret });

async function linkFor(accountId: string, email = 'andrei@example.test') {
  await http()
    .post('/auth/password-reset')
    .set('X-Forwarded-For', address())
    .send({ email })
    .expect(202);
  await resets.drain();
  const rows = await prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: {
      accountId,
      channel: 'email',
      kind: 'ACCOUNT_EMAIL',
      params: { equals: 'password_reset', path: ['purpose'] },
    },
  });
  const last = rows.at(-1);
  if (!last) throw new Error('no reset e-mail queued');
  return (
    String((last.params as { link: string }).link)
      .split('/')
      .at(-1) ?? ''
  );
}

const outbox = () => prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } });
const dump = (value: unknown) =>
  JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
const heard = () =>
  published
    .map((m) => JSON.parse(m) as Record<string, unknown>)
    .filter(
      (m) => (m['event'] as { kind?: string }).kind === 'session.revoked',
    );

function cookieOf(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (
    header
      ?.find((c) => c.startsWith('mf_refresh='))
      ?.split(';')[0]
      ?.slice('mf_refresh='.length) ?? ''
  );
}

describe('the event a completed reset records', () => {
  it('holds exactly the account id, never the address, language, name or secrets', async () => {
    const id = await person('Ana.Pop+x@example.test', { language: 'en' });
    const token = await linkFor(id, 'Ana.Pop+x@example.test');
    const secret = 'pâr0lă-ținută-🔑-secretă';
    await complete(token, secret).expect(200);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]?.payload as object)).toEqual(['accountId']);
    const text = dump(rows).toLowerCase();
    for (const leak of [
      secret,
      token,
      'ana.pop',
      'example.test',
      'andrei',
      'marin',
      'argon2',
      'language',
      'email',
    ]) {
      expect(text).not.toContain(leak.toLowerCase());
    }
  });

  it('records one event per completed reset across repeated resets of one account', async () => {
    const id = await person();
    const first = await linkFor(id);
    await complete(first, 'prima-parola-noua').expect(200);
    await complete(first, 'reluata-parola-noua').expect(410);
    const second = await linkFor(id);
    await complete(second, 'a-doua-parola-noua').expect(200);
    await complete(second, 'reluata-parola-noua').expect(410);
    await complete(first, 'reluata-parola-noua').expect(410);
    const rows = await outbox();
    expect(rows.map((r) => r.kind)).toEqual([
      'account.password_reset',
      'account.password_reset',
    ]);
    expect(rows.map((r) => r.subjectId)).toEqual([id, id]);
    expect(
      await prisma.activityLog.count({
        where: { kind: 'password_reset', subjectId: id },
      }),
    ).toBe(2);
  });

  // @traces 976-FR-002
  it('records one event when twelve saves of one link race', async () => {
    const id = await person();
    const token = await linkFor(id);
    const answers = await Promise.all(
      Array.from({ length: 12 }, (_, i) => complete(token, `parola-noua-${i}`)),
    );
    expect(answers.filter((r) => r.status === 200)).toHaveLength(1);
    expect(answers.filter((r) => r.status === 410)).toHaveLength(11);
    expect(await outbox()).toHaveLength(1);
    await until('the session message', () => heard().length > 0);
    // Long enough for a second, wrong, message to arrive.
    await pause(300);
    expect(
      heard().filter(
        (m) => (m['event'] as { kind?: string }).kind === 'session.revoked',
      ),
    ).toHaveLength(1);
  });

  it('records none for the account whose older link a newer request voided', async () => {
    const id = await person();
    const older = await linkFor(id);
    const newer = await linkFor(id);
    await complete(older).expect(410);
    expect(await outbox()).toEqual([]);
    await complete(newer).expect(200);
    expect(await outbox()).toHaveLength(1);
  });

  it('records none for an e-mail confirmation link, a used link or a request and check alone', async () => {
    const id = await person();
    await prisma.accountToken.create({
      data: {
        accountId: id,
        email: 'andrei@example.test',
        expiresAt: new Date(Date.now() + 60 * MINUTE),
        purpose: 'email_confirm',
        tokenHash: hashToken('B'.repeat(43)),
      },
    });
    await complete('B'.repeat(43)).expect(410);
    const token = await linkFor(id);
    await check(token).expect(204);
    await check(token).expect(204);
    await prisma.accountToken.updateMany({
      data: { usedAt: new Date() },
      where: { purpose: 'password_reset' },
    });
    await complete(token).expect(410);
    expect(await outbox()).toEqual([]);
    await signIn('andrei@example.test', OLD).expect(200);
  });

  it('records none and no session message for refused inputs of every shape', async () => {
    const id = await person();
    const token = await linkFor(id);
    for (const body of [
      { password: NEW },
      { token },
      { password: null, token },
      { password: 12345678, token },
      { password: NEW, token: null },
      { password: NEW, token: ['x'] },
      { extra: 1, password: NEW, token },
    ]) {
      await http().post('/auth/password-reset/complete').send(body).expect(400);
    }
    await complete(token, '   ').expect(400);
    // Long enough for a wrong message to arrive.
    await pause(150);
    expect(await outbox()).toEqual([]);
    expect(heard()).toEqual([]);
    await check(token).expect(204);
  });

  it('leaves another account with no event and keeps its sessions', async () => {
    const id = await person();
    const other = await person('ioana@example.test');
    const theirs = await signIn('ioana@example.test', OLD).expect(200);
    await complete(await linkFor(id)).expect(200);
    const rows = await outbox();
    expect(rows.map((r) => r.subjectId)).toEqual([id]);
    expect(
      await prisma.refreshToken.count({ where: { accountId: other } }),
    ).toBe(1);
    expect(cookieOf(theirs)).not.toBe('');
  });

  it('records the event for a Google-only account that adds a password, and none for its refused attempt', async () => {
    const id = await account('ioana');
    const token = await linkFor(id, 'ioana@example.test');
    await complete(token, 'short').expect(400);
    expect(await outbox()).toEqual([]);
    await complete(token).expect(200);
    expect((await outbox()).map((r) => r.subjectId)).toEqual([id]);
  });

  it('records the event for an admin reset during maintenance and none for a driver', async () => {
    const admin = await person('admin@example.test', { roles: ['admin'] });
    const driver = await person();
    const adminToken = await linkFor(admin, 'admin@example.test');
    const driverToken = await linkFor(driver);
    maintenance = true;
    await complete(driverToken).expect(503);
    await complete(adminToken).expect(200);
    expect((await outbox()).map((r) => r.subjectId)).toEqual([admin]);
  });

  it('keeps the first reset recorded when the second one fails to record', async () => {
    const id = await person();
    await complete(await linkFor(id), 'prima-parola-noua').expect(200);
    const second = await linkFor(id);
    failing = new Error('outbox down');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await complete(second, 'a-doua-parola-noua').expect(500);
    failing = undefined;
    expect(await outbox()).toHaveLength(1);
    expect(
      await prisma.activityLog.count({
        where: { kind: 'password_reset', subjectId: id },
      }),
    ).toBe(1);
    await signIn('andrei@example.test', 'prima-parola-noua').expect(200);
    await check(second).expect(204);
    await complete(second, 'a-doua-parola-noua').expect(200);
    expect(await outbox()).toHaveLength(2);
  });

  it('rolls back the password and the link when the event port throws a non-Error', async () => {
    const id = await person();
    const token = await linkFor(id);
    failing = 'boom' as unknown as Error;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await complete(token).expect(500);
    failing = undefined;
    await signIn('andrei@example.test', OLD).expect(200);
    expect(
      await prisma.accountToken.count({
        where: { accountId: id, purpose: 'password_reset', usedAt: null },
      }),
    ).toBe(1);
  });

  it('publishes the session message once, without the password, token or address', async () => {
    const id = await person();
    const token = await linkFor(id);
    await complete(token).expect(200);
    await until('the session message', () => heard().length > 0);
    // Long enough for a second, wrong, message to arrive.
    await pause(300);
    expect(heard()).toEqual([
      {
        audience: [`account:${id}`],
        event: {
          at: expect.any(String),
          id: expect.any(String),
          kind: 'session.revoked',
        },
      },
    ]);
    const text = heard()
      .map((m) => JSON.stringify(m))
      .join();
    for (const leak of [NEW, token, 'andrei@', 'argon2']) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('signing out on all devices alongside the reset', () => {
  const session = async (email = 'andrei@example.test') =>
    cookieOf(await signIn(email, OLD).expect(200));
  const everywhere = (cookie?: string) => {
    const req = http().post('/auth/sign-out-everywhere');
    return cookie ? req.set('Cookie', `mf_refresh=${cookie}`) : req;
  };

  it('keeps publishing one session message and recording one event per call', async () => {
    const id = await person();
    const cookie = await session();
    await everywhere(cookie).expect(204);
    await everywhere(cookie).expect(401);
    await until('the session message', () => heard().length > 0);
    // Long enough for a second, wrong, message to arrive.
    await pause(300);
    expect(heard()).toEqual([
      {
        audience: [`account:${id}`],
        event: {
          at: expect.any(String),
          id: expect.any(String),
          kind: 'session.revoked',
        },
      },
    ]);
    const rows = await outbox();
    expect(rows.map((r) => r.kind)).toEqual(['account.signed_out_everywhere']);
    expect(rows[0]?.payload).toEqual({ accountId: id });
  });

  it('publishes nothing and keeps every session when its event cannot be recorded', async () => {
    const id = await person();
    const cookie = await session();
    await session();
    failing = new Error('outbox down');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await everywhere(cookie).expect(500);
    failing = undefined;
    // Long enough for a wrong message to arrive.
    await pause(200);
    expect(heard()).toEqual([]);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      2,
    );
    expect(await outbox()).toEqual([]);
  });

  it('answers a reset after a sign-out everywhere with both events and two messages', async () => {
    const id = await person();
    await everywhere(await session()).expect(204);
    await complete(await linkFor(id)).expect(200);
    await until('both session messages', () => heard().length >= 2);
    // Long enough for a third, wrong, message to arrive.
    await pause(300);
    expect((await outbox()).map((r) => r.kind).sort()).toEqual([
      'account.password_reset',
      'account.signed_out_everywhere',
    ]);
    expect(heard()).toHaveLength(2);
  });
});

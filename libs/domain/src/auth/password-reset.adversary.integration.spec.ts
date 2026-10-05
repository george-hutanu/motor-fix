import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import { MAINTENANCE } from './maintenance';
import * as password from './password';
import { PasswordResetModule } from './password-reset.module';
import { PasswordResetService } from './password-reset.service';
import { PRISMA } from './prisma';
import { serialDatabase } from './serial-db.testing';
import { AuditService } from '../audit/audit.service';
import { noEvents } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(8);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const OLD = 'parola-veche-de-test';
const { prisma, reset } = fixtures();
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

const redis = new Redis(redisUrl);
const subscriber = new Redis(redisUrl);
const published: string[] = [];
let app: NestExpressApplication;
let resets: PasswordResetService;
let maintenance = false;
let oldHash: string;

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
  // A link the last test asked for must not write into this one.
  await resets.drain();
  await reset();
  await redis.flushdb();
  published.length = 0;
  maintenance = false;
  resets.now = () => new Date();
  jest.restoreAllMocks();
});

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;
const http = () => request(app.getHttpServer());

// An account that signs in with OLD.
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

const ask = (email: unknown, from = address()) =>
  http()
    .post('/auth/password-reset')
    .set('X-Forwarded-For', from)
    .send({ email });
const holds: (() => void)[] = [];
afterEach(() => {
  for (const release of holds.splice(0)) release();
});

function holdResetEmails(): () => void {
  const notifications = app.get(NotificationsService);
  const send = notifications.sendAccountEmail.bind(notifications);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  holds.push(release);
  jest
    .spyOn(notifications, 'sendAccountEmail')
    .mockImplementation(async (input) => {
      await held;
      return send(input);
    });
  return release;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const emailCount = () =>
  prisma.notification.count({
    where: { channel: 'email', kind: 'ACCOUNT_EMAIL' },
  });

// @traces 568-FR-001 568-FR-002 568-FR-003
describe('answering a reset request before the link is issued', () => {
  it('waits in drain for every one of many concurrent issuings', async () => {
    const release = holdResetEmails();
    const count = 12;
    for (let i = 0; i < count; i++) await person(`driver${i}@example.test`);
    const answers = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        ask(`driver${i}@example.test`).timeout(2000),
      ),
    );
    expect(answers.map((r) => r.status)).toEqual(Array(count).fill(202));
    expect(await emailCount()).toBe(0);
    let drained = false;
    const draining = resets.drain().then(() => {
      drained = true;
    });
    await pause(150);
    expect(drained).toBe(false);
    release();
    await draining;
    expect(await emailCount()).toBe(count);
    expect(await prisma.accountToken.count()).toBe(count);
  });

  it('resolves drain at once when nothing is in flight', async () => {
    const started = Date.now();
    await expect(resets.drain()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('resolves drain at once after the issuings have settled', async () => {
    await person();
    await ask('andrei@example.test').expect(202);
    await resets.drain();
    const started = Date.now();
    await expect(resets.drain()).resolves.toBeUndefined();
    await expect(resets.drain()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('lets two drains wait on the same issuing and both resolve', async () => {
    await person();
    const release = holdResetEmails();
    await ask('andrei@example.test').timeout(2000).expect(202);
    let settled = 0;
    const a = resets.drain().then(() => settled++);
    const b = resets.beforeApplicationShutdown().then(() => settled++);
    await pause(100);
    expect(settled).toBe(0);
    release();
    await Promise.all([a, b]);
    expect(settled).toBe(2);
    expect(await emailCount()).toBe(1);
  });

  it('answers 202 and raises no unhandled rejection when the queue rejects', async () => {
    await person();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      jest
        .spyOn(app.get(NotificationsService), 'sendAccountEmail')
        .mockRejectedValue(new Error('queue down for andrei@example.test'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      await ask('andrei@example.test').expect(202);
      await resets.drain();
      await pause(100);
    } finally {
      process.off('unhandledRejection', listener);
    }
    expect(unhandled).toEqual([]);
  });

  it('answers 202 and raises no unhandled rejection when the queue throws synchronously', async () => {
    await person();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    let status = 0;
    try {
      jest
        .spyOn(app.get(NotificationsService), 'sendAccountEmail')
        .mockImplementation(() => {
          throw new Error('thrown before any promise');
        });
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      status = (await ask('andrei@example.test')).status;
      await resets.drain();
      await pause(100);
    } finally {
      process.off('unhandledRejection', listener);
    }
    expect(status).toBe(202);
    expect(unhandled).toEqual([]);
  });

  it('answers 202 and logs without the address when the account lookup fails', async () => {
    await person();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const appPrisma = app.get<PrismaClient>(PRISMA);
    jest
      .spyOn(appPrisma.account, 'findUnique')
      .mockRejectedValue(new Error('database gone for andrei@example.test'));
    let status = 0;
    try {
      status = (await ask('andrei@example.test')).status;
      await resets.drain();
      await pause(100);
    } finally {
      process.off('unhandledRejection', listener);
    }
    expect(status).toBe(202);
    expect(unhandled).toEqual([]);
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain('andrei@');
  });

  it('resolves shutdown after an issuing failed', async () => {
    await person();
    jest
      .spyOn(app.get(NotificationsService), 'sendAccountEmail')
      .mockRejectedValue(new Error('queue down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await ask('andrei@example.test').expect(202);
    await expect(resets.beforeApplicationShutdown()).resolves.toBeUndefined();
    await expect(resets.beforeApplicationShutdown()).resolves.toBeUndefined();
  });

  it('resolves shutdown when one of several issuings failed and the rest finish', async () => {
    await person('one@example.test');
    await person('two@example.test');
    const notifications = app.get(NotificationsService);
    const send = notifications.sendAccountEmail.bind(notifications);
    let calls = 0;
    jest
      .spyOn(notifications, 'sendAccountEmail')
      .mockImplementation(async (input) => {
        if (++calls === 1) throw new Error('first one fails');
        return send(input);
      });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await ask('one@example.test').expect(202);
    await ask('two@example.test').expect(202);
    await expect(resets.beforeApplicationShutdown()).resolves.toBeUndefined();
    expect(await emailCount()).toBe(1);
  });

  it('issues nothing for a request the e-mail limit refused', async () => {
    const id = await person();
    for (let i = 0; i < 3; i++) await ask('andrei@example.test').expect(202);
    await resets.drain();
    const send = jest.spyOn(app.get(NotificationsService), 'sendAccountEmail');
    const tokens = await prisma.accountToken.count({
      where: { accountId: id },
    });
    const lookup = jest.spyOn(
      app.get<PrismaClient>(PRISMA).account,
      'findUnique',
    );
    const res = await ask('andrei@example.test').expect(202);
    await resets.drain();
    expect(res.text).toBe('');
    expect(send).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(await prisma.accountToken.count({ where: { accountId: id } })).toBe(
      tokens,
    );
    expect(await emailCount()).toBe(3);
  });

  it('issues nothing for a request the address limit refused, even for a known account', async () => {
    const id = await person();
    const from = '203.0.113.50';
    for (let i = 0; i < 10; i++) {
      await ask(`nobody${i}@example.test`, from).expect(202);
    }
    await resets.drain();
    const send = jest.spyOn(app.get(NotificationsService), 'sendAccountEmail');
    await ask('andrei@example.test', from).expect(202);
    await resets.drain();
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.accountToken.count({ where: { accountId: id } })).toBe(
      0,
    );
  });

  it('does not let a refused request void the live link', async () => {
    const id = await person();
    for (let i = 0; i < 3; i++) await ask('andrei@example.test').expect(202);
    await resets.drain();
    const live = await prisma.accountToken.findMany({
      where: { accountId: id, purpose: 'password_reset', usedAt: null },
    });
    await ask('andrei@example.test').expect(202);
    await resets.drain();
    const after = await prisma.accountToken.findMany({
      where: { accountId: id, purpose: 'password_reset', usedAt: null },
    });
    expect(after.map((t) => t.tokenHash)).toEqual(live.map((t) => t.tokenHash));
  });

  it('refuses an invalid body with 400 without issuing anything', async () => {
    await person();
    const send = jest.spyOn(app.get(NotificationsService), 'sendAccountEmail');
    await http()
      .post('/auth/password-reset')
      .set('X-Forwarded-For', address())
      .send({ email: 'not-an-address' })
      .expect(400);
    await resets.drain();
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 202 in the same shape for a held issuing, an unknown address and a known one', async () => {
    await person();
    const release = holdResetEmails();
    const known = await ask('andrei@example.test').timeout(2000).expect(202);
    const unknown = await ask('nimeni@example.test').timeout(2000).expect(202);
    expect(known.text).toBe('');
    expect(unknown.text).toBe('');
    expect(known.headers['content-length'] ?? '0').toBe(
      unknown.headers['content-length'] ?? '0',
    );
    release();
    await resets.drain();
  });

  it('keeps answering 202 while earlier issuings are still held', async () => {
    for (let i = 0; i < 5; i++) await person(`held${i}@example.test`);
    const release = holdResetEmails();
    for (let i = 0; i < 5; i++) {
      await ask(`held${i}@example.test`).timeout(2000).expect(202);
    }
    await ask('late@example.test').timeout(2000).expect(202);
    release();
    await resets.drain();
    expect(await emailCount()).toBe(5);
  });
});

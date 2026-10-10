// @traces 139-FR-014
// @traces 139-FR-015
// @traces 139-FR-016
// @traces 139-FR-017
import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger, NotFoundException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { PasswordChangeService } from './password-change.service';
import { AuditService } from '../../../audit/audit.service';
import { noEvents } from '../../../events/event.port';
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
import type { Actor } from '../../policy';
import { serialDatabase } from '../../serial-db.testing';
import { SignInService } from '../../sign-in.service';
import { hashPassword } from '../password';
import { PasswordResetModule } from '../password-reset/password-reset.module';

const redisUrl = redisUrlFor(11);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const OLD = 'parola-veche-de-test';
const NEW = 'parola-noua-de-test';
const WRONG = 'parola-gresita-de-test';
const EMAIL = 'andrei@example.test';
const MINUTE = 60_000;
const { account, prisma, reset } = fixtures();
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

const redis = new Redis(redisUrl);
const subscriber = new Redis(redisUrl);
const published: string[] = [];
let app: NestExpressApplication;
let oldHash: string;

beforeAll(async () => {
  oldHash = await hashPassword(OLD);
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
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  subscriber.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.flushdb();
  published.length = 0;
  jest.restoreAllMocks();
});

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;
const http = () => request(app.getHttpServer());

// An account that signs in with OLD.
async function person(email = EMAIL) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    email,
    identity: { method: 'password', passwordHash: oldHash, subject: email },
    name: 'Andrei Marin',
    roles: ['driver'],
  });
  return id;
}

interface Device {
  bearer: string;
  cookie: string;
}

function cookieOf(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const found = header?.find((c) => c.startsWith('mf_refresh='));
  return found?.split(';')[0] ?? '';
}

const signIn = (email: string, secret: string) =>
  http()
    .post('/auth/sign-in')
    .set('X-Forwarded-For', address())
    .send({ email, password: secret });

// A device signed in with the password: its access token and its cookie.
async function device(email = EMAIL, secret = OLD): Promise<Device> {
  const res = await signIn(email, secret).expect(200);
  return { bearer: `Bearer ${res.body.accessToken}`, cookie: cookieOf(res) };
}

// A device of an account that signs in another way, opened now.
async function opened(accountId: string): Promise<Device> {
  const issued = await app
    .get(SignInService)
    .openSession(accountId, 'driver', true);
  return {
    bearer: `Bearer ${issued.accessToken}`,
    cookie: `mf_refresh=${issued.refreshToken}`,
  };
}

const change = (from: Partial<Device>, body: Record<string, unknown>) => {
  const call = http().post('/auth/password');
  if (from.bearer) call.set('Authorization', from.bearer);
  if (from.cookie) call.set('Cookie', from.cookie);
  return call.send(body);
};

const refresh = (from: Device) =>
  http().post('/auth/refresh').set('Cookie', from.cookie);

const familiesOf = async (accountId: string) =>
  new Set(
    (
      await prisma.refreshToken.findMany({
        select: { familyId: true },
        where: { accountId },
      })
    ).map((row) => row.familyId),
  );

const passwordOf = (accountId: string) =>
  prisma.accountIdentity.findFirst({
    where: { accountId, method: 'password' },
  });

const auditOf = (accountId: string) =>
  prisma.activityLog.findMany({
    where: { kind: 'password_changed', subjectId: accountId },
  });

const eventsOf = (accountId: string) =>
  prisma.outboxEvent.findMany({ where: { subjectId: accountId } });

const notices = (accountId: string) =>
  prisma.notification.findMany({
    where: {
      accountId,
      channel: 'email',
      kind: 'ACCOUNT_EMAIL',
      params: { equals: 'password_changed', path: ['purpose'] },
    },
  });

// The family opened `minutes` ago, every row of it.
const openedAgo = (accountId: string, minutes: number) =>
  prisma.refreshToken.updateMany({
    data: { createdAt: new Date(Date.now() - minutes * MINUTE) },
    where: { accountId },
  });

const actorOf = (accountId: string): Actor => ({
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

const reader = countedMetrics();
const passwordChanges = () =>
  counterTotal(reader, 'motorfix_account_changes_total', { field: 'password' });

describe('changing my password', () => {
  it('answers 204 and replaces the password: the new one signs in, the old one does not', async () => {
    const id = await person();
    const laptop = await device();

    const res = await change(laptop, {
      currentPassword: OLD,
      newPassword: NEW,
    });

    expect(res.status).toBe(204);
    const stored = await passwordOf(id);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.passwordHash).not.toBe(oldHash);
    await signIn(EMAIL, OLD).expect(401);
    await signIn(EMAIL, NEW).expect(200);
  });

  it('keeps this session and ends every other: only one family renews', async () => {
    const id = await person();
    const laptop = await device();
    const phone = await device();
    const tablet = await device();
    const [kept] = await familiesOf(id).then((all) => [...all]);

    await change(laptop, { currentPassword: OLD, newPassword: NEW }).expect(
      204,
    );

    await refresh(phone).expect(401);
    await refresh(tablet).expect(401);
    await refresh(laptop).expect(200);
    expect(await familiesOf(id)).toEqual(new Set([kept]));
  });

  it("leaves another account's sessions alone", async () => {
    const id = await person();
    const other = await person('ioana@example.test');
    const laptop = await device();
    const theirs = await device('ioana@example.test');

    await change(laptop, { currentPassword: OLD, newPassword: NEW }).expect(
      204,
    );

    await refresh(theirs).expect(200);
    expect((await familiesOf(other)).size).toBe(1);
    expect((await familiesOf(id)).size).toBe(1);
  });

  it('deletes every push device of the account and no other', async () => {
    const id = await person();
    const other = await person('ioana@example.test');
    const laptop = await device();
    const push = (accountId: string, n: number) =>
      prisma.pushSubscription.create({
        data: {
          accountId,
          auth: 'a',
          endpoint: `https://push.example.test/${n}`,
          p256dh: 'p',
        },
      });
    await push(id, 1);
    await push(id, 2);
    await push(other, 3);

    await change(laptop, { currentPassword: OLD, newPassword: NEW }).expect(
      204,
    );

    const left = await prisma.pushSubscription.findMany();
    expect(left.map((d) => d.accountId)).toEqual([other]);
  });

  it('writes one audit entry, password_changed, with no value', async () => {
    const id = await person();
    const laptop = await device();

    await change(laptop, { currentPassword: OLD, newPassword: NEW }).expect(
      204,
    );

    const entries = await auditOf(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: id,
      field: 'password',
      subjectType: 'account',
    });
    expect(entries[0]?.oldValue ?? null).toBeNull();
    expect(entries[0]?.newValue ?? null).toBeNull();
    const text = JSON.stringify(entries);
    expect(text).not.toContain(NEW);
    expect(text).not.toContain(OLD);
    expect(text).not.toContain('argon2');
  });

  it('records account.password_changed holding only the account id', async () => {
    const id = await person();
    const laptop = await device();

    await change(laptop, { currentPassword: OLD, newPassword: NEW }).expect(
      204,
    );

    expect(await eventsOf(id)).toEqual([
      expect.objectContaining({
        audience: [`account:${id}`],
        kind: 'account.password_changed',
        payload: { accountId: id },
        subjectId: id,
      }),
    ]);
  });

  it('queues one "password changed" e-mail to the account', async () => {
    const id = await person();
    const laptop = await device();

    await change(laptop, { currentPassword: OLD, newPassword: NEW }).expect(
      204,
    );

    await until('the notice', async () => (await notices(id)).length > 0);
    expect(await notices(id)).toHaveLength(1);
  });

  it('tells the account open dashboards their sessions ended', async () => {
    const id = await person();
    const laptop = await device();
    const revoke = jest.spyOn(app.get(SignInService), 'revokeSessionsLive');

    await change(laptop, { currentPassword: OLD, newPassword: NEW }).expect(
      204,
    );

    expect(revoke).toHaveBeenCalledWith(id, expect.any(Date));
    const events = () =>
      published.map((m) => JSON.parse(m) as Record<string, unknown>);
    await until('the live event', () =>
      published.some((m) => m.includes('session.revoked')),
    );
    expect(events()).toContainEqual(
      expect.objectContaining({
        audience: [`account:${id}`],
        event: expect.objectContaining({ kind: 'session.revoked' }),
      }),
    );
  });

  it('counts one password change', async () => {
    await person();
    const laptop = await device();
    const before = await passwordChanges();

    await change(laptop, { currentPassword: OLD, newPassword: NEW }).expect(
      204,
    );

    expect(await passwordChanges()).toBe(before + 1);
  });

  it('refuses a wrong current password with 401 invalid_credentials and changes nothing', async () => {
    const id = await person();
    const laptop = await device();
    const phone = await device();

    const res = await change(laptop, {
      currentPassword: WRONG,
      newPassword: NEW,
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_credentials');
    expect((await passwordOf(id))?.passwordHash).toBe(oldHash);
    await refresh(phone).expect(200);
    expect(await auditOf(id)).toEqual([]);
    expect(await eventsOf(id)).toEqual([]);
    expect(await notices(id)).toEqual([]);
    expect(published.join()).not.toContain('session.revoked');
  });

  it('asks for the current password of an account that has one', async () => {
    const id = await person();
    const laptop = await device();

    const res = await change(laptop, { newPassword: NEW });

    expect(res.status).toBe(400);
    expect((await passwordOf(id))?.passwordHash).toBe(oldHash);
  });

  it('refuses every try with 429 from the fifth wrong one in 15 minutes, the right password too', async () => {
    const id = await person();
    const laptop = await device();
    for (let i = 0; i < 5; i++) {
      await change(laptop, { currentPassword: WRONG, newPassword: NEW }).expect(
        401,
      );
    }

    const res = await change(laptop, {
      currentPassword: OLD,
      newPassword: NEW,
    });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too_many_attempts');
    expect((await passwordOf(id))?.passwordHash).toBe(oldHash);
  });

  it('keeps refusing until 15 minutes after the last counted failure', async () => {
    await person();
    const laptop = await device();
    for (let i = 0; i < 5; i++) {
      await change(laptop, { currentPassword: WRONG, newPassword: NEW });
    }
    const [key] = await redis.keys('auth:password:*');

    const ttl = await redis.ttl(key ?? '');

    expect(ttl).toBeGreaterThan(14 * 60);
    expect(ttl).toBeLessThanOrEqual(15 * 60);
  });

  it('clears the count after a change', async () => {
    await person();
    const laptop = await device();
    for (let i = 0; i < 4; i++) {
      await change(laptop, { currentPassword: WRONG, newPassword: NEW });
    }
    await change(laptop, { currentPassword: OLD, newPassword: NEW }).expect(
      204,
    );

    for (let i = 0; i < 4; i++) {
      await change(laptop, {
        currentPassword: WRONG,
        newPassword: OLD,
      }).expect(401);
    }
    await change(laptop, { currentPassword: NEW, newPassword: OLD }).expect(
      204,
    );
  });

  it('keeps no account id in clear in Redis', async () => {
    const id = await person();
    const laptop = await device();
    await change(laptop, { currentPassword: WRONG, newPassword: NEW });

    const keys = await redis.keys('*');

    expect(keys.join()).not.toContain(id);
  });

  it.each([
    ['7 characters', 'scurta7'],
    ['129 characters', 'a'.repeat(129)],
    ['a common password', 'password1'],
  ])(
    'refuses %s with 400 weak_password on newPassword, changing nothing',
    async (_, weak) => {
      const id = await person();
      const laptop = await device();

      const res = await change(laptop, {
        currentPassword: OLD,
        newPassword: weak,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('weak_password');
      expect(res.body.errors).toEqual([
        { code: 'weak_password', field: 'newPassword' },
      ]);
      expect((await passwordOf(id))?.passwordHash).toBe(oldHash);
    },
  );

  it('answers 401 sign_in_required without the session cookie', async () => {
    const id = await person();
    const laptop = await device();

    const res = await change(
      { bearer: laptop.bearer },
      { currentPassword: OLD, newPassword: NEW },
    );

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
    expect((await passwordOf(id))?.passwordHash).toBe(oldHash);
  });

  it('answers 401 sign_in_required for a session already signed out', async () => {
    const id = await person();
    const laptop = await device();
    await http()
      .post('/auth/sign-out')
      .set('Cookie', laptop.cookie)
      .expect(204);

    const res = await change(laptop, {
      currentPassword: OLD,
      newPassword: NEW,
    });

    expect(res.status).toBe(401);
    expect((await passwordOf(id))?.passwordHash).toBe(oldHash);
  });

  it("answers 401 for another account's session cookie, changing neither", async () => {
    const id = await person();
    const other = await person('ioana@example.test');
    const laptop = await device();
    const theirs = await device('ioana@example.test');

    const res = await change(
      { bearer: laptop.bearer, cookie: theirs.cookie },
      { currentPassword: OLD, newPassword: NEW },
    );

    expect(res.status).toBe(401);
    expect((await passwordOf(id))?.passwordHash).toBe(oldHash);
    expect((await familiesOf(other)).size).toBe(1);
  });

  it('answers 401 sign_in_required to a call with no access token', async () => {
    await person();
    const laptop = await device();

    const res = await change(
      { cookie: laptop.cookie },
      { currentPassword: OLD, newPassword: NEW },
    );

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('refuses a suspended account with 403 account_suspended', async () => {
    const id = await person();
    const laptop = await device();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await change(laptop, {
      currentPassword: OLD,
      newPassword: NEW,
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
  });

  it('is not something an assistant can do for the account', async () => {
    const id = await person();
    const laptop = await device();
    const changes = app.get(PasswordChangeService);

    await expect(
      changes.change(
        { ...actorOf(id), via: 'assistant' },
        laptop.cookie.split('=')[1],
        { currentPassword: OLD, newPassword: NEW },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await passwordOf(id))?.passwordHash).toBe(oldHash);
  });

  it('never writes a password to a log line, a notification or the audit history', async () => {
    const id = await person();
    const laptop = await device();
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          lines.push(JSON.stringify(args));
        });
    }

    await change(laptop, { currentPassword: WRONG, newPassword: NEW });
    await change(laptop, { currentPassword: OLD, newPassword: 'scurta7' });
    await change(laptop, { currentPassword: OLD, newPassword: NEW });

    await until('the notice', async () => (await notices(id)).length > 0);
    const stored = JSON.stringify(
      [
        lines,
        await prisma.notification.findMany(),
        await prisma.activityLog.findMany(),
        await prisma.outboxEvent.findMany(),
      ],
      (_, value) => (typeof value === 'bigint' ? String(value) : value),
    );
    for (const secret of [OLD, NEW, WRONG, 'scurta7']) {
      expect(stored).not.toContain(secret);
    }
  });
});

describe('setting a password on an account that has none', () => {
  it('creates the password identity for the account e-mail after a recent sign-in', async () => {
    const id = await account('ioana');
    const laptop = await opened(id);

    const res = await change(laptop, { newPassword: NEW });

    expect(res.status).toBe(204);
    const identity = await passwordOf(id);
    expect(identity?.subject).toBe('ioana@example.test');
    expect(identity?.passwordHash).toMatch(/^\$argon2id\$/);
    await signIn('ioana@example.test', NEW).expect(200);
    const methods = await prisma.accountIdentity.findMany({
      where: { accountId: id },
    });
    expect(methods.map((i) => i.method).sort()).toEqual(['google', 'password']);
  });

  it('ends the other sessions, records it and sends the notice, as a change does', async () => {
    const id = await account('ioana');
    const laptop = await opened(id);
    const phone = await opened(id);

    await change(laptop, { newPassword: NEW }).expect(204);

    await refresh(phone).expect(401);
    await refresh(laptop).expect(200);
    expect(await auditOf(id)).toHaveLength(1);
    expect(await eventsOf(id)).toEqual([
      expect.objectContaining({ kind: 'account.password_changed' }),
    ]);
    await until('the notice', async () => (await notices(id)).length > 0);
    expect(await notices(id)).toHaveLength(1);
  });

  it('accepts a session opened 9 minutes ago', async () => {
    const id = await account('ioana');
    const laptop = await opened(id);
    await openedAgo(id, 9);

    await change(laptop, { newPassword: NEW }).expect(204);
  });

  it('answers 403 recent_sign_in_required for a session opened over 10 minutes ago', async () => {
    const id = await account('ioana');
    const laptop = await opened(id);
    await openedAgo(id, 11);

    const res = await change(laptop, { newPassword: NEW });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('recent_sign_in_required');
    expect(await passwordOf(id)).toBeNull();
    expect(await auditOf(id)).toEqual([]);
  });

  it('reads the opening time from the first token of the family, not its latest renewal', async () => {
    const id = await account('ioana');
    const opening = await opened(id);
    await openedAgo(id, 11);
    const renewed = await refresh(opening).expect(200);

    const res = await change(
      { bearer: opening.bearer, cookie: cookieOf(renewed) },
      { newPassword: NEW },
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('recent_sign_in_required');
  });

  it('answers 409 email_required for an account with no e-mail', async () => {
    const id = await account('ioana', ['driver'], { email: null });
    const laptop = await opened(id);

    const res = await change(laptop, { newPassword: NEW });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_required');
    expect(await passwordOf(id)).toBeNull();
  });

  it('refuses a weak password with 400 weak_password', async () => {
    const id = await account('ioana');
    const laptop = await opened(id);

    const res = await change(laptop, { newPassword: 'scurta7' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('weak_password');
    expect(await passwordOf(id)).toBeNull();
  });
});

import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import { hashToken } from './email-confirmation';
import { MAINTENANCE } from './maintenance';
import * as password from './password';
import { PasswordResetModule } from './password-reset.module';
import { PasswordResetService } from './password-reset.service';
import { serialDatabase } from './serial-db.testing';
import { SESSION_EVENTS, SignInService } from './sign-in.service';
import { AuditService } from '../audit/audit.service';
import { noEvents } from '../events/event.port';
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
const check = (token: unknown) =>
  http().post('/auth/password-reset/check').send({ token });
const complete = (token: unknown, newPassword: unknown = NEW) =>
  http()
    .post('/auth/password-reset/complete')
    .send({ password: newPassword, token });
const signIn = (email: string, secret: string) =>
  http()
    .post('/auth/sign-in')
    .set('X-Forwarded-For', address())
    .send({ email, password: secret });

// The link is issued after the 202, so every read of what it writes waits for it.
async function resetEmails(accountId: string, purpose = 'password_reset') {
  await resets.drain();
  return prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: {
      accountId,
      channel: 'email',
      kind: 'ACCOUNT_EMAIL',
      params: { equals: purpose, path: ['purpose'] },
    },
  });
}

async function lastLink(accountId: string): Promise<string> {
  const last = (await resetEmails(accountId)).at(-1);
  if (!last) throw new Error('no reset e-mail queued');
  return String((last.params as { link: string }).link);
}

const tokenOf = (link: string) => link.split('/').at(-1) ?? '';

async function linkFor(accountId: string, email = 'andrei@example.test') {
  await ask(email).expect(202);
  return tokenOf(await lastLink(accountId));
}

const later = (ms: number) => {
  const at = Date.now() + ms;
  resets.now = () => new Date(at);
};

function cookieOf(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith('mf_refresh='));
}

const refreshWith = (res: request.Response) =>
  http()
    .post('/auth/refresh')
    .set('Cookie', cookieOf(res)?.split(';')[0] ?? '');

const MINUTE = 60_000;

const holds: (() => void)[] = [];
afterEach(() => {
  for (const release of holds.splice(0)) release();
});

// Holds every account e-mail until the returned release is called, or the
// test ends.
function holdResetEmails(): () => void {
  const notifications = app.get(NotificationsService);
  // The unspied method, so a second hold does not wrap the first.
  const send =
    NotificationsService.prototype.sendAccountEmail.bind(notifications);
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

// Waits up to two seconds for something the request set going in the background.
async function settled(done: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 40 && !(await done()); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// @traces 127-FR-001 127-FR-002 127-FR-003
describe('asking for a reset link', () => {
  it('answers 202 with no body and queues the link in the account language', async () => {
    const id = await person();
    const res = await ask('andrei@example.test').expect(202);
    expect(res.text).toBe('');
    const rows = await resetEmails(id);
    expect(rows).toHaveLength(1);
    expect(await lastLink(id)).toMatch(
      /^https:\/\/motorfix\.test\/ro\/reset-password\/[A-Za-z0-9_-]{43}$/,
    );
  });

  it('writes the link of an English account in English', async () => {
    const id = await person('ann@example.test', { language: 'en' });
    await ask('ann@example.test').expect(202);
    expect(await lastLink(id)).toMatch(/\/en\/reset-password\//);
  });

  it('finds the account whatever the case and spaces of the address', async () => {
    const id = await person();
    await ask('  Andrei@Example.TEST ').expect(202);
    expect(await resetEmails(id)).toHaveLength(1);
  });

  it('answers the same for an address no account uses, and queues nothing', async () => {
    await person();
    const known = await ask('andrei@example.test').expect(202);
    const unknown = await ask('nimeni@example.test').expect(202);
    expect(unknown.text).toBe(known.text);
    await resets.drain();
    expect(
      await prisma.notification.count({ where: { channel: 'email' } }),
    ).toBe(1);
    expect(await prisma.accountToken.count()).toBe(1);
  });

  it.each(['suspended', 'deleted'] as const)(
    'sends nothing to a %s account',
    async (status) => {
      const id = await account('ioana', ['driver'], { status });
      await ask('ioana@example.test').expect(202);
      expect(await resetEmails(id)).toHaveLength(0);
      expect(await prisma.accountToken.count()).toBe(0);
    },
  );

  it('keeps only the hash of a 60-minute token', async () => {
    const id = await person();
    const before = Date.now();
    const token = await linkFor(id);
    const rows = await prisma.accountToken.findMany({
      where: { accountId: id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'andrei@example.test',
      purpose: 'password_reset',
      tokenHash: hashToken(token),
      usedAt: null,
    });
    const ttl = (rows[0]?.expiresAt.getTime() ?? 0) - before;
    expect(ttl).toBeGreaterThanOrEqual(60 * MINUTE - 1000);
    expect(ttl).toBeLessThanOrEqual(60 * MINUTE + 5000);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('voids the older unused link when a new one is asked for', async () => {
    const id = await person();
    const first = await linkFor(id);
    const second = await linkFor(id);
    expect(second).not.toBe(first);
    await check(first)
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('token_invalid'));
    await check(second).expect(204);
  });

  it('leaves the e-mail confirmation link of the account alone', async () => {
    const id = await person();
    await prisma.accountToken.create({
      data: {
        accountId: id,
        email: 'andrei@example.test',
        expiresAt: new Date(Date.now() + 60 * MINUTE),
        purpose: 'email_confirm',
        tokenHash: hashToken('confirmation'),
      },
    });
    await linkFor(id);
    expect(
      await prisma.accountToken.count({ where: { purpose: 'email_confirm' } }),
    ).toBe(1);
  });

  it.each([
    ['no e-mail', {}],
    ['a malformed e-mail', { email: 'not-an-address' }],
    ['a number', { email: 42 }],
  ])('answers 400 validation_failed for %s', async (_name, body) => {
    const res = await http()
      .post('/auth/password-reset')
      .set('X-Forwarded-For', address())
      .send(body);
    expect(res.status).toBe(400);
  });

  it('refuses a form post that is not JSON', async () => {
    await http()
      .post('/auth/password-reset')
      .type('form')
      .send('email=andrei%40example.test')
      .expect(415);
  });

  it('sends at most 3 links an hour for one e-mail, answering the same', async () => {
    const id = await person();
    for (let i = 0; i < 4; i++) await ask('andrei@example.test').expect(202);
    expect(await resetEmails(id)).toHaveLength(3);
  });

  it('counts the e-mail the same whatever its case and spaces', async () => {
    const id = await person();
    await ask('andrei@example.test').expect(202);
    await ask('ANDREI@example.test').expect(202);
    await ask(' andrei@EXAMPLE.test').expect(202);
    await ask('Andrei@Example.Test').expect(202);
    expect(await resetEmails(id)).toHaveLength(3);
  });

  it('sends at most 10 an hour from one address, unknown addresses counted', async () => {
    const id = await person();
    const from = '203.0.113.7';
    for (let i = 0; i < 10; i++) {
      await ask(`nimeni${i}@example.test`, from).expect(202);
    }
    await ask('andrei@example.test', from).expect(202);
    expect(await resetEmails(id)).toHaveLength(0);
    await ask('andrei@example.test').expect(202);
    expect(await resetEmails(id)).toHaveLength(1);
  });

  it('keeps neither the e-mail nor the address in clear in Redis', async () => {
    await person();
    await ask('andrei@example.test', '203.0.113.9').expect(202);
    const keys = await redis.keys('*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('andrei');
      expect(key).not.toContain('203.0.113.9');
    }
  });

  // @traces 568-FR-002
  it('logs that PUBLIC_WEB_URL is missing when it cannot build the link', async () => {
    await person();
    const options = (resets as unknown as { options: { webUrl?: string } })
      .options;
    options.webUrl = undefined;
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await ask('andrei@example.test').expect(202);
      await resets.drain();
    } finally {
      options.webUrl = webUrl;
    }
    expect(JSON.stringify(logged.mock.calls)).toContain(
      'PUBLIC_WEB_URL is not set',
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain('andrei');
  });

  // @traces 568-FR-002
  it('answers 202 and logs, without the address, when the e-mail cannot be queued', async () => {
    await person();
    jest
      .spyOn(app.get(NotificationsService), 'sendAccountEmail')
      .mockRejectedValue(new Error('Redis did not answer'));
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await ask('andrei@example.test').expect(202);
    await resets.drain();
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain('andrei');
  });

  // @traces 568-FR-001 568-FR-002
  it('answers 202 before the link is issued, then issues it', async () => {
    const id = await person();
    const release = holdResetEmails();
    await ask('andrei@example.test').timeout(2000).expect(202);
    expect(await prisma.notification.count()).toBe(0);
    release();
    expect(await resetEmails(id)).toHaveLength(1);
    expect(await prisma.accountToken.count({ where: { accountId: id } })).toBe(
      1,
    );
  });

  // @traces 568-FR-003
  it('waits, on shutdown, for a link still being issued', async () => {
    const id = await person();
    const release = holdResetEmails();
    await ask('andrei@example.test').timeout(2000).expect(202);
    let closed = false;
    const closing = resets.beforeApplicationShutdown().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closed).toBe(false);
    release();
    await closing;
    const queued = await prisma.notification.findMany({
      where: {
        accountId: id,
        channel: 'email',
        params: { equals: 'password_reset', path: ['purpose'] },
      },
    });
    expect(queued).toHaveLength(1);
  });

  // @traces 568-FR-003
  it('waits, on shutdown, for a link asked for while it was waiting', async () => {
    const first = await person('ana@example.test');
    const second = await person('ion@example.test');
    const releaseFirst = holdResetEmails();
    await ask('ana@example.test').timeout(2000).expect(202);
    const sending = jest.mocked(app.get(NotificationsService).sendAccountEmail);
    while (sending.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    let closed = false;
    const closing = resets.beforeApplicationShutdown().then(() => {
      closed = true;
    });
    const releaseSecond = holdResetEmails();
    await ask('ion@example.test').timeout(2000).expect(202);
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closed).toBe(false);
    releaseSecond();
    await closing;
    for (const id of [first, second]) {
      const queued = await prisma.notification.findMany({
        where: {
          accountId: id,
          channel: 'email',
          params: { equals: 'password_reset', path: ['purpose'] },
        },
      });
      expect(queued).toHaveLength(1);
    }
  });
});

// @traces 127-FR-004
describe('checking a link', () => {
  it('answers 204 for a link that works', async () => {
    const id = await person();
    await check(await linkFor(id)).expect(204);
  });

  it('answers 410 token_expired after 60 minutes', async () => {
    const id = await person();
    const token = await linkFor(id);
    later(60 * MINUTE + 1000);
    const res = await check(token).expect(410);
    expect(res.body.code).toBe('token_expired');
  });

  it('answers 410 token_expired for a link already used', async () => {
    const id = await person();
    const token = await linkFor(id);
    await complete(token).expect(200);
    const res = await check(token).expect(410);
    expect(res.body.code).toBe('token_expired');
  });

  it.each([
    ['a malformed token', 'abc'],
    ['an unknown token', 'A'.repeat(43)],
  ])('answers 410 token_invalid for %s', async (_name, token) => {
    const res = await check(token).expect(410);
    expect(res.body.code).toBe('token_invalid');
  });

  it('answers 400 for a token that is not a string', async () => {
    await check(42).expect(400);
  });

  it('answers 410 token_invalid for an e-mail confirmation token', async () => {
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
    const res = await check('B'.repeat(43)).expect(410);
    expect(res.body.code).toBe('token_invalid');
  });

  it.each(['suspended', 'deleted'] as const)(
    'answers 410 token_invalid once the account is %s',
    async (status) => {
      const id = await person();
      const token = await linkFor(id);
      await prisma.account.update({ data: { status }, where: { id } });
      const res = await check(token).expect(410);
      expect(res.body.code).toBe('token_invalid');
    },
  );

  it('answers 410 token_invalid once the account address changed', async () => {
    const id = await person();
    const token = await linkFor(id);
    await prisma.account.update({
      data: { email: 'altul@example.test' },
      where: { id },
    });
    const res = await check(token).expect(410);
    expect(res.body.code).toBe('token_invalid');
  });

  it('answers 410 token_invalid when the account holds no role it can use', async () => {
    const id = await person();
    const token = await linkFor(id);
    await prisma.accountRole.deleteMany({ where: { accountId: id } });
    const res = await check(token).expect(410);
    expect(res.body.code).toBe('token_invalid');
  });

  it('does not use the link up', async () => {
    const id = await person();
    const token = await linkFor(id);
    await check(token).expect(204);
    await check(token).expect(204);
    await complete(token).expect(200);
  });
});

// @traces 127-FR-005 127-FR-006 127-FR-007
describe('completing a reset', () => {
  it('replaces the password: the new one signs in and the old one does not', async () => {
    const id = await person();
    await complete(await linkFor(id)).expect(200);
    await signIn('andrei@example.test', NEW).expect(200);
    const old = await signIn('andrei@example.test', OLD).expect(401);
    expect(old.body.code).toBe('invalid_credentials');
  });

  it('signs this device in for the last role, remembered, as sign-in does', async () => {
    const id = await person();
    const res = await complete(await linkFor(id)).expect(200);
    expect(res.body).toEqual({ accessToken: expect.any(String) });
    const cookie = cookieOf(res) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth|Path=\/auth/);
    await refreshWith(res).expect(200);
  });

  it('ends every other session of the account', async () => {
    const id = await person();
    const before = await signIn('andrei@example.test', OLD).expect(200);
    await complete(await linkFor(id)).expect(200);
    await refreshWith(before).expect(401);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      1,
    );
  });

  it('uses the link up', async () => {
    const id = await person();
    const token = await linkFor(id);
    await complete(token).expect(200);
    const again = await complete(token, 'inca-o-parola-noua').expect(410);
    expect(again.body.code).toBe('token_expired');
    await signIn('andrei@example.test', NEW).expect(200);
  });

  it('adds a password to an account that signed up with Google', async () => {
    const id = await account('ioana');
    await complete(await linkFor(id, 'ioana@example.test')).expect(200);
    await signIn('ioana@example.test', NEW).expect(200);
    const identities = await prisma.accountIdentity.findMany({
      where: { accountId: id },
    });
    expect(identities.map((i) => i.method).sort()).toEqual([
      'google',
      'password',
    ]);
  });

  it('writes one audit entry without any password data', async () => {
    const id = await person();
    const token = await linkFor(id);
    await complete(token).expect(200);
    const entries = await prisma.activityLog.findMany({
      where: { kind: 'password_reset', subjectId: id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: id,
      field: 'password',
      subjectType: 'account',
    });
    const text = JSON.stringify(entries);
    expect(text).not.toContain(NEW);
    expect(text).not.toContain(token);
    expect(text).not.toContain('argon2');
    expect(entries[0]?.oldValue ?? null).toBeNull();
    expect(entries[0]?.newValue ?? null).toBeNull();
  });

  it('e-mails the account that its password was changed', async () => {
    const id = await person();
    await complete(await linkFor(id)).expect(200);
    await settled(
      async () => (await resetEmails(id, 'password_changed')).length > 0,
    );
    expect(await resetEmails(id, 'password_changed')).toHaveLength(1);
  });

  it('tells the account open dashboards to sign out', async () => {
    const id = await person();
    await complete(await linkFor(id)).expect(200);
    const events = () =>
      published.map((m) => JSON.parse(m) as Record<string, unknown>);
    await settled(() => events().length > 0);
    expect(events()).toContainEqual(
      expect.objectContaining({
        audience: [`account:${id}`],
        event: expect.objectContaining({ kind: 'session.revoked' }),
      }),
    );
  });

  it('still answers 200 when the changed-password e-mail cannot be queued', async () => {
    const id = await person();
    const token = await linkFor(id);
    jest
      .spyOn(app.get(NotificationsService), 'sendAccountEmail')
      .mockRejectedValue(new Error('Redis did not answer'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await complete(token).expect(200);
    await signIn('andrei@example.test', NEW).expect(200);
  });

  it('still answers 200 when the other tabs cannot be told', async () => {
    const id = await person();
    const token = await linkFor(id);
    jest
      .spyOn(app.get(SESSION_EVENTS), 'publish')
      .mockRejectedValue(new Error('Redis did not answer'));
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await complete(token).expect(200);
    await settled(() => warn.mock.calls.length > 0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('session.revoked not sent'),
    );
  });

  // The password is already changed: the holder hears of it all the same.
  it('e-mails and signs out the other tabs even when no session opens', async () => {
    const id = await person();
    const token = await linkFor(id);
    jest
      .spyOn(app.get(SignInService), 'openSession')
      .mockRejectedValue(new Error('Redis did not answer'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await complete(token).expect(500);
    expect(await resetEmails(id, 'password_changed')).toHaveLength(1);
    await settled(() => published.length > 0);
    expect(published.join()).toContain('session.revoked');
  });

  it.each([
    ['7 characters', 'a'.repeat(7)],
    ['129 characters', 'a'.repeat(129)],
    ['a common password', 'password123'],
  ])(
    'refuses %s with weak_password and changes nothing',
    async (_name, weak) => {
      const id = await person();
      const token = await linkFor(id);
      const res = await complete(token, weak).expect(400);
      expect(res.body.code).toBe('weak_password');
      expect(res.body.errors).toEqual([
        { code: 'weak_password', field: 'password' },
      ]);
      await signIn('andrei@example.test', OLD).expect(200);
      await check(token).expect(204);
    },
  );

  it('counts 8 emoji as 8 characters', async () => {
    const id = await person();
    await complete(await linkFor(id), '🔑🚗🔧🛞🪛🧰🛠️⛽').expect(200);
  });

  it('answers 410 before judging the password of an expired link', async () => {
    const id = await person();
    const token = await linkFor(id);
    later(61 * MINUTE);
    const res = await complete(token, 'short').expect(410);
    expect(res.body.code).toBe('token_expired');
    await signIn('andrei@example.test', OLD).expect(200);
  });

  it('answers 410 token_invalid for a link never issued', async () => {
    const res = await complete('C'.repeat(43)).expect(410);
    expect(res.body.code).toBe('token_invalid');
  });

  it('answers 400 for a body without a password', async () => {
    const id = await person();
    const token = await linkFor(id);
    await http()
      .post('/auth/password-reset/complete')
      .send({ token })
      .expect(400);
    await check(token).expect(204);
  });

  it('refuses a non-admin with 503 maintenance, changing nothing', async () => {
    const id = await person();
    const token = await linkFor(id);
    maintenance = true;
    const res = await complete(token).expect(503);
    expect(res.body.code).toBe('maintenance');
    maintenance = false;
    await signIn('andrei@example.test', OLD).expect(200);
    await check(token).expect(204);
  });

  it('lets an admin reset during maintenance', async () => {
    const id = await person('admin@example.test', { roles: ['admin'] });
    const token = await linkFor(id, 'admin@example.test');
    maintenance = true;
    await complete(token).expect(200);
  });

  it('lets only one of two saves of one link at once change the password', async () => {
    const id = await person();
    const token = await linkFor(id);
    const [a, b] = await Promise.all([
      complete(token, 'prima-parola-noua'),
      complete(token, 'a-doua-parola-noua'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
    const loser = a.status === 410 ? a : b;
    expect(loser.body.code).toBe('token_expired');
    const winner =
      a.status === 200 ? 'prima-parola-noua' : 'a-doua-parola-noua';
    await signIn('andrei@example.test', winner).expect(200);
    expect(
      await prisma.activityLog.count({
        where: { kind: 'password_reset', subjectId: id },
      }),
    ).toBe(1);
  });

  it('refuses a form post that is not JSON', async () => {
    await http()
      .post('/auth/password-reset/complete')
      .type('form')
      .send(`token=${'D'.repeat(43)}&password=${NEW}`)
      .expect(415);
  });
});

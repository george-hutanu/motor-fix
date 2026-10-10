import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { hashToken, newToken } from './email-confirmation';
import { EmailConfirmationModule } from './email-confirmation.module';
import { EmailConfirmationService } from './email-confirmation.service';
import { NotificationsModule } from '../../notifications/notifications.module';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { until } from '../../waits.testing';
import { signAccessToken } from '../access-token';
import { AUTH_REDIS } from '../attempts';
import { AuthModule } from '../auth.module';
import { EmailChangeService } from '../email-change/email-change.service';
import { serialDatabase } from '../serial-db.testing';

const redisUrl = redisUrlFor(9);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const redis = new Redis(redisUrl);
const subscriber = new Redis(redisUrl);
const published: string[] = [];
let app: NestExpressApplication;
let confirmations: EmailConfirmationService;

beforeAll(async () => {
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
  confirmations = app.get(EmailConfirmationService);
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
  confirmations.now = () => new Date();
  jest.restoreAllMocks();
});

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;
const PASSWORD = 'o-parola-lunga';

const http = () => request(app.getHttpServer());

async function signUp(
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; accessToken: string }> {
  const res = await http()
    .post('/auth/sign-up')
    .set('X-Forwarded-For', address())
    .send({
      consent: CURRENT_CONSENT,
      email: 'andrei@example.test',
      language: 'ro',
      name: 'Andrei Marin',
      password: PASSWORD,
      ...overrides,
    })
    .expect(201);
  const { id } = await prisma.account.findUniqueOrThrow({
    select: { id: true },
    where: { email: String(overrides['email'] ?? 'andrei@example.test') },
  });
  return { accessToken: res.body.accessToken, id };
}

const confirmationEmails = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, channel: 'email', kind: 'ACCOUNT_EMAIL' },
  });

async function lastLink(accountId: string): Promise<string> {
  const rows = await confirmationEmails(accountId);
  const last = rows.at(-1);
  if (!last) throw new Error('no confirmation e-mail queued');
  return String((last.params as { link: string }).link);
}

const tokenOf = (link: string) => link.split('/').at(-1) ?? '';

const confirm = (token: unknown) =>
  http().post('/auth/confirm-email').send({ token });
const resendByToken = (token: unknown) =>
  http().post('/auth/confirm-email/resend').send({ token });
const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, tokenSecret)}`;
const resendFor = (accountId: string) =>
  http().post('/me/email-confirmation').set('Authorization', bearer(accountId));

const verifiedAt = async (id: string) =>
  (
    await prisma.account.findUniqueOrThrow({
      select: { emailVerifiedAt: true },
      where: { id },
    })
  ).emailVerifiedAt;

const later = (ms: number) => {
  const at = Date.now() + ms;
  confirmations.now = () => new Date(at);
};

// An unconfirmed account made directly, not through sign-up.
async function unconfirmed(name = 'ioana', language: 'ro' | 'en' = 'ro') {
  const id = await account(name, ['driver'], { language });
  await prisma.account.update({
    data: { emailVerifiedAt: null },
    where: { id },
  });
  return id;
}

describe('signing up', () => {
  it('queues one confirmation e-mail in the account language with the link', async () => {
    const { id } = await signUp();
    const rows = await confirmationEmails(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.params).toMatchObject({ purpose: 'email_check' });
    expect(await lastLink(id)).toMatch(
      /^https:\/\/motorfix\.test\/ro\/confirm-email\/[A-Za-z0-9_-]{43}$/,
    );
  });

  it('writes the link of an English account in English', async () => {
    const { id } = await signUp({
      email: 'ann@example.test',
      language: 'en',
    });
    expect(await lastLink(id)).toMatch(/\/en\/confirm-email\//);
  });

  it('keeps only the hash of the token', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const rows = await prisma.accountToken.findMany({
      where: { accountId: id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'andrei@example.test',
      purpose: 'email_confirm',
      tokenHash: hashToken(token),
      usedAt: null,
    });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('still creates and signs in the account when the e-mail cannot be queued', async () => {
    jest
      .spyOn(app.get(NotificationsService), 'sendAccountEmail')
      .mockRejectedValue(new Error('Redis did not answer'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { accessToken, id } = await signUp();
    expect(accessToken).toEqual(expect.any(String));
    expect(await verifiedAt(id)).toBeNull();
  });
});

describe('confirming', () => {
  it('marks the address confirmed, records it and tells the account live', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const res = await confirm(token).expect(200);
    expect(res.body).toEqual({ status: 'confirmed' });
    expect(await verifiedAt(id)).toBeInstanceOf(Date);
    const entries = await prisma.activityLog.findMany({
      where: { field: 'email_verified_at', subjectId: id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: id,
      subjectType: 'account',
    });
    await until('the live announcement', () =>
      published.some((m) => m.includes('account.email_confirmed')),
    );
    expect(
      published.map((m) => JSON.parse(m) as Record<string, unknown>),
    ).toContainEqual({
      audience: [`account:${id}`],
      event: expect.objectContaining({
        id,
        kind: 'account.email_confirmed',
      }),
    });
    expect(published.join()).not.toContain('andrei@example.test');
  });

  it('answers confirmed again for a used link of a confirmed address, writing nothing', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await confirm(token).expect(200);
    const first = await verifiedAt(id);
    await confirm(token).expect(200, { status: 'confirmed' });
    expect(await verifiedAt(id)).toEqual(first);
    expect(
      await prisma.activityLog.count({
        where: { field: 'email_verified_at', subjectId: id },
      }),
    ).toBe(1);
  });

  it('confirms once when the same link is opened twice at once', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const answers = await Promise.all([confirm(token), confirm(token)]);
    expect(answers.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await prisma.activityLog.count({
        where: { field: 'email_verified_at', subjectId: id },
      }),
    ).toBe(1);
  });

  it('refuses a link older than 72 hours', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    later(72 * 60 * 60 * 1000 + 1000);
    const res = await confirm(token).expect(410);
    expect(res.body.code).toBe('link_expired');
    expect(await verifiedAt(id)).toBeNull();
  });

  it('accepts a link just inside its 72 hours', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    later(72 * 60 * 60 * 1000 - 60_000);
    await confirm(token).expect(200);
  });

  it('refuses a link voided by a newer one', async () => {
    const { id } = await signUp();
    const old = tokenOf(await lastLink(id));
    await resendFor(id).expect(202);
    const res = await confirm(old).expect(410);
    expect(res.body.code).toBe('link_expired');
    await confirm(tokenOf(await lastLink(id))).expect(200);
  });

  it('refuses a link that was never issued', async () => {
    const res = await confirm(newToken().token).expect(410);
    expect(res.body.code).toBe('link_expired');
  });

  it('refuses a link made for an address the account no longer has', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await prisma.account.update({
      data: { email: 'altul@example.test' },
      where: { id },
    });
    await confirm(token).expect(410);
    expect(await verifiedAt(id)).toBeNull();
  });

  it('refuses the link of a suspended account', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });
    await confirm(token).expect(410);
    expect(await verifiedAt(id)).toBeNull();
  });

  it('refuses a malformed token as a validation failure', async () => {
    for (const token of ['', 'short', 42, null, `${'a'.repeat(42)}=`]) {
      const res = await confirm(token);
      expect(res.status).toBe(400);
    }
  });

  it('needs no sign-in', async () => {
    const { id } = await signUp();
    await confirm(tokenOf(await lastLink(id))).expect(200);
  });
});

describe('asking for a new link from an expired one', () => {
  it('sends a new link to the address and voids the old one', async () => {
    const { id } = await signUp();
    const old = tokenOf(await lastLink(id));
    later(73 * 60 * 60 * 1000);
    await resendByToken(old).expect(202);
    const fresh = tokenOf(await lastLink(id));
    expect(fresh).not.toBe(old);
    expect(await confirmationEmails(id)).toHaveLength(2);
    await confirm(old).expect(410);
    await confirm(fresh).expect(200);
  });

  it('sends a new link from a link a newer one voided', async () => {
    const { id } = await signUp();
    const old = tokenOf(await lastLink(id));
    await resendFor(id).expect(202);
    await confirm(old).expect(410);
    await redis.del(`auth:confirm:minute:${id}`);
    await resendByToken(old).expect(202);
    expect(await confirmationEmails(id)).toHaveLength(3);
  });

  it('refuses when the address is already confirmed', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await confirm(token).expect(200);
    const res = await resendByToken(token).expect(409);
    expect(res.body.code).toBe('email_already_confirmed');
    expect(await confirmationEmails(id)).toHaveLength(1);
  });

  it('refuses a token that was never issued', async () => {
    const res = await resendByToken(newToken().token).expect(410);
    expect(res.body.code).toBe('link_expired');
  });

  it('refuses a token of an address the account no longer has', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await prisma.account.update({
      data: { email: 'altul@example.test' },
      where: { id },
    });
    await resendByToken(token).expect(410);
    expect(await confirmationEmails(id)).toHaveLength(1);
  });
});

describe('asking for a new link while signed in', () => {
  it('sends a new link to an unconfirmed address', async () => {
    const id = await unconfirmed('ioana', 'en');
    await resendFor(id).expect(202);
    expect(await lastLink(id)).toMatch(/\/en\/confirm-email\//);
  });

  it('refuses a confirmed address', async () => {
    const id = await account('maria');
    const res = await resendFor(id).expect(409);
    expect(res.body.code).toBe('email_already_confirmed');
  });

  it('refuses an account with no e-mail', async () => {
    const id = await account('fara', ['driver'], { email: null });
    const res = await resendFor(id).expect(409);
    expect(res.body.code).toBe('no_email');
  });

  it('needs a sign-in', async () => {
    await http().post('/me/email-confirmation').expect(401);
  });

  it('allows one link a minute', async () => {
    const id = await unconfirmed();
    await resendFor(id).expect(202);
    const res = await resendFor(id).expect(429);
    expect(res.body.code).toBe('too_many_attempts');
    expect(await confirmationEmails(id)).toHaveLength(1);
  });

  it('allows five links an hour', async () => {
    const id = await unconfirmed();
    for (let i = 0; i < 5; i++) {
      await resendFor(id).expect(202);
      await redis.del(`auth:confirm:minute:${id}`);
    }
    await resendFor(id).expect(429);
    expect(await confirmationEmails(id)).toHaveLength(5);
  });

  it('does not count the link sent at sign-up', async () => {
    const { id } = await signUp();
    await resendFor(id).expect(202);
  });

  it('shares the limit with the expired-link page', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await resendByToken(token).expect(202);
    await resendFor(id).expect(429);
  });

  it('does not count a refused ask', async () => {
    const id = await account('maria');
    await resendFor(id).expect(409);
    await prisma.account.update({
      data: { emailVerifiedAt: null },
      where: { id },
    });
    await resendFor(id).expect(202);
  });
});

describe('the signed-in account', () => {
  it('says whether its e-mail is confirmed', async () => {
    const { id } = await signUp();
    const before = await http()
      .get('/me')
      .set('Authorization', bearer(id))
      .expect(200);
    expect(before.body.emailConfirmed).toBe(false);
    await confirm(tokenOf(await lastLink(id))).expect(200);
    const after = await http()
      .get('/me')
      .set('Authorization', bearer(id))
      .expect(200);
    expect(after.body.emailConfirmed).toBe(true);
  });

  it('is unconfirmed when it has no e-mail', async () => {
    const id = await account('fara', ['driver'], { email: null });
    const res = await http()
      .get('/me')
      .set('Authorization', bearer(id))
      .expect(200);
    expect(res.body).toMatchObject({ email: null, emailConfirmed: false });
  });
});

describe('with Redis down', () => {
  const down = () => {
    const client = app.get<Redis>(AUTH_REDIS);
    jest.spyOn(client, 'multi').mockImplementation(() => {
      const chain = {
        decr: () => chain,
        exec: () => Promise.reject(new Error('Connection is closed.')),
        expire: () => chain,
        incr: () => chain,
      };
      return chain as unknown as ReturnType<Redis['multi']>;
    });
    jest
      .spyOn(client, 'publish')
      .mockRejectedValue(new Error('Connection is closed.'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  };

  it('still sends a new link, without the limit', async () => {
    const id = await unconfirmed();
    down();
    await resendFor(id).expect(202);
    await resendFor(id).expect(202);
    expect(await confirmationEmails(id)).toHaveLength(2);
  });

  it('still confirms, without the live announcement', async () => {
    const { id } = await signUp();
    down();
    await confirm(tokenOf(await lastLink(id))).expect(200);
    expect(await verifiedAt(id)).not.toBeNull();
    // Long enough for a wrong announcement to arrive.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(
      published.filter((m) => m.includes('account.email_confirmed')),
    ).toEqual([]);
  });
});

const NEW = 'andrei.nou@example.test';
const DAY_MS = 24 * 60 * 60 * 1000;

// The change's own clock moves with the confirmation's.
const laterAll = (ms: number) => {
  later(ms);
  app.get(EmailChangeService).now = confirmations.now;
};

beforeEach(() => {
  app.get(EmailChangeService).now = () => new Date();
});

const askChange = (accountId: string, email = NEW) =>
  http()
    .post('/me/email')
    .set('Authorization', bearer(accountId))
    .send({ email });

// The link of the latest change, as queued for the new address.
async function changeLink(accountId: string): Promise<string> {
  const rows = await confirmationEmails(accountId);
  const last = rows
    .filter((row) => (row.params as { to?: string }).to !== undefined)
    .at(-1);
  if (!last) throw new Error('no change link queued');
  return String((last.params as { link: string }).link);
}

const changeLinks = async (accountId: string) =>
  (await confirmationEmails(accountId)).filter(
    (row) => (row.params as { to?: string }).to !== undefined,
  );

const accountOf = (id: string) =>
  prisma.account.findUniqueOrThrow({
    select: { email: true, emailVerifiedAt: true },
    where: { id },
  });

const signInWith = (email: string) =>
  http()
    .post('/auth/sign-in')
    .set('X-Forwarded-For', address())
    .send({ email, password: PASSWORD });

// @traces 139-edit-my-details-FR-008
describe('opening the link of an e-mail change', () => {
  it('sets the new address, confirmed now, and records it with one event', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);
    const before = Date.now();

    const res = await confirm(tokenOf(await changeLink(id))).expect(200);

    expect(res.body).toEqual({ status: 'confirmed' });
    const saved = await accountOf(id);
    expect(saved.email).toBe(NEW);
    expect(saved.emailVerifiedAt?.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    const entries = await prisma.activityLog.findMany({
      where: { field: 'email', subjectId: id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: id,
      newValue: NEW,
      oldValue: 'andrei@example.test',
    });
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'account.updated', subjectId: id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ fields: ['email'] });
  });

  it('moves the password sign-in to the new address', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);

    await confirm(tokenOf(await changeLink(id))).expect(200);

    await signInWith(NEW).expect(200);
    await signInWith('andrei@example.test').expect(401);
    const identity = await prisma.accountIdentity.findFirstOrThrow({
      where: { accountId: id, method: 'password' },
    });
    expect(identity.subject).toBe(NEW);
  });

  it('clears the pending address from who am I', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);

    await confirm(tokenOf(await changeLink(id))).expect(200);

    const me = await http()
      .get('/me')
      .set('Authorization', bearer(id))
      .expect(200);
    expect(me.body).toMatchObject({
      email: NEW,
      emailConfirmed: true,
      pendingEmail: null,
    });
  });

  it('answers confirmed again for a link already used, writing nothing more', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);
    const token = tokenOf(await changeLink(id));
    await confirm(token).expect(200);

    await confirm(token).expect(200, { status: 'confirmed' });

    expect(
      await prisma.activityLog.count({
        where: { field: 'email', subjectId: id },
      }),
    ).toBe(1);
  });

  it('changes once when the same link is opened twice at once', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);
    const token = tokenOf(await changeLink(id));

    const answers = await Promise.all([confirm(token), confirm(token)]);

    expect(answers.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await prisma.activityLog.count({
        where: { field: 'email', subjectId: id },
      }),
    ).toBe(1);
  });
});

// @traces 139-edit-my-details-FR-009
describe('a change link that no longer works', () => {
  it('refuses a link older than 24 hours and keeps the address', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);
    const token = tokenOf(await changeLink(id));
    laterAll(DAY_MS + 1000);

    const res = await confirm(token).expect(410);

    expect(res.body.code).toBe('link_expired');
    expect((await accountOf(id)).email).toBe('andrei@example.test');
  });

  it('accepts a link just inside its 24 hours', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);
    const token = tokenOf(await changeLink(id));
    laterAll(DAY_MS - 60_000);

    await confirm(token).expect(200);
  });

  it('refuses a link voided by a newer change', async () => {
    const { id } = await signUp();
    await askChange(id, 'prima@example.test').expect(202);
    const old = tokenOf(await changeLink(id));
    await askChange(id).expect(202);

    const res = await confirm(old).expect(410);

    expect(res.body.code).toBe('link_expired');
    expect((await accountOf(id)).email).toBe('andrei@example.test');
  });

  it('answers 409 email_taken when the address was taken meanwhile, and keeps the old one', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);
    const token = tokenOf(await changeLink(id));
    await account('altcineva', ['driver'], { email: NEW });

    const res = await confirm(token).expect(409);

    expect(res.body.code).toBe('email_taken');
    expect((await accountOf(id)).email).toBe('andrei@example.test');
    expect(
      await prisma.activityLog.count({
        where: { field: 'email', subjectId: id },
      }),
    ).toBe(0);
  });

  it.each(['suspended', 'deleted'] as const)(
    'writes nothing for a %s account',
    async (status) => {
      const { id } = await signUp();
      await askChange(id).expect(202);
      const token = tokenOf(await changeLink(id));
      await prisma.account.update({ data: { status }, where: { id } });

      await confirm(token).expect(410);

      expect((await accountOf(id)).email).toBe('andrei@example.test');
    },
  );

  it('sends a new link to the same address from the latest expired link and voids it', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);
    const old = tokenOf(await changeLink(id));
    laterAll(DAY_MS + 1000);

    await resendByToken(old).expect(202);

    const links = await changeLinks(id);
    expect(links).toHaveLength(2);
    expect(links[1]?.params).toMatchObject({ to: NEW });
    const fresh = tokenOf(await changeLink(id));
    expect(fresh).not.toBe(old);
    await confirm(old).expect(410);
    await confirm(fresh).expect(200);
    expect((await accountOf(id)).email).toBe(NEW);
  });

  it('sends nothing from a link that is not the latest', async () => {
    const { id } = await signUp();
    await askChange(id, 'prima@example.test').expect(202);
    const old = tokenOf(await changeLink(id));
    await askChange(id).expect(202);

    const res = await resendByToken(old).expect(410);

    expect(res.body.code).toBe('link_expired');
    expect(await changeLinks(id)).toHaveLength(2);
  });

  it('sends nothing when the address was taken meanwhile', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);
    const token = tokenOf(await changeLink(id));
    await account('altcineva', ['driver'], { email: NEW });

    await resendByToken(token).expect(410);

    expect(await changeLinks(id)).toHaveLength(1);
  });

  it('sends nothing from a link already used', async () => {
    const { id } = await signUp();
    await askChange(id).expect(202);
    const token = tokenOf(await changeLink(id));
    await confirm(token).expect(200);

    await resendByToken(token).expect(410);

    expect(await changeLinks(id)).toHaveLength(1);
  });

  it('counts toward the five links of the hour', async () => {
    const { id } = await signUp();
    for (let i = 1; i <= 5; i++) {
      await askChange(id, `nou${i}@example.test`).expect(202);
    }
    const token = tokenOf(await changeLink(id));

    const res = await resendByToken(token).expect(429);

    expect(res.body.code).toBe('too_many_attempts');
    expect(await changeLinks(id)).toHaveLength(5);
  });
});

// @traces 139-edit-my-details-FR-010
// @traces 139-edit-my-details-FR-012
describe('asking again from the panel', () => {
  it('sends a new link to the pending address and voids the older one', async () => {
    const { id } = await signUp();
    await confirm(tokenOf(await lastLink(id))).expect(200);
    await askChange(id).expect(202);
    const old = tokenOf(await changeLink(id));

    await resendFor(id).expect(202);

    const links = await changeLinks(id);
    expect(links).toHaveLength(2);
    expect(links[1]?.params).toMatchObject({ to: NEW });
    await confirm(old).expect(410);
    await confirm(tokenOf(await changeLink(id))).expect(200);
  });

  it('sends to the current unconfirmed address when no change waits', async () => {
    const id = await unconfirmed();

    await resendFor(id).expect(202);

    const rows = await confirmationEmails(id);
    expect(rows).toHaveLength(1);
    expect(
      (rows[0]?.params as { to?: string } | undefined)?.to,
    ).toBeUndefined();
  });

  it('shares the five links of the hour with the change itself', async () => {
    const { id } = await signUp();
    await confirm(tokenOf(await lastLink(id))).expect(200);
    for (let i = 1; i <= 5; i++) {
      await askChange(id, `nou${i}@example.test`).expect(202);
    }

    const res = await resendFor(id).expect(429);

    expect(res.body.code).toBe('too_many_attempts');
    expect(await changeLinks(id)).toHaveLength(5);
  });

  it('counts a re-send to the current address toward the same five', async () => {
    const id = await unconfirmed();
    for (let i = 0; i < 5; i++) {
      await resendFor(id).expect(202);
      await redis.del(`auth:confirm:minute:${id}`);
      await redis.del(`auth:confirm:hour:${id}`);
    }

    const res = await resendFor(id).expect(429);

    expect(res.body.code).toBe('too_many_attempts');
  });
});

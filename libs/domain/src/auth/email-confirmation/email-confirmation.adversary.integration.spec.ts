import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { EmailConfirmationModule } from './email-confirmation.module';
import { EmailConfirmationService } from './email-confirmation.service';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { signAccessToken } from '../access-token';
import { AuthModule } from '../auth.module';
import { serialDatabase } from '../serial-db.testing';

const redisUrl = redisUrlFor(8);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const redis = new Redis(redisUrl);
let app: NestExpressApplication;
let confirmations: EmailConfirmationService;

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
  confirmations = app.get(EmailConfirmationService);
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.flushdb();
  confirmations.now = () => new Date();
  jest.restoreAllMocks();
});

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;
const PASSWORD = 'o-parola-lunga';

const http = () => request(app.getHttpServer());

async function signUp(
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  await http()
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
  return { id };
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
const rawPost = (route: string, raw: string, type = 'application/json') =>
  http().post(route).set('Content-Type', type).send(raw);
const meOf = (id: string) =>
  http().get('/me').set('Authorization', bearer(id)).expect(200);

const verifiedAt = async (id: string) =>
  (
    await prisma.account.findUniqueOrThrow({
      select: { emailVerifiedAt: true },
      where: { id },
    })
  ).emailVerifiedAt;

const auditEntries = (id: string) =>
  prisma.activityLog.count({
    where: { field: 'email_verified_at', subjectId: id },
  });

const liveTokens = (accountId: string) =>
  prisma.accountToken.count({
    where: {
      accountId,
      expiresAt: { gt: new Date() },
      purpose: 'email_confirm',
      usedAt: null,
    },
  });

async function unconfirmed(name = 'ioana') {
  const id = await account(name, ['driver']);
  await prisma.account.update({
    data: { emailVerifiedAt: null },
    where: { id },
  });
  return id;
}

const swapCase = (s: string) =>
  [...s]
    .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
    .join('');

describe('a tampered token', () => {
  it('is refused when its letter case is swapped', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const swapped = swapCase(token);
    expect(swapped).not.toBe(token);
    const res = await confirm(swapped).expect(410);
    expect(res.body.code).toBe('link_expired');
    expect(await verifiedAt(id)).toBeNull();
  });

  it('is refused when its last character is replaced by another', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    for (const last of ['A', 'B', 'Q', 'g', 'w', '-', '_']) {
      if (last === token.at(-1)) continue;
      await confirm(token.slice(0, -1) + last).expect(410);
    }
    expect(await verifiedAt(id)).toBeNull();
    await confirm(token).expect(200);
  });

  it('is refused on both routes when one character in the middle is changed', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const flipped =
      token.slice(0, 20) + (token[20] === 'A' ? 'B' : 'A') + token.slice(21);
    await confirm(flipped).expect(410);
    await resendByToken(flipped).expect(410);
    expect(await confirmationEmails(id)).toHaveLength(1);
  });

  it('is refused as malformed when padded or cut', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    for (const bad of [
      ` ${token}`,
      `${token} `,
      `${token}\n`,
      `${token}\0`,
      `${token}A`,
      token.slice(1),
    ]) {
      await confirm(bad).expect(400);
      await resendByToken(bad).expect(400);
    }
    expect(await verifiedAt(id)).toBeNull();
  });

  it('is refused as malformed when it uses look-alike unicode characters', async () => {
    for (const bad of [
      'А'.repeat(43),
      `${'A'.repeat(42)}Ａ`,
      `${'A'.repeat(42)}\u{1F600}`,
    ]) {
      await confirm(bad).expect(400);
    }
  });

  it('is refused as malformed when it is in the standard base64 form', async () => {
    await confirm(`${'A'.repeat(41)}+/`).expect(400);
    await confirm(`${'A'.repeat(42)}=`).expect(400);
  });

  it('is refused when it is the stored hash of a real token', async () => {
    const { id } = await signUp();
    const row = await prisma.accountToken.findFirstOrThrow({
      where: { accountId: id },
    });
    const asToken = Buffer.from(row.tokenHash, 'hex')
      .toString('base64url')
      .padEnd(43, 'A')
      .slice(0, 43);
    await confirm(asToken).expect(410);
    await confirm(row.tokenHash.slice(0, 43)).expect(410);
    expect(await verifiedAt(id)).toBeNull();
  });

  it('answers expired for a well-formed token that was never issued', async () => {
    const res = await confirm('A'.repeat(43)).expect(410);
    expect(res.body.code).toBe('link_expired');
  });
});

describe('a hostile request body', () => {
  it('is refused with an extra field next to the token', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const res = await http()
      .post('/auth/confirm-email')
      .send({ accountId: id, token });
    expect(res.status).toBe(400);
    expect(await verifiedAt(id)).toBeNull();
  });

  it('is refused on the resend route with an extra field next to the token', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await http()
      .post('/auth/confirm-email/resend')
      .send({ email: 'x@example.test', token })
      .expect(400);
    expect(await confirmationEmails(id)).toHaveLength(1);
  });

  it('is refused when the token is an array, an object, a boolean, a number or missing', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    for (const bad of [
      [token],
      [token, token],
      { value: token },
      true,
      0,
      undefined,
    ]) {
      expect((await confirm(bad)).status).toBe(400);
      expect((await resendByToken(bad)).status).toBe(400);
    }
    expect(await verifiedAt(id)).toBeNull();
  });

  it('is refused when the whole body is an array, a string, empty or absent', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    for (const route of ['/auth/confirm-email', '/auth/confirm-email/resend']) {
      expect((await http().post(route).send([{ token }])).status).toBe(400);
      expect((await http().post(route).send({})).status).toBe(400);
      // No body at all is not JSON: 415.
      expect([400, 415]).toContain((await http().post(route)).status);
      expect((await rawPost(route, '"x"')).status).toBe(400);
    }
    expect(await verifiedAt(id)).toBeNull();
  });

  it.each([
    ['__proto__', '"__proto__":{"token":"x"}'],
    ['constructor', '"constructor":{"prototype":{"x":1}}'],
    ['prototype', '"prototype":1'],
  ])('is refused when a %s key rides along', async (_name, extra) => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const res = await rawPost(
      '/auth/confirm-email',
      `{"token":"${token}",${extra}}`,
    );
    expect(res.status).toBe(400);
    expect(await verifiedAt(id)).toBeNull();
    expect(Object.hasOwn(Object.prototype, 'token')).toBe(false);
  });

  it('is refused when the token sits under a prototype key only', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const res = await rawPost(
      '/auth/confirm-email',
      `{"__proto__":{"token":"${token}"}}`,
    );
    expect(res.status).toBe(400);
    expect(await verifiedAt(id)).toBeNull();
  });

  it('is refused when the token key repeats and the last value is bad', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const res = await rawPost(
      '/auth/confirm-email',
      `{"token":"${token}","token":"short"}`,
    );
    expect(res.status).toBe(400);
    expect(await verifiedAt(id)).toBeNull();
  });

  it('is refused when the token is a very long string', async () => {
    expect((await confirm('A'.repeat(100_000))).status).toBe(400);
    const huge = await confirm('A'.repeat(5_000_000));
    expect([400, 413]).toContain(huge.status);
  });

  it('is refused when the token arrives in the query string, or plain text', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    expect([400, 415]).toContain(
      (await http().post(`/auth/confirm-email?token=${token}`)).status,
    );
    expect(
      (
        await rawPost(
          '/auth/confirm-email',
          `{"token":"${token}"}`,
          'text/plain',
        )
      ).status,
    ).toBe(415);
    expect(await verifiedAt(id)).toBeNull();
  });

  it('is refused as malformed JSON with a client error', async () => {
    const res = await rawPost('/auth/confirm-email', '{"token": ');
    expect(res.status).toBe(400);
  });

  it('does not confirm through a GET of the route', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    expect((await http().get(`/auth/confirm-email/${token}`)).status).toBe(404);
    expect(
      (await http().get('/auth/confirm-email').query({ token })).status,
    ).toBe(404);
    expect(await verifiedAt(id)).toBeNull();
  });
});

describe('a signed-in ask', () => {
  it('sends a link only to the signed-in account when the body names another', async () => {
    const mine = await unconfirmed('ioana');
    const other = await unconfirmed('radu');
    const res = await http()
      .post('/me/email-confirmation')
      .set('Authorization', bearer(mine))
      .send({ accountId: other, email: 'radu@example.test' });
    expect([202, 400]).toContain(res.status);
    expect(await confirmationEmails(other)).toHaveLength(0);
  });

  it('is refused with a bearer token signed by another secret', async () => {
    const id = await unconfirmed();
    const forged = signAccessToken(
      { accountId: id, role: 'driver' },
      'another-secret',
    );
    await http()
      .post('/me/email-confirmation')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
    expect(await confirmationEmails(id)).toHaveLength(0);
  });

  it('is refused with a garbage authorization header', async () => {
    for (const header of [
      'Bearer',
      'Bearer ',
      'Bearer a.b.c',
      'Basic abc',
      'bearer',
    ]) {
      const res = await http()
        .post('/me/email-confirmation')
        .set('Authorization', header);
      expect(res.status).toBe(401);
    }
  });
});

describe('a link after a second account takes the address', () => {
  async function handOver() {
    const first = await signUp({ email: 'shared@example.test' });
    const token = tokenOf(await lastLink(first.id));
    await prisma.account.update({
      data: { email: 'moved@example.test' },
      where: { id: first.id },
    });
    await prisma.accountIdentity.updateMany({
      data: { subject: 'moved@example.test' },
      where: { accountId: first.id },
    });
    const second = await signUp({
      email: 'shared@example.test',
      name: 'Second Owner',
    });
    return { first, second, token };
  }

  it('confirms neither account', async () => {
    const { first, second, token } = await handOver();
    const res = await confirm(token).expect(410);
    expect(res.body.code).toBe('link_expired');
    expect(await verifiedAt(first.id)).toBeNull();
    expect(await verifiedAt(second.id)).toBeNull();
  });

  it('sends no new link to either account from the old token', async () => {
    const { first, second, token } = await handOver();
    const before = (await confirmationEmails(second.id)).length;
    await resendByToken(token).expect(410);
    expect(await confirmationEmails(first.id)).toHaveLength(1);
    expect(await confirmationEmails(second.id)).toHaveLength(before);
  });

  it('leaves the second account link working and the first account link dead', async () => {
    const { first, second, token } = await handOver();
    await confirm(tokenOf(await lastLink(second.id))).expect(200);
    expect(await verifiedAt(second.id)).toBeInstanceOf(Date);
    await confirm(token).expect(410);
    expect(await verifiedAt(first.id)).toBeNull();
  });

  it('reports only the second account as confirmed', async () => {
    const { first, second, token } = await handOver();
    await confirm(tokenOf(await lastLink(second.id))).expect(200);
    await confirm(token).expect(410);
    expect((await meOf(first.id)).body.emailConfirmed).toBe(false);
    expect((await meOf(second.id)).body.emailConfirmed).toBe(true);
  });
});

describe('a link of an account that is gone', () => {
  it('is refused as expired when the account is deleted, writing nothing', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await prisma.account.update({ data: { status: 'deleted' }, where: { id } });
    const res = await confirm(token).expect(410);
    expect(res.body.code).toBe('link_expired');
    expect(await verifiedAt(id)).toBeNull();
    expect(await auditEntries(id)).toBe(0);
  });

  it('is refused as expired when a deleted account asks for a new link by it', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await prisma.account.update({ data: { status: 'deleted' }, where: { id } });
    await resendByToken(token).expect(410);
    expect(await confirmationEmails(id)).toHaveLength(1);
  });

  it('is refused as expired even when the deleted account was already confirmed', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await confirm(token).expect(200);
    await prisma.account.update({ data: { status: 'deleted' }, where: { id } });
    await confirm(token).expect(410);
    await resendByToken(token).expect(410);
  });

  it('is refused as expired when the token rows are gone', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await prisma.accountToken.deleteMany({ where: { accountId: id } });
    await confirm(token).expect(410);
    await resendByToken(token).expect(410);
  });

  it('queues no link when a deleted account asks while signed in', async () => {
    const id = await unconfirmed();
    await prisma.account.update({ data: { status: 'deleted' }, where: { id } });
    const res = await resendFor(id);
    expect(res.status).not.toBe(202);
    expect(res.status).toBeLessThan(500);
    expect(await confirmationEmails(id)).toHaveLength(0);
  });

  it('queues no link when a suspended account asks by its token', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });
    await resendByToken(token).expect(410);
    expect(await confirmationEmails(id)).toHaveLength(1);
  });
});

describe('asking for new links in a flood', () => {
  it('sends exactly one link when many asks arrive at the same moment', async () => {
    const id = await unconfirmed();
    const answers = await Promise.all(
      Array.from({ length: 20 }, () => resendFor(id)),
    );
    const statuses = answers.map((r) => r.status);
    expect(statuses.filter((s) => s === 202)).toHaveLength(1);
    expect(statuses.filter((s) => s === 429)).toHaveLength(19);
    expect(await confirmationEmails(id)).toHaveLength(1);
  });

  it('sends exactly one link when the asks mix the token and signed-in routes', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const answers = await Promise.all([
      ...Array.from({ length: 6 }, () => resendByToken(token)),
      ...Array.from({ length: 6 }, () => resendFor(id)),
    ]);
    const statuses = answers.map((r) => r.status);
    expect(statuses.filter((s) => s === 202)).toHaveLength(1);
    expect(statuses.filter((s) => s !== 202 && s !== 429 && s !== 410)).toEqual(
      [],
    );
    expect(await confirmationEmails(id)).toHaveLength(2);
  });

  it('stops at five an hour when the minute window is cleared between bursts', async () => {
    const id = await unconfirmed();
    let sent = 0;
    for (let round = 0; round < 7; round++) {
      await redis.del(`auth:confirm:minute:${id}`);
      const answers = await Promise.all(
        Array.from({ length: 4 }, () => resendFor(id)),
      );
      sent += answers.filter((r) => r.status === 202).length;
    }
    expect(sent).toBe(5);
    expect(await confirmationEmails(id)).toHaveLength(5);
  });

  it('keeps the limit of one account from throttling another', async () => {
    const a = await unconfirmed('ioana');
    const b = await unconfirmed('radu');
    await resendFor(a).expect(202);
    await resendFor(a).expect(429);
    await resendFor(b).expect(202);
  });

  it('answers 429 with a code and sends nothing when the token route is over the limit', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    await resendByToken(token).expect(202);
    const fresh = tokenOf(await lastLink(id));
    // A voided link still leads to a new one, so it meets the limit too.
    await resendByToken(token).expect(429);
    const res = await resendByToken(fresh).expect(429);
    expect(res.body.code).toBe('too_many_attempts');
    expect(await confirmationEmails(id)).toHaveLength(2);
  });

  it('answers 409 and not 429 for a confirmed address even when the limit is spent', async () => {
    const { id } = await signUp();
    await resendFor(id).expect(202);
    await confirm(tokenOf(await lastLink(id))).expect(200);
    const res = await resendFor(id).expect(409);
    expect(res.body.code).toBe('email_already_confirmed');
  });
});

describe('links issued in a burst', () => {
  it('leaves only the newest of several links working', async () => {
    const { id } = await signUp();
    const tokens = [tokenOf(await lastLink(id))];
    for (let i = 0; i < 4; i++) {
      await redis.del(`auth:confirm:minute:${id}`);
      await resendFor(id).expect(202);
      tokens.push(tokenOf(await lastLink(id)));
    }
    expect(new Set(tokens).size).toBe(5);
    for (const old of tokens.slice(0, -1)) {
      const res = await confirm(old).expect(410);
      expect(res.body.code).toBe('link_expired');
    }
    expect(await verifiedAt(id)).toBeNull();
    await confirm(tokens.at(-1)).expect(200);
  });

  it('keeps one live token per account after a burst', async () => {
    const { id } = await signUp();
    for (let i = 0; i < 3; i++) {
      await redis.del(`auth:confirm:minute:${id}`);
      await resendFor(id).expect(202);
    }
    expect(await liveTokens(id)).toBe(1);
  });

  it('never repeats a token across accounts', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const { id } = await signUp({ email: `burst${i}@example.test` });
      seen.add(tokenOf(await lastLink(id)));
    }
    expect(seen.size).toBe(8);
  });

  it('writes nothing when a voided link is opened after a newer link confirmed', async () => {
    const { id } = await signUp();
    const old = tokenOf(await lastLink(id));
    await resendFor(id).expect(202);
    await confirm(tokenOf(await lastLink(id))).expect(200);
    const first = await verifiedAt(id);
    await confirm(old).expect(200, { status: 'confirmed' });
    expect(await verifiedAt(id)).toEqual(first);
    expect(await auditEntries(id)).toBe(1);
  });

  it('confirms once and writes one audit entry when ten opens race', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => confirm(token)),
    );
    expect(answers.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await auditEntries(id)).toBe(1);
  });

  it('writes one audit entry when an old and a new link are opened together', async () => {
    const { id } = await signUp();
    const old = tokenOf(await lastLink(id));
    await resendFor(id).expect(202);
    const fresh = tokenOf(await lastLink(id));
    const [a, b] = await Promise.all([confirm(old), confirm(fresh)]);
    expect(b.status).toBe(200);
    expect([200, 410]).toContain(a.status);
    expect(await auditEntries(id)).toBe(1);
  });
});

describe('the account answer', () => {
  it('reports a boolean and no token material', async () => {
    const { id } = await signUp();
    const token = tokenOf(await lastLink(id));
    const row = await prisma.accountToken.findFirstOrThrow({
      where: { accountId: id },
    });
    const res = await meOf(id);
    expect(res.body.emailConfirmed).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toContain(row.tokenHash);
  });

  it('is unconfirmed when the address is removed', async () => {
    const id = await account('maria');
    expect((await meOf(id)).body.emailConfirmed).toBe(true);
    await prisma.account.update({
      data: { email: null, emailVerifiedAt: null },
      where: { id },
    });
    expect((await meOf(id)).body).toMatchObject({
      email: null,
      emailConfirmed: false,
    });
  });
});

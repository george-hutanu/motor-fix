import { CURRENT_CONSENT } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuditService } from '../../audit/audit.service';
import { noEvents } from '../../events/event.port';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { until } from '../../waits.testing';
import { AccountsService } from '../accounts.service';
import { AuthModule } from '../auth.module';
import { hashPassword } from '../password/password';
import { PasswordResetModule } from '../password/password-reset/password-reset.module';
import { PhoneSignInModule } from '../phone-sign-in/phone-sign-in.module';
import { serialDatabase } from '../serial-db.testing';
import { SignInService } from '../sign-in.service';

const redisUrl = redisUrlFor(11);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const PASSWORD = 'parola-de-test';
const EMAIL = 'andrei@example.test';
const MINUTE = 60_000;
const { prisma, reset } = fixtures();
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
const subscriber = new Redis(redisUrl);
const redis = new Redis(redisUrl);
const published: string[] = [];
let app: NestExpressApplication;
let hash: string;

beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
  await brevo.start();
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
      PhoneSignInModule.register({
        brevo: { apiKey: 'test-key', apiUrl: brevo.url },
        phone: testPhoneConfig({
          PHONE_ALLOWLIST: '+407*',
          WHATSAPP_TEMPLATES:
            'motorfix_sign_in_code_ro=21,motorfix_sign_in_code_en=22',
        }),
      }),
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
  await brevo.stop();
  redis.disconnect();
  subscriber.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.flushdb();
  brevo.reset();
  published.length = 0;
  jest.restoreAllMocks();
});

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;
const http = () => request(app.getHttpServer());

async function person(
  email = EMAIL,
  roles: Role[] = ['driver'],
  phone = '+40710000001',
) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    email,
    identity: { method: 'password', passwordHash: hash, subject: email },
    name: 'Andrei Ion Marin',
    roles,
  });
  await prisma.account.update({
    data: {
      city: 'Cluj-Napoca',
      emailBouncedAt: new Date(),
      emailVerifiedAt: new Date(),
      phone,
      phoneVerifiedAt: new Date(),
    },
    where: { id },
  });
  return id;
}

interface Device {
  bearer: string;
  cookie: string;
}

function setCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith('mf_refresh='));
}

const signIn = (email: string) =>
  http()
    .post('/auth/sign-in')
    .set('X-Forwarded-For', address())
    .send({ email, password: PASSWORD });

async function device(email = EMAIL): Promise<Device> {
  const res = await signIn(email).expect(200);
  return {
    bearer: `Bearer ${res.body.accessToken}`,
    cookie: setCookie(res)?.split(';')[0] ?? '',
  };
}

const remove = (from: Partial<Device>, body: Record<string, unknown>) => {
  const call = http().delete('/auth/account');
  if (from.bearer) call.set('Authorization', from.bearer);
  if (from.cookie) call.set('Cookie', from.cookie);
  return call.send(body);
};

// The session's family opened `minutes` ago, every row of it.
const openedAgo = (accountId: string, minutes: number) =>
  prisma.refreshToken.updateMany({
    data: { createdAt: new Date(Date.now() - minutes * MINUTE) },
    where: { accountId },
  });

const accountOf = (id: string) =>
  prisma.account.findUniqueOrThrow({ where: { id } });

const auditOf = (accountId: string) =>
  prisma.activityLog.findMany({
    where: { kind: 'account_deleted', subjectId: accountId },
  });

const eventsOf = (accountId: string, kind = 'account.deleted') =>
  prisma.outboxEvent.findMany({ where: { kind, subjectId: accountId } });

const farewells = () =>
  prisma.notification.findMany({
    where: {
      channel: 'email',
      kind: 'ACCOUNT_EMAIL',
      params: { equals: 'account_deleted', path: ['purpose'] },
    },
  });

// Every row the deletion removes, counted for one account.
async function leftOf(accountId: string) {
  const where = { where: { accountId } };
  return {
    accountRole: await prisma.accountRole.count(where),
    accountToken: await prisma.accountToken.count(where),
    assistantGrant: await prisma.assistantGrant.count(where),
    assistantSignInCode: await prisma.assistantSignInCode.count(where),
    identity: await prisma.accountIdentity.count(where),
    notificationPreference: await prisma.notificationPreference.count(where),
    phoneChange: await prisma.phoneChange.count(where),
    pushSubscription: await prisma.pushSubscription.count(where),
    refreshToken: await prisma.refreshToken.count(where),
  };
}

// One row in each table the deletion empties, beyond the sign-in's own.
async function everything(accountId: string) {
  const later = new Date(Date.now() + 60 * MINUTE);
  await prisma.accountToken.create({
    data: {
      accountId,
      email: EMAIL,
      expiresAt: later,
      purpose: 'email_confirm',
      tokenHash: `hash-${accountId}`,
    },
  });
  await prisma.phoneChange.create({
    data: {
      accountId,
      codeHash: 'code',
      expiresAt: later,
      phone: '+40710000002',
    },
  });
  await prisma.pushSubscription.create({
    data: {
      accountId,
      auth: 'a',
      endpoint: `https://push.example.test/${accountId}`,
      p256dh: 'p',
    },
  });
  await prisma.notificationPreference.create({
    data: { accountId, channel: 'email', enabled: false, type: 'NEWS' },
  });
  await prisma.assistantGrant.create({
    data: {
      accountId,
      canAct: true,
      canRead: true,
      clientId: 'client',
      clientName: 'Asistent',
    },
  });
  await prisma.assistantSignInCode.create({
    data: {
      accountId,
      clientId: 'client',
      codeHash: `code-${accountId}`,
      expiresAt: later,
      nonce: 'n',
      redirectUri: 'https://assistant.example.test/back',
    },
  });
}

async function owner(accountId: string, status = 'approved' as const) {
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${accountId}`, status },
  });
  await prisma.garageMember.create({
    data: { accountId, garageId: garage.id, role: 'owner' },
  });
  return garage;
}

const reader = countedMetrics();
const deletions = (outcome: string) =>
  counterTotal(reader, 'motorfix_account_deletions_total', { outcome });

const NAME = 'Andrei Ion Marin';

// Everything a refusal must leave exactly as it was.
async function snapshot(id: string) {
  return {
    account: await accountOf(id),
    audit: await auditOf(id),
    events: await prisma.outboxEvent.count(),
    farewells: (await farewells()).length,
    left: await leftOf(id),
    members: await prisma.garageMember.count({ where: { accountId: id } }),
    revoked: published.filter((m) => m.includes('session.revoked')).length,
  };
}

async function teamOf(
  accountId: string,
  role: 'mechanic' | 'receptionist',
  garageName = 'Atelier Dinamo',
) {
  const garage = await prisma.garage.create({
    data: {
      name: garageName,
      slug: `g-${accountId}-${role}-${garageName}`
        .toLowerCase()
        .replace(/ /g, '-'),
      status: 'approved',
    },
  });
  if (role === 'receptionist') {
    await prisma.garageMember.create({
      data: { accountId, garageId: garage.id, role },
    });
  } else {
    await prisma.mechanic.create({
      data: { accountId, garageId: garage.id, name: 'Elena', onProfile: true },
    });
  }
  return garage;
}

describe('the confirmation a deletion accepts', () => {
  it.each([
    ['a tab and a line break around it', `\t${EMAIL}\n`],
    ['the phone with spaces and a plus', '+40 710 000 001'],
    ['the phone with dashes', '+40-710-000-001'],
    ['the phone in the national form', '0710000001'],
  ])('takes %s', async (_, confirmation) => {
    const id = await person();

    const res = await remove(await device(), { confirmation });

    expect(res.status).toBe(204);
    expect((await accountOf(id)).status).toBe('deleted');
  });

  it.each([
    ['the e-mail with a character cut off', EMAIL.slice(0, -1)],
    ['the e-mail with a character added', `${EMAIL}m`],
    ['the e-mail in full-width letters', 'ａndrei@example.test'],
    ['the e-mail with a zero-width space inside', 'andrei@exa​mple.test'],
    ['the e-mail with a non-breaking space inside', 'andrei@example.test x'],
    ['the e-mail with a Turkish dotted capital', 'andreİ@example.test'],
    ['the name of the account', NAME],
    ['a different phone', '+40710000002'],
    ['the phone with a letter', '+4071000000a'],
    ['the delete word on an account that has an e-mail and a phone', 'ȘTERGE'],
    ['the delete word without its diacritic on such an account', 'STERGE'],
    ['a SQL wildcard', '%'],
    ['an e-mail pattern', 'andrei@example.test%'],
    ['a 254 character string', 'a'.repeat(254)],
  ])('refuses %s with 400 and changes nothing', async (_, confirmation) => {
    const id = await person();
    const phone = await device();
    const before = await snapshot(id);

    const res = await remove(phone, { confirmation });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(await snapshot(id)).toEqual(before);
  });

  it.each([
    ['a 255 character string', 'a'.repeat(255)],
    ['a number', 12345],
    ['null', null],
    ['an array holding the e-mail', [EMAIL]],
    ['an object', { value: EMAIL }],
    ['a boolean', true],
    ['an empty string', ''],
  ])('refuses %s with 400 and changes nothing', async (_, confirmation) => {
    const id = await person();
    const phone = await device();
    const before = await snapshot(id);

    const res = await remove(phone, { confirmation });

    expect(res.status).toBe(400);
    expect(await snapshot(id)).toEqual(before);
  });

  it.each([
    ['no body', {}],
    ['an extra field', { confirmation: EMAIL, force: true }],
  ])('refuses %s with 400 and changes nothing', async (_, body) => {
    const id = await person();
    const phone = await device();
    const before = await snapshot(id);

    const res = await remove(phone, body);

    expect(res.status).toBe(400);
    expect(await snapshot(id)).toEqual(before);
  });

  it('refuses the delete word from an account that holds only a phone', async () => {
    const id = await person();
    const phone = await device();
    await prisma.account.update({ data: { email: null }, where: { id } });

    const res = await remove(phone, { confirmation: 'DELETE' });

    expect(res.status).toBe(400);
    expect((await accountOf(id)).status).toBe('active');
  });

  it('refuses the delete word from an account that holds only an e-mail', async () => {
    const id = await person();
    const phone = await device();
    await prisma.account.update({ data: { phone: null }, where: { id } });

    const res = await remove(phone, { confirmation: 'ȘTERGE' });

    expect(res.status).toBe(400);
    expect((await accountOf(id)).status).toBe('active');
  });

  it("refuses another account's e-mail and phone, and leaves both accounts alone", async () => {
    const id = await person();
    const other = await person(
      'ioana@example.test',
      ['driver'],
      '+40710000002',
    );
    const phone = await device();

    for (const confirmation of ['ioana@example.test', '+40710000002']) {
      expect((await remove(phone, { confirmation })).status).toBe(400);
    }

    expect((await accountOf(id)).status).toBe('active');
    expect((await accountOf(other)).status).toBe('active');
  });

  it('sends a body that is not JSON to a 4xx and changes nothing', async () => {
    const id = await person();
    const phone = await device();

    const res = await http()
      .delete('/auth/account')
      .set('Authorization', phone.bearer)
      .set('Cookie', phone.cookie)
      .set('Content-Type', 'text/plain')
      .send(EMAIL);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await accountOf(id)).status).toBe('active');
  });
});

describe('every refusal leaves the account as it was', () => {
  it('changes nothing for a stale sign-in, whatever the confirmation', async () => {
    const id = await person();
    const phone = await device();
    await openedAgo(id, 16);
    const before = await snapshot(id);

    for (const confirmation of [EMAIL, 'wrong']) {
      const res = await remove(phone, { confirmation });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('reauth_required');
    }

    expect(await snapshot(id)).toEqual(before);
  });

  it('refuses a sign-in of exactly 16 minutes and takes one of 15 minutes less a second', async () => {
    const id = await person();
    const phone = await device();
    await openedAgo(id, 16);
    expect((await remove(phone, { confirmation: EMAIL })).status).toBe(401);

    await prisma.refreshToken.updateMany({
      data: { createdAt: new Date(Date.now() - 15 * MINUTE + 1000) },
      where: { accountId: id },
    });

    expect((await remove(phone, { confirmation: EMAIL })).status).toBe(204);
  });

  it('reads the age of the opening sign-in, not of a refresh since', async () => {
    const id = await person();
    const phone = await device();
    await openedAgo(id, 30);
    const refreshed = await http()
      .post('/auth/refresh')
      .set('Cookie', phone.cookie)
      .set('X-Forwarded-For', address());
    const renewed = setCookie(refreshed)?.split(';')[0];

    const res = await remove(
      { bearer: `Bearer ${refreshed.body.accessToken}`, cookie: renewed },
      { confirmation: EMAIL },
    );

    expect(refreshed.status).toBe(200);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('reauth_required');
    expect((await accountOf(id)).status).toBe('active');
  });

  it("refuses with a cookie that belongs to another account's session", async () => {
    const id = await person();
    await person('ioana@example.test', ['driver'], '+40710000002');
    const mine = await device();
    const theirs = await device('ioana@example.test');
    const before = await snapshot(id);

    const res = await remove(
      { bearer: mine.bearer, cookie: theirs.cookie },
      { confirmation: EMAIL },
    );

    expect(res.status).toBe(401);
    expect(await snapshot(id)).toEqual(before);
  });

  it('refuses with a garbage session cookie', async () => {
    const id = await person();
    const { bearer } = await device();

    const res = await remove(
      { bearer, cookie: 'mf_refresh=not-a-token' },
      { confirmation: EMAIL },
    );

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('reauth_required');
    expect((await accountOf(id)).status).toBe('active');
  });

  it('refuses a suspended account with 403 and changes nothing', async () => {
    const id = await person();
    const phone = await device();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });
    const before = await snapshot(id);

    const res = await remove(phone, { confirmation: EMAIL });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
    expect(await snapshot(id)).toEqual(before);
  });

  it('refuses an owner whose stale sign-in and wrong phrase would also fail, with 409 and no other counter moving', async () => {
    const id = await person(EMAIL, ['driver', 'garage']);
    await owner(id);
    const phone = await device();
    await openedAgo(id, 60);
    const before = await snapshot(id);
    const stale = await deletions('reauth_required');
    const mismatch = await deletions('mismatch');

    const res = await remove(phone, { confirmation: 'nope' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('deletion_not_allowed');
    expect(await snapshot(id)).toEqual(before);
    expect(await deletions('reauth_required')).toBe(stale);
    expect(await deletions('mismatch')).toBe(mismatch);
  });

  it('refuses an owner who is also a receptionist and a mechanic elsewhere, and keeps every membership', async () => {
    const id = await person(EMAIL, ['driver', 'garage']);
    await owner(id);
    await teamOf(id, 'receptionist', 'Service Nord');
    await teamOf(id, 'mechanic', 'Service Sud');
    const phone = await device();
    const before = await snapshot(id);

    const res = await remove(phone, { confirmation: EMAIL });

    expect(res.status).toBe(409);
    expect(await snapshot(id)).toEqual(before);
    expect(before.members).toBe(2);
    expect(await prisma.mechanic.count({ where: { accountId: id } })).toBe(1);
  });

  it('does not treat a receptionist of one garage and a mechanic of another as owners', async () => {
    const id = await person(EMAIL, ['driver', 'receptionist']);
    await teamOf(id, 'receptionist', 'Service Nord');
    await teamOf(id, 'mechanic', 'Service Sud');

    const res = await remove(await device(), { confirmation: EMAIL });

    expect(res.status).toBe(204);
  });

  it('lets an account through once its only garage membership is not an owner one, even after being an owner', async () => {
    const id = await person(EMAIL, ['driver', 'garage']);
    const garage = await owner(id);
    const phone = await device();
    expect((await remove(phone, { confirmation: EMAIL })).status).toBe(409);
    await prisma.garageMember.updateMany({
      data: { role: 'receptionist' },
      where: { accountId: id, garageId: garage.id },
    });

    expect((await remove(phone, { confirmation: EMAIL })).status).toBe(204);
  });

  it('rolls everything back and answers 500 when the audit write fails', async () => {
    const id = await person();
    const phone = await device();
    await everything(id);
    const before = await snapshot(id);
    const failed = await deletions('failed');
    jest
      .spyOn(AuditService.prototype, 'record')
      .mockRejectedValue(new Error('audit down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const res = await remove(phone, { confirmation: EMAIL });

    expect(res.status).toBe(500);
    expect(await snapshot(id)).toEqual(before);
    expect((await accountOf(id)).email).toBe(EMAIL);
    expect(await deletions('failed')).toBe(failed + 1);
  });

  it('answers 500 and counts failed when the token lookup throws', async () => {
    const id = await person();
    const phone = await device();
    const before = await snapshot(id);
    const failed = await deletions('failed');
    jest
      .spyOn(SignInService.prototype, 'sessionFamily')
      .mockRejectedValue(new Error('store down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const res = await remove(phone, { confirmation: EMAIL });

    expect(res.status).toBe(500);
    expect(res.body.code).not.toBe('reauth_required');
    expect(await snapshot(id)).toEqual(before);
    expect(await deletions('failed')).toBe(failed + 1);
  });
});

describe('two deletions at once', () => {
  it('lets exactly one win, with one audit entry, one event and one e-mail', async () => {
    const id = await person();
    const phone = await device();

    const results = await Promise.all([
      remove(phone, { confirmation: EMAIL }),
      remove(phone, { confirmation: EMAIL }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([204, 401]);
    expect(await auditOf(id)).toHaveLength(1);
    expect(await eventsOf(id)).toHaveLength(1);
    expect(await farewells()).toHaveLength(1);
    expect((await accountOf(id)).status).toBe('deleted');
  });

  it('lets exactly one win when two devices of the account delete at once', async () => {
    const id = await person();
    const first = await device();
    const second = await device();
    const deleted = await deletions('deleted');

    const results = await Promise.all([
      remove(first, { confirmation: EMAIL }),
      remove(second, { confirmation: '0710000001' }),
      remove(first, { confirmation: EMAIL }),
    ]);

    expect(results.map((r) => r.status).filter((s) => s === 204)).toHaveLength(
      1,
    );
    expect(
      results.filter((r) => r.status !== 204).every((r) => r.status === 401),
    ).toBe(true);
    expect(await auditOf(id)).toHaveLength(1);
    expect(await eventsOf(id)).toHaveLength(1);
    expect(await farewells()).toHaveLength(1);
    expect(await deletions('deleted')).toBe(deleted + 1);
  });

  it('announces the sign-out once when two requests race', async () => {
    await person();
    const phone = await device();

    await Promise.all([
      remove(phone, { confirmation: EMAIL }),
      remove(phone, { confirmation: EMAIL }),
    ]);
    await until('the live sign-out', () =>
      published.some((m) => m.includes('session.revoked')),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(published.filter((m) => m.includes('session.revoked'))).toHaveLength(
      1,
    );
  });

  it('answers 401 and changes no more when the same request is repeated after the first', async () => {
    const id = await person();
    const phone = await device();
    await remove(phone, { confirmation: EMAIL });

    const again = await remove(phone, { confirmation: EMAIL });

    expect(again.status).toBe(401);
    expect(await auditOf(id)).toHaveLength(1);
    expect(await eventsOf(id)).toHaveLength(1);
    expect(await farewells()).toHaveLength(1);
  });
});

describe('the session after the account is deleted', () => {
  it('rejects the old access token on this route and on another', async () => {
    await person();
    const phone = await device();
    await remove(phone, { confirmation: EMAIL });

    const route = await http()
      .post('/auth/roles/switch')
      .set('Authorization', phone.bearer)
      .send({ role: 'driver' });
    const again = await remove(
      { bearer: phone.bearer },
      { confirmation: EMAIL },
    );

    expect(route.status).toBe(401);
    expect(again.status).toBe(401);
  });

  it('rejects the access token of a second device of the same account', async () => {
    await person();
    const first = await device();
    const second = await device();
    await remove(first, { confirmation: EMAIL });

    const res = await http()
      .post('/auth/roles/switch')
      .set('Authorization', second.bearer)
      .send({ role: 'driver' });

    expect(res.status).toBe(401);
  });

  it('rejects the refresh cookie of every device', async () => {
    await person();
    const first = await device();
    const second = await device();
    await remove(first, { confirmation: EMAIL });

    for (const d of [first, second]) {
      const res = await http()
        .post('/auth/refresh')
        .set('Cookie', d.cookie)
        .set('X-Forwarded-For', address());
      expect(res.status).toBe(401);
    }
  });

  it('signs in with the former password as for an unknown account', async () => {
    await person();
    await remove(await device(), { confirmation: EMAIL });
    const unknown = await signIn('nobody@example.test');

    const res = await signIn(EMAIL);

    expect(res.status).toBe(unknown.status);
    expect(res.body).toEqual(unknown.body);
  });

  it('keeps the other accounts signed in', async () => {
    await person();
    await person('ioana@example.test', ['driver'], '+40710000002');
    const other = await device('ioana@example.test');
    await remove(await device(), { confirmation: EMAIL });

    const res = await http()
      .post('/auth/refresh')
      .set('Cookie', other.cookie)
      .set('X-Forwarded-For', address());

    expect(res.status).toBe(200);
  });

  it('lets a new sign-up with the former e-mail and phone both stand beside the deleted row', async () => {
    const id = await person();
    await remove(await device(), { confirmation: EMAIL });
    await http()
      .post('/auth/sign-up')
      .set('X-Forwarded-For', address())
      .send({
        consent: CURRENT_CONSENT,
        email: EMAIL,
        language: 'ro',
        name: 'Altcineva',
        password: PASSWORD,
      })
      .expect(201);

    expect(await accountOf(id)).toMatchObject({
      email: null,
      status: 'deleted',
    });
    const again = await device();
    expect(again.bearer).toMatch(/^Bearer /);
    expect(await prisma.account.count({ where: { email: EMAIL } })).toBe(1);
  });
});

describe('what a deletion leaves of the team and the events', () => {
  it('detaches the mechanic and records one mechanic.removed for the garage and the profile', async () => {
    const id = await person(EMAIL, ['driver', 'mechanic']);
    const garage = await teamOf(id, 'mechanic');

    expect((await remove(await device(), { confirmation: EMAIL })).status).toBe(
      204,
    );

    expect(
      await prisma.mechanic.findFirstOrThrow({
        where: { garageId: garage.id },
      }),
    ).toMatchObject({
      accountId: null,
      onProfile: false,
    });
    const events = await prisma.outboxEvent.findMany({
      where: {
        audience: { has: `garage:${garage.id}` },
        kind: 'mechanic.removed',
      },
    });
    expect(events).toHaveLength(1);
    // The card was on the profile, so the public streams hear it.
    expect(events[0].audience).toEqual(
      expect.arrayContaining([
        `garage:${garage.id}`,
        `public:garage:${garage.id}`,
      ]),
    );
  });

  it('records one member.removed for the garage a receptionist leaves', async () => {
    const id = await person(EMAIL, ['driver', 'receptionist']);
    const north = await teamOf(id, 'receptionist', 'Service Nord');

    expect((await remove(await device(), { confirmation: EMAIL })).status).toBe(
      204,
    );

    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'member.removed', subjectId: north.id },
    });
    expect(events.map((e) => e.audience)).toEqual([[`garage:${north.id}`]]);
    expect(await prisma.garageMember.count({ where: { accountId: id } })).toBe(
      0,
    );
  });

  it('does the driver clean-up event and the team leaving for one account', async () => {
    const id = await person(EMAIL, ['driver', 'mechanic', 'receptionist']);
    const south = await teamOf(id, 'mechanic', 'Service Sud');
    const north = await teamOf(id, 'receptionist', 'Service Nord');

    await remove(await device(), { confirmation: EMAIL });

    expect(await eventsOf(id)).toHaveLength(1);
    expect(
      await prisma.outboxEvent.count({
        where: {
          audience: { has: `garage:${south.id}` },
          kind: 'mechanic.removed',
          subjectId: { not: '' },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: {
          audience: { has: `garage:${north.id}` },
          kind: 'member.removed',
        },
      }),
    ).toBe(1);
  });

  it("does not touch another account's mechanic card or membership", async () => {
    const id = await person(EMAIL, ['driver', 'receptionist']);
    const other = await person(
      'ioana@example.test',
      ['driver', 'receptionist'],
      '+40710000002',
    );
    const garage = await teamOf(id, 'receptionist');
    await prisma.garageMember.create({
      data: { accountId: other, garageId: garage.id, role: 'receptionist' },
    });
    await prisma.mechanic.create({
      data: {
        accountId: other,
        garageId: garage.id,
        name: 'Ion',
        onProfile: true,
      },
    });

    await remove(await device(), { confirmation: EMAIL });

    expect(
      await prisma.garageMember.count({ where: { accountId: other } }),
    ).toBe(1);
    expect(
      await prisma.mechanic.count({
        where: { accountId: other, onProfile: true },
      }),
    ).toBe(1);
  });
});

describe('no personal value outside the account row', () => {
  const personal = [
    EMAIL,
    'Andrei',
    'Marin',
    '+40710000001',
    '0710000001',
    'Cluj',
  ];

  it('keeps the e-mail, name, phone and city out of every log line', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        });
    }
    await person();
    const phone = await device();

    await remove(phone, { confirmation: 'altcineva@example.test' });
    await remove(phone, { confirmation: EMAIL });

    for (const line of lines) {
      for (const value of personal) expect(line).not.toContain(value);
    }
  });

  it('keeps every personal value out of the recorded events', async () => {
    const id = await person(EMAIL, ['driver', 'receptionist']);
    await teamOf(id, 'receptionist');

    await remove(await device(), { confirmation: EMAIL });

    const written = JSON.stringify(
      (
        await prisma.outboxEvent.findMany({
          where: { audience: { has: `account:${id}` } },
        })
      ).map(({ id: _id, ...e }) => e),
    );
    for (const value of personal) expect(written).not.toContain(value);
  });

  it('keeps every personal value out of the audit history of the account', async () => {
    const id = await person();

    await remove(await device(), { confirmation: EMAIL });

    const written = JSON.stringify(
      await prisma.activityLog.findMany({
        where: { actorId: id, kind: 'account_deleted' },
      }),
    );
    for (const value of personal) expect(written).not.toContain(value);
  });

  it('keeps the e-mail out of the live messages', async () => {
    await person();

    await remove(await device(), { confirmation: EMAIL });
    await until('the live sign-out', () =>
      published.some((m) => m.includes('session.revoked')),
    );

    for (const message of published) {
      for (const value of personal) expect(message).not.toContain(value);
    }
  });

  it('keeps the account row clear of every value, whatever it held', async () => {
    const id = await person();
    await prisma.account.update({
      data: { phone: '+40710000009' },
      where: { id },
    });
    const phone = await device();

    await remove(phone, { confirmation: '+40710000009' });

    const row = await accountOf(id);
    expect(JSON.stringify(row)).not.toContain('Andrei');
    expect(JSON.stringify(row)).not.toContain('Cluj');
    expect(JSON.stringify(row)).not.toContain('+4071');
  });
});

describe('the farewell e-mail of an unusual account', () => {
  it('is queued once to the e-mail as the account held it, case kept', async () => {
    const mixed = 'Andrei.Ion@Example.test';
    const id = await person(mixed);

    await remove(await device(mixed), { confirmation: mixed.toLowerCase() });

    const sent = await farewells();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ accountId: id });
    expect(String((sent[0].params as { to: string }).to).toLowerCase()).toBe(
      mixed.toLowerCase(),
    );
  });

  it('is queued although the e-mail had bounced and was never verified', async () => {
    const id = await person();
    await prisma.account.update({
      data: { emailVerifiedAt: null },
      where: { id },
    });

    await remove(await device(), { confirmation: EMAIL });

    expect(await farewells()).toHaveLength(1);
  });

  it('is not queued when a refusal came first', async () => {
    await person();

    await remove(await device(), { confirmation: 'altcineva@example.test' });

    expect(await farewells()).toHaveLength(0);
  });

  it('does not undo the deletion when the queue refuses the e-mail', async () => {
    const id = await person();
    const phone = await device();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest
      .spyOn(NotificationsService.prototype, 'sendAccountEmail')
      .mockRejectedValue(new Error('queue down'));

    const res = await remove(phone, { confirmation: EMAIL });

    expect(res.status).toBe(204);
    expect((await accountOf(id)).status).toBe('deleted');
  });
});

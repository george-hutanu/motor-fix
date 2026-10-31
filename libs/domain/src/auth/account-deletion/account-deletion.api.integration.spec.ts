// @traces 129-FR-001 129-FR-002 129-FR-003 129-FR-004 129-FR-005
// @traces 129-FR-006 129-FR-007 129-FR-008 129-FR-012 129-FR-013
// @traces 140-FR-012 140-FR-014 140-FR-017
import { CURRENT_CONSENT } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException, Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AccountDeletionService } from './account-deletion.service';
import { AuditService } from '../../audit/audit.service';
import { RemindersService } from '../../cars/reminders/reminders.service';
import { noEvents } from '../../events/event.port';
import type { JobStatus } from '../../generated/prisma/enums';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { DirectSendModule } from '../../notifications/direct-send/direct-send.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { AccountClosed } from '../../quotes/account-closed/account-closed';
import { AccountClosedModule } from '../../quotes/account-closed/account-closed.module';
import { quotesWorld } from '../../quotes/quotes.testing';
import type { ReviewEligibility } from '../../reviews/eligibility/eligibility';
import { ReviewsService } from '../../reviews/reviews.service';
import { until } from '../../waits.testing';
import { AccountsService } from '../accounts.service';
import { AuthModule } from '../auth.module';
import { hashPassword } from '../password/password';
import { PasswordResetModule } from '../password/password-reset/password-reset.module';
import { PhoneSignInModule } from '../phone-sign-in/phone-sign-in.module';
import type { Actor } from '../policy';
import { serialDatabase } from '../serial-db.testing';

const redisUrl = redisUrlFor(11);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const PASSWORD = 'parola-de-test';
const EMAIL = 'andrei@example.test';
const PHONE = '+40710000001';
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
      PhoneSignInModule.register(notifications),
      DirectSendModule.registerWorker({
        email: testConfig(brevo.url),
        phone: testPhoneConfig({
          PHONE_ALLOWLIST: '+407*',
          WHATSAPP_TEMPLATES:
            'motorfix_sign_in_code_ro=21,motorfix_sign_in_code_en=22',
        }),
        redisUrl,
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

// A WhatsApp code asked for and sent back, with no name or consent: the
// answer of an existing account's phone, or of an unknown one.
async function phoneSignIn(phone: string) {
  await http()
    .post('/auth/phone-code')
    .set('X-Forwarded-For', address())
    .send({ phone })
    .expect(202);
  const body = brevo.whatsapp().at(-1)?.body as { params: string[] };
  return http()
    .post('/auth/phone-sign-in')
    .set('X-Forwarded-For', address())
    .send({ code: String(body.params[0]), phone });
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

const CLEARED = /^mf_refresh=;.*Expires=Thu, 01 Jan 1970/;

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

const actorOf = (accountId: string, extra: Partial<Actor> = {}): Actor => ({
  accountId,
  garageId: null,
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
  ...extra,
});

async function refusedBy(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return {
    body: http.getResponse() as { code: string },
    status: http.getStatus(),
  };
}

const reader = countedMetrics();
const deletions = (outcome: string) =>
  counterTotal(reader, 'motorfix_account_deletions_total', { outcome });

describe('deleting my account', () => {
  it('answers 204, clears the session cookie and marks the account deleted', async () => {
    const id = await person();
    const phone = await device();

    const res = await remove(phone, { confirmation: EMAIL });

    expect(res.status).toBe(204);
    expect(setCookie(res)).toMatch(CLEARED);
    expect(await accountOf(id)).toMatchObject({
      city: null,
      email: null,
      emailBouncedAt: null,
      emailVerifiedAt: null,
      name: '',
      phone: null,
      phoneVerifiedAt: null,
      status: 'deleted',
    });
  });

  it('removes the identities, sessions, tokens, devices, preferences and roles, and keeps the assistants revoked', async () => {
    const id = await person();
    const other = await person(
      'ioana@example.test',
      ['driver'],
      '+40710000002',
    );
    await everything(id);
    const phone = await device();
    await device('ioana@example.test');

    expect((await remove(phone, { confirmation: EMAIL })).status).toBe(204);

    expect(await leftOf(id)).toEqual({
      accountRole: 0,
      accountToken: 0,
      assistantGrant: 1,
      assistantSignInCode: 0,
      identity: 0,
      notificationPreference: 0,
      phoneChange: 0,
      pushSubscription: 0,
      refreshToken: 0,
    });
    expect((await leftOf(other)).refreshToken).toBe(1);
    // @traces 003-FR-015
    expect(
      await prisma.assistantGrant.findFirstOrThrow({
        where: { accountId: id },
      }),
    ).toMatchObject({ revokedBy: id, revokeReason: 'account_deleted' });
    expect(
      await prisma.outboxEvent.count({
        where: {
          kind: 'assistant_grant.revoked',
          payload: { equals: id, path: ['accountId'] },
        },
      }),
    ).toBe(1);
  });

  it('frees the e-mail: it no longer signs in, and a new sign-up with it succeeds', async () => {
    const id = await person();
    const phone = await device();

    await remove(phone, { confirmation: EMAIL });

    expect((await signIn(EMAIL)).status).toBe(401);
    expect(
      await prisma.account.count({ where: { phone: '+40710000001' } }),
    ).toBe(0);
    const again = await http()
      .post('/auth/sign-up')
      .set('X-Forwarded-For', address())
      .send({
        consent: CURRENT_CONSENT,
        email: EMAIL,
        language: 'ro',
        name: 'Andrei Marin',
        password: PASSWORD,
      });
    expect(again.status).toBe(201);
    expect(again.body.accessToken).toEqual(expect.any(String));
    const fresh = await prisma.account.findFirstOrThrow({
      where: { email: EMAIL },
    });
    expect(fresh.id).not.toBe(id);
  });

  it('frees the phone: a WhatsApp code with it signs up a new account, never phone_taken', async () => {
    const id = await person();
    await prisma.accountIdentity.create({
      data: { accountId: id, method: 'whatsapp_phone', subject: PHONE },
    });

    expect((await remove(await device(), { confirmation: EMAIL })).status).toBe(
      204,
    );

    await http()
      .post('/auth/phone-code')
      .set('X-Forwarded-For', address())
      .send({ phone: PHONE })
      .expect(202);
    const body = brevo.whatsapp().at(-1)?.body as { params: string[] };
    const res = await http()
      .post('/auth/phone-sign-in')
      .set('X-Forwarded-For', address())
      .send({
        code: String(body.params[0]),
        consent: CURRENT_CONSENT,
        name: 'Ion Popescu',
        phone: PHONE,
      });

    expect(res.status).toBe(200);
    const fresh = await prisma.account.findUniqueOrThrow({
      where: { phone: PHONE },
    });
    expect(fresh.id).not.toBe(id);
    expect(fresh.status).toBe('active');
  });

  it.each([
    ['the e-mail in another case', ' ANDREI@Example.TEST '],
    ['the phone as people write it', '0710 000 001'],
  ])('accepts %s as the confirmation', async (_, confirmation) => {
    await person();

    expect((await remove(await device(), { confirmation })).status).toBe(204);
  });

  it.each([['ȘTERGE'], ['ŞTERGE'], ['șterge'], ['delete'], ['DELETE']])(
    'accepts %s from an account with neither e-mail nor phone',
    async (confirmation) => {
      const id = await person();
      const phone = await device();
      await prisma.account.update({
        data: { email: null, phone: null },
        where: { id },
      });

      expect((await remove(phone, { confirmation })).status).toBe(204);
      expect((await accountOf(id)).status).toBe('deleted');
    },
  );

  it('refuses a confirmation that names someone else, and changes nothing', async () => {
    const id = await person();
    const phone = await device();
    const before = await deletions('mismatch');

    const res = await remove(phone, { confirmation: 'ioana@example.test' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'mismatch', field: 'confirmation' }],
    });
    expect((await accountOf(id)).status).toBe('active');
    expect((await leftOf(id)).refreshToken).toBe(1);
    expect(await deletions('mismatch')).toBe(before + 1);
  });

  it('refuses the phrase from an account that has an e-mail', async () => {
    await person();

    const res = await remove(await device(), { confirmation: 'DELETE' });

    expect(res.status).toBe(400);
  });

  it('refuses an empty confirmation with 400', async () => {
    await person();

    expect((await remove(await device(), { confirmation: '  ' })).status).toBe(
      400,
    );
  });

  it('answers 401 sign_in_required with no change when the account is no longer active', async () => {
    const id = await person();
    const phone = await device();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });
    const token = phone.cookie.slice('mf_refresh='.length);

    const refused = await refusedBy(
      app
        .get(AccountDeletionService)
        .deleteAccount(actorOf(id), token, { confirmation: EMAIL }),
    );

    expect(refused).toEqual({
      body: expect.objectContaining({ code: 'sign_in_required' }),
      status: 401,
    });
    expect(await accountOf(id)).toMatchObject({
      email: EMAIL,
      status: 'suspended',
    });
    expect(await eventsOf(id)).toHaveLength(0);
    expect(await auditOf(id)).toHaveLength(0);
  });

  it('records account.deleted once, with only the account id', async () => {
    const id = await person();

    await remove(await device(), { confirmation: EMAIL });

    const events = await eventsOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: [`account:${id}`],
      payload: { accountId: id },
    });
  });

  it("ends the account's open tabs on the live channel, once", async () => {
    const id = await person();

    await remove(await device(), { confirmation: EMAIL });
    await until('the live sign-out', () =>
      published.some((m) => m.includes('session.revoked')),
    );
    // Long enough for a second, wrong, announcement to arrive.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const revoked = published
      .map((m) => JSON.parse(m))
      .filter((m) => m.event?.kind === 'session.revoked');
    expect(revoked).toEqual([
      {
        audience: [`account:${id}`],
        event: expect.objectContaining({ kind: 'session.revoked' }),
      },
    ]);
  });

  it('counts the deletion', async () => {
    await person();
    const before = await deletions('deleted');

    await remove(await device(), { confirmation: EMAIL });

    expect(await deletions('deleted')).toBe(before + 1);
  });

  it('logs the deletion with the account id and no personal value', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const id = await person();

    await remove(await device(), { confirmation: EMAIL });

    const lines = log.mock.calls.map(([message]) => String(message));
    expect(lines).toContain(`account deleted ${id}`);
    for (const line of lines) {
      expect(line).not.toContain(EMAIL);
      expect(line).not.toContain('Andrei');
      expect(line).not.toContain('+40710000001');
    }
  });
});

describe('the sign-in a deletion asks for', () => {
  it('answers 401 reauth_required with no change for a sign-in older than 15 minutes', async () => {
    const id = await person();
    const phone = await device();
    await openedAgo(id, 16);
    const before = await deletions('reauth_required');

    const res = await remove(phone, { confirmation: EMAIL });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('reauth_required');
    expect((await accountOf(id)).status).toBe('active');
    expect(await eventsOf(id)).toHaveLength(0);
    expect(await deletions('reauth_required')).toBe(before + 1);
  });

  it('takes a sign-in of 14 minutes ago', async () => {
    const id = await person();
    const phone = await device();
    await openedAgo(id, 14);

    expect((await remove(phone, { confirmation: EMAIL })).status).toBe(204);
  });

  it('answers 401 reauth_required without the session cookie', async () => {
    const id = await person();
    const { bearer } = await device();

    const res = await remove({ bearer }, { confirmation: EMAIL });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('reauth_required');
    expect((await accountOf(id)).status).toBe('active');
  });

  it('answers 401 sign_in_required with no access token', async () => {
    await person();
    const { cookie } = await device();

    const res = await remove({ cookie }, { confirmation: EMAIL });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });
});

describe('who may not delete an account', () => {
  it('answers 403 forbidden to an assistant acting for the account', async () => {
    const id = await person();
    const phone = await device();
    const token = phone.cookie.slice('mf_refresh='.length);
    const before = await deletions('forbidden');

    const refused = await refusedBy(
      app
        .get(AccountDeletionService)
        .deleteAccount(actorOf(id, { via: 'assistant' }), token, {
          confirmation: EMAIL,
        }),
    );

    expect(refused).toEqual({
      body: expect.objectContaining({ code: 'forbidden' }),
      status: 403,
    });
    expect((await accountOf(id)).status).toBe('active');
    expect(await deletions('forbidden')).toBe(before + 1);
  });

  it.each([
    ['in use', 'garage' as const, 'approved' as const],
    ['not in use', 'driver' as const, 'draft' as const],
    ['of a suspended garage', 'garage' as const, 'suspended' as const],
  ])(
    'answers 409 deletion_not_allowed to a garage owner, role %s, and changes nothing',
    async (_, inUse, status) => {
      const id = await person(EMAIL, ['driver', 'garage']);
      await owner(id, status as 'approved');
      await prisma.account.update({
        data: { lastRole: inUse },
        where: { id },
      });
      const phone = await device();
      const before = await deletions('refused_owner');

      const res = await remove(phone, { confirmation: EMAIL });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('deletion_not_allowed');
      expect((await accountOf(id)).status).toBe('active');
      expect(
        await prisma.garageMember.count({ where: { accountId: id } }),
      ).toBe(1);
      expect(await eventsOf(id)).toHaveLength(0);
      expect(await deletions('refused_owner')).toBe(before + 1);
    },
  );

  it('checks the assistant first, then the owner, then the sign-in, then the phrase', async () => {
    const id = await person(EMAIL, ['driver', 'garage']);
    const phone = await device();
    await openedAgo(id, 30);
    const token = phone.cookie.slice('mf_refresh='.length);
    const wrong = { confirmation: 'nu' };
    const service = app.get(AccountDeletionService);

    await owner(id);
    expect(
      (
        await refusedBy(
          service.deleteAccount(
            actorOf(id, { via: 'assistant' }),
            token,
            wrong,
          ),
        )
      ).status,
    ).toBe(403);
    expect((await remove(phone, wrong)).body.code).toBe('deletion_not_allowed');

    await prisma.garageMember.deleteMany({ where: { accountId: id } });
    expect((await remove(phone, wrong)).body.code).toBe('reauth_required');

    await openedAgo(id, 1);
    expect((await remove(phone, wrong)).body.code).toBe('validation_failed');
    expect((await accountOf(id)).status).toBe('active');
  });
});

describe('the farewell e-mail', () => {
  it('queues the account deleted e-mail once, to the address held before the deletion', async () => {
    const id = await person();

    await remove(await device(), { confirmation: EMAIL });

    const sent = await farewells();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      accountId: id,
      params: expect.objectContaining({ to: EMAIL }),
    });
  });

  it('queues none for an account without an e-mail', async () => {
    const id = await person();
    const phone = await device();
    await prisma.account.update({ data: { email: null }, where: { id } });

    expect((await remove(phone, { confirmation: '+40710000001' })).status).toBe(
      204,
    );

    expect(await farewells()).toHaveLength(0);
  });
});

describe('the audit history of a deletion', () => {
  it('writes one entry as "Cont șters", with the status only', async () => {
    const id = await person();

    await remove(await device(), { confirmation: EMAIL });

    const entries = await auditOf(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'delete',
      actorId: id,
      actorName: 'Cont șters',
      actorRole: 'driver',
      kind: 'account_deleted',
      newValue: { status: 'deleted' },
      oldValue: { status: 'active' },
      subjectId: id,
      subjectType: 'account',
    });
    const written = JSON.stringify(entries[0]);
    expect(written).not.toContain(EMAIL);
    expect(written).not.toContain('Andrei');
    expect(written).not.toContain('+40710000001');
  });
});

describe('a car in the workshop', () => {
  const world = quotesWorld(prisma);

  async function carInWork(driverId: string, status: JobStatus) {
    const garage = await world.garage('Atelier Dinamo');
    const { booking } = await world.chain(driverId, garage.id);
    return world.job(booking.id, status);
  }

  it.each(['in_work', 'paused'] as const)(
    'answers 409 car_in_work while a job of the account is %s, and changes nothing',
    async (status) => {
      const id = await person();
      await carInWork(id, status);
      const phone = await device();
      const before = await deletions('refused_in_work');

      const res = await remove(phone, { confirmation: EMAIL });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('car_in_work');
      expect((await accountOf(id)).status).toBe('active');
      expect(
        await prisma.refreshToken.count({ where: { accountId: id } }),
      ).toBe(1);
      expect(await eventsOf(id)).toHaveLength(0);
      expect(await auditOf(id)).toHaveLength(0);
      expect(await deletions('refused_in_work')).toBe(before + 1);
    },
  );

  it.each(['to_do', 'done', 'cancelled'] as const)(
    'deletes the account whose only job is %s',
    async (status) => {
      const id = await person();
      await carInWork(id, status);

      const res = await remove(await device(), { confirmation: EMAIL });

      expect(res.status).toBe(204);
      expect((await accountOf(id)).status).toBe('deleted');
    },
  );

  it("refuses only for the account's own car, not another driver's", async () => {
    const id = await person();
    const other = await person(
      'ioana@example.test',
      ['driver'],
      '+40710000002',
    );
    await carInWork(other, 'in_work');

    const res = await remove(await device(), { confirmation: EMAIL });

    expect(res.status).toBe(204);
    expect((await accountOf(id)).status).toBe('deleted');
  });

  it('checks the owner first, then the car in work, then the sign-in', async () => {
    const id = await person(EMAIL, ['driver', 'garage']);
    const phone = await device();
    await openedAgo(id, 30);
    const wrong = { confirmation: 'nu' };
    await owner(id);
    await carInWork(id, 'in_work');

    expect((await remove(phone, wrong)).body.code).toBe('deletion_not_allowed');

    await prisma.garageMember.deleteMany({ where: { accountId: id } });
    expect((await remove(phone, wrong)).body.code).toBe('car_in_work');

    await prisma.job.updateMany({
      data: { status: 'done' },
      where: { driverId: id },
    });
    expect((await remove(phone, wrong)).body.code).toBe('reauth_required');
    expect((await accountOf(id)).status).toBe('active');
  });
});

describe("what a driver's deletion leaves behind", () => {
  const world = quotesWorld(prisma);

  async function closer() {
    const ref = await Test.createTestingModule({
      imports: [
        AccountClosedModule.registerWorker({
          notifications: NotificationsModule.registerWorker({
            databaseUrl,
            email: testConfig('http://127.0.0.1:9'),
            phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
            redisUrl,
          }),
          redisUrl,
        }),
      ],
    }).compile();
    return { handler: ref.get(AccountClosed), ref };
  }

  it('signs in by no method, closes the open request, cancels the booking as the system and keeps the review under a stand-in', async () => {
    const id = await person();
    const garage = await world.garage('Atelier Dinamo');
    const fixer = await prisma.mechanic.create({
      data: {
        canAnswerQuotes: false,
        garageId: garage.id,
        name: 'Fixer',
        onProfile: true,
      },
    });
    const open = await world.request(id, { status: 'quoted' });
    const waiting = await world.quote(open.id, garage.id, 'waiting');
    const { booking } = await world.chain(id, garage.id);
    await prisma.booking.update({
      data: { mechanicId: fixer.id },
      where: { id: booking.id },
    });
    const past = await world.chain(id, garage.id, { booking: 'completed' });
    const done = await world.job(past.booking.id, 'done', {
      mechanicId: fixer.id,
    });
    await prisma.review.create({
      data: {
        driverId: id,
        garageId: garage.id,
        jobId: done.id,
        mechanicId: fixer.id,
        rating: 4,
        status: 'published',
        text: 'Rapid și corect.',
      },
    });
    const reviews = new ReviewsService(
      prisma,
      new AuditService(),
      noEvents,
      {} as ReviewEligibility,
    );
    const before = await reviews.mechanicReviews(fixer.id);
    const ratings = async () => ({
      garage: await prisma.garage.findUniqueOrThrow({
        select: { rating: true, reviewCount: true },
        where: { id: garage.id },
      }),
      mechanic: await prisma.mechanic.findUniqueOrThrow({
        select: { rating: true, reviewCount: true },
        where: { id: fixer.id },
      }),
    });
    const rated = await ratings();
    await prisma.accountIdentity.createMany({
      data: [
        { accountId: id, method: 'whatsapp_phone', subject: PHONE },
        { accountId: id, method: 'google', subject: 'google-andrei' },
        { accountId: id, method: 'apple', subject: 'apple-andrei' },
      ],
    });
    await prisma.reminder.create({
      data: {
        accountId: id,
        bookingId: booking.id,
        dueOn: new Date('2030-01-11T00:00:00Z'),
        kind: 'booking',
      },
    });
    const unknown = await signIn('nimeni@example.test');
    const unknownPhone = await phoneSignIn('+40710000999');

    expect((await remove(await device(), { confirmation: EMAIL })).status).toBe(
      204,
    );
    const [event] = await eventsOf(id);
    const { handler, ref } = await closer();
    await handler.onEvent({
      data: {
        id: String(event.id),
        kind: event.kind,
        payload: { accountId: id },
        subjectId: id,
      },
    });
    await ref.close();

    // Every method answers as for an unknown account: the password and the
    // WhatsApp code by their routes, Google and Apple by the identities the
    // provider's subject is looked up in, which are gone.
    const again = await signIn(EMAIL);
    expect(again.status).toBe(unknown.status);
    expect(again.body.code).toBe(unknown.body.code);
    const againPhone = await phoneSignIn(PHONE);
    expect(againPhone.status).toBe(unknownPhone.status);
    expect(againPhone.body.code).toBe(unknownPhone.body.code);
    expect(
      await prisma.accountIdentity.count({
        where: {
          OR: [
            { accountId: id },
            { subject: { in: ['google-andrei', 'apple-andrei', PHONE] } },
          ],
        },
      }),
    ).toBe(0);
    const notes = () => prisma.notification.count({ where: { accountId: id } });
    const noted = await notes();
    await new RemindersService(prisma, app.get(NotificationsService)).run(
      '2030-01-10',
    );
    expect(await notes()).toBe(noted);
    expect(
      await prisma.quoteRequest.findUniqueOrThrow({ where: { id: open.id } }),
    ).toMatchObject({ status: 'closed' });
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: waiting.id } }))
        .status,
    ).toBe('lost');
    expect(
      await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }),
    ).toMatchObject({ cancelledBySide: 'system', status: 'cancelled' });
    const told = await prisma.outboxEvent.findMany({
      where: { kind: 'booking.cancelled', subjectId: booking.id },
    });
    expect(told).toHaveLength(1);
    expect(told[0]?.audience).toEqual(
      expect.arrayContaining([`garage:${garage.id}`, `mechanic:${fixer.id}`]),
    );
    expect(told[0]?.payload).toMatchObject({
      garageId: garage.id,
      reason: 'driver_account_closed',
    });
    expect(await ratings()).toEqual(rated);
    const after = await reviews.mechanicReviews(fixer.id);
    expect(after.total).toBe(before.total);
    expect(after.items).toEqual([
      expect.objectContaining({
        author: { shortName: 'Șofer MotorFix' },
        rating: 4,
      }),
    ]);
    expect(JSON.stringify(after.items)).not.toContain(id);
  });
});

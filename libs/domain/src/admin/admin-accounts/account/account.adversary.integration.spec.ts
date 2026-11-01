// @traces 003-FR-002 003-FR-003 003-FR-006 003-FR-007 003-FR-010 003-FR-012 003-FR-014
import { CURRENT_CONSENT } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AdminAccountModule } from './account.module';
import { AuditService } from '../../../audit/audit.service';
import { signAccessToken } from '../../../auth/access-token';
import { AccountsService } from '../../../auth/accounts.service';
import { AuthModule } from '../../../auth/auth.module';
import { hashPassword } from '../../../auth/password/password';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { noEvents } from '../../../events/event.port';
import { NotificationsModule } from '../../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { quotesWorld } from '../../../quotes/quotes.testing';

const redisUrl = redisUrlFor(9);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const support = 'suport@motorfix.test';
const PASSWORD = 'parola-de-test';
const REASON = 'Cereri false repetate către service-uri.';
const { account, prisma, reset } = fixtures();
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
const _world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const subscriber = new Redis(redisUrl);
const published: string[] = [];
const reader = countedMetrics();
let app: NestExpressApplication;
let hash: string;

beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
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
      AdminAccountModule.register({ support, webUrl }, notifications),
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
  subscriber.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  published.length = 0;
  vi.restoreAllMocks();
});

const http = () => request(app.getHttpServer());

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;

// A person who signs in with e-mail and password, with a session open.
async function person(
  email = 'andrei@example.test',
  roles: Role[] = ['driver'],
  extra: { phone?: string } = {},
) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    email,
    identity: { method: 'password', passwordHash: hash, subject: email },
    name: 'Andrei Ion Marin',
    roles,
  });
  await prisma.account.update({
    data: { city: 'Cluj-Napoca', phone: extra.phone ?? '+40710000001' },
    where: { id },
  });
  return id;
}

const _signIn = (email = 'andrei@example.test') =>
  http()
    .post('/auth/sign-in')
    .set('X-Forwarded-For', address())
    .send({ email, password: PASSWORD });

async function admin() {
  const id = await account('Ana Pop', ['admin']);
  return { auth: bearer(id, 'admin'), id };
}

const read = (id: string, auth?: string) => {
  const call = http().get(`/admin/accounts/${id}`);
  return auth ? call.set('Authorization', auth) : call;
};

const act = (
  id: string,
  action: 'reset-access' | 'suspend' | 'restore' | 'delete-on-request',
  auth: string,
  body: Record<string, unknown> = {},
) =>
  http()
    .post(`/admin/accounts/${id}/${action}`)
    .set('Authorization', auth)
    .send(body);

const grant = (accountId: string, clientId: string) =>
  prisma.assistantGrant.create({
    data: {
      accountId,
      canAct: true,
      canRead: true,
      clientId,
      clientName: clientId,
    },
  });

const auditOf = (subjectId: string, kind: string) =>
  prisma.activityLog.findMany({ where: { kind, subjectId } });

const eventsOf = (subjectId: string, kind: string) =>
  prisma.outboxEvent.findMany({ where: { kind, subjectId } });

const _emailsOf = (accountId: string, purpose: string) =>
  prisma.notification.findMany({
    where: {
      accountId,
      channel: 'email',
      kind: 'ACCOUNT_EMAIL',
      params: { equals: purpose, path: ['purpose'] },
    },
  });

const _actions = (action: string, outcome: string) =>
  counterTotal(reader, 'motorfix_admin_account_actions_total', {
    action,
    outcome,
  });

async function _garage(
  name: string,
  status: 'draft' | 'approved' | 'suspended' = 'approved',
) {
  return prisma.garage.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`,
      status,
    },
  });
}

const DELETION = {
  identityChecked: true,
  receivedOn: '2026-10-20',
  reference: 'DR-2026-0042',
};

describe('ids that are not an account', () => {
  it.each([
    ['sql text', "1'; DROP TABLE account;--"],
    ['an empty-looking id', '%20'],
    ['a uuid with a letter too many', '5b0c1d9e-7f43-4a51-9d2c-0b6f2a4e8c11a'],
    ['a nil uuid', '00000000-0000-0000-0000-000000000000'],
  ])('answers 404 to %s on every action', async (_, id) => {
    const { auth } = await admin();
    for (const [action, body] of [
      ['reset-access', {}],
      ['suspend', { reason: REASON }],
      ['restore', {}],
      ['delete-on-request', DELETION],
    ] as const) {
      const res = await act(id, action, auth, body);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
    expect((await read(id, auth)).status).toBe(404);
  });
});

describe('an admin as the target', () => {
  it('refuses an admin acting on their own account', async () => {
    const { auth, id } = await admin();

    const res = await act(id, 'suspend', auth, { reason: REASON });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('admin_account');
    expect(
      await prisma.account.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: 'active' });
  });

  it('refuses an account holding admin beside other roles', async () => {
    const { auth } = await admin();
    const id = await account('Dual', ['driver', 'admin']);

    for (const [action, body] of [
      ['reset-access', {}],
      ['suspend', { reason: REASON }],
      ['restore', {}],
      ['delete-on-request', DELETION],
    ] as const) {
      expect((await act(id, action, auth, body)).body.code).toBe(
        'admin_account',
      );
    }
    expect(await auditOf(id, 'account_suspended')).toHaveLength(0);
  });
});

describe('a deleted account', () => {
  it.each([
    ['reset-access', {}],
    ['restore', {}],
    ['delete-on-request', DELETION],
  ] as const)('answers 404 to %s', async (action, body) => {
    const { auth } = await admin();
    const id = await account('Gone', ['driver'], { status: 'deleted' });

    const res = await act(id, action, auth, body);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers 404 to a second deletion after the first, writing one entry', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'delete-on-request', auth, DELETION).expect(204);

    const again = await act(id, 'delete-on-request', auth, DELETION);

    expect(again.status).toBe(404);
    expect(await auditOf(id, 'account_deleted')).toHaveLength(1);
    expect((await read(id, auth)).status).toBe(404);
  });
});

describe('suspend input at the edge', () => {
  it.each([
    ['exactly 10 characters', 'a'.repeat(10), 200],
    ['9 characters', 'a'.repeat(9), 400],
    ['9 characters padded with spaces', `   ${'a'.repeat(9)}   `, 400],
    ['10 spaces', ' '.repeat(10), 400],
    ['10 tabs and newlines', '\t\n'.repeat(5), 400],
    ['exactly 500 characters', 'a'.repeat(500), 200],
    ['501 characters', 'a'.repeat(501), 400],
    ['500 characters inside padding', ` ${'a'.repeat(500)} `, 200],
    ['unicode text', 'Șțăîâ 😀 motiv', 200],
  ])('answers %s with %i', async (_, reason, status) => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'suspend', auth, { reason });

    expect(res.status).toBe(status);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id } })).status,
    ).toBe(status === 200 ? 'suspended' : 'active');
  });

  it.each([
    ['a number', { reason: 1234567890123 }],
    ['null', { reason: null }],
    ['an array', { reason: [REASON] }],
    ['an object', { reason: { text: REASON } }],
    ['no body fields', {}],
    ['an extra field', { reason: REASON, status: 'deleted' }],
    ['the reason under another name', { Reason: REASON }],
  ])('answers 400 to %s, changing nothing', async (_, body) => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'suspend', auth, body);

    expect(res.status).toBe(400);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('active');
    expect(await auditOf(id, 'account_suspended')).toHaveLength(0);
    expect(await eventsOf(id, 'account.suspended')).toHaveLength(0);
  });

  it('answers 400 to a body that is no JSON object', async () => {
    const { auth } = await admin();
    const id = await person();

    const res = await http()
      .post(`/admin/accounts/${id}/suspend`)
      .set('Authorization', auth)
      .set('Content-Type', 'application/json')
      .send('[1,2,3]');

    expect(res.status).toBe(400);
  });

  it('does not answer a server error to a reason holding a NUL character', async () => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'suspend', auth, {
      reason: 'motiv cu \u0000 in el, destul de lung',
    });

    expect(res.status).toBe(400);
  });

  it('answers 400, not a server error, to a restore note holding a NUL character', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: 'Cereri false repetate.' });

    const res = await act(id, 'restore', auth, { note: 'notă \u0000 aici' });

    expect(res.status).toBe(400);
  });

  it('stores the trimmed reason in the audit text and the page', async () => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'suspend', auth, { reason: `  ${REASON}\n ` });

    expect(res.body.suspendedReason).toBe(REASON);
    expect((await auditOf(id, 'account_suspended'))[0].text).toBe(REASON);
  });

  it('suspends again after a restore, with a second entry and the grants revoked again', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);
    await act(id, 'restore', auth).expect(200);
    await grant(id, 'claude');

    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    expect(await auditOf(id, 'account_suspended')).toHaveLength(2);
    expect(await eventsOf(id, 'account.suspended')).toHaveLength(2);
    expect(
      await prisma.assistantGrant.count({
        where: { accountId: id, revokedAt: null },
      }),
    ).toBe(0);
  });
});

describe('restore input at the edge', () => {
  it.each([
    ['no note', {}, 200],
    ['a null note', { note: null }, 200],
    ['an empty note', { note: '' }, 200],
    ['a note of spaces', { note: '     ' }, 200],
    ['a note of 500', { note: 'n'.repeat(500) }, 200],
    ['a note of 501', { note: 'n'.repeat(501) }, 400],
    ['a number', { note: 5 }, 400],
    ['an extra field', { note: 'ok', status: 'active' }, 400],
  ])('answers %s with %i', async (_, body, status) => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const res = await act(id, 'restore', auth, body);

    expect(res.status).toBe(status);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id } })).status,
    ).toBe(status === 200 ? 'active' : 'suspended');
  });

  it('keeps no suspension reason on the page after a restore', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const res = await act(id, 'restore', auth, { note: 'in regula' });

    expect(res.body.status).toBe('active');
    expect(res.body.suspendedReason).toBeNull();
  });
});

describe('delete on request input at the edge', () => {
  it.each([
    ['four digits', 'DR-2026-1234', 204],
    ['more than four digits', 'DR-2026-123456789', 204],
    ['three digits', 'DR-2026-123', 400],
    ['lower case', 'dr-2026-0001', 400],
    ['a trailing newline', 'DR-2026-0001\n', 400],
    ['a leading space', ' DR-2026-0001', 400],
    ['a trailing space', 'DR-2026-0001 ', 400],
    ['a five-digit year', 'DR-20261-0001', 400],
    ['full-width digits', 'DR-２０２６-０００１', 400],
    ['a second reference after the first', 'DR-2026-0001 DR-2026-0002', 400],
  ])('answers %s with %i', async (_, reference, status) => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'delete-on-request', auth, {
      ...DELETION,
      reference,
    });

    expect(res.status).toBe(status);
  });

  it.each([
    ['a date with a time', '2026-10-20T00:00:00Z'],
    ['a day first date', '20-10-2026'],
    ['a month 13', '2026-13-01'],
    ['a leap day in a common year', '2025-02-29'],
    ['a number', 20261020],
    ['null', null],
  ])('answers 400 to receivedOn as %s', async (_, receivedOn) => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'delete-on-request', auth, {
      ...DELETION,
      receivedOn,
    });

    expect(res.status).toBe(400);
  });

  it("takes today's date in Bucharest and refuses the day after", async () => {
    const { auth } = await admin();
    const id = await person();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Bucharest',
    }).format(new Date());
    const tomorrow = new Date(`${today}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const late = await act(id, 'delete-on-request', auth, {
      ...DELETION,
      receivedOn: tomorrow.toISOString().slice(0, 10),
    });
    expect(late.status).toBe(400);

    await act(id, 'delete-on-request', auth, {
      ...DELETION,
      receivedOn: today,
    }).expect(204);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['1', 1],
    ['"yes"', 'yes'],
  ])('answers 400 to identityChecked %s', async (_, identityChecked) => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'delete-on-request', auth, {
      ...DELETION,
      identityChecked,
    });

    expect(res.status).toBe(400);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('active');
  });

  it('answers 400 to an extra field and to an empty body', async () => {
    const { auth } = await admin();
    const id = await person();

    expect(
      (await act(id, 'delete-on-request', auth, { ...DELETION, force: true }))
        .status,
    ).toBe(400);
    expect((await act(id, 'delete-on-request', auth, {})).status).toBe(400);
  });

  it('records the reference and date in the entry text and no personal value', async () => {
    const { auth } = await admin();
    const id = await person('Secret.Person@example.test');

    await act(id, 'delete-on-request', auth, DELETION).expect(204);

    const [entry] = await auditOf(id, 'account_deleted');
    const stored = JSON.stringify(entry);
    expect(stored).toContain('DR-2026-0042');
    expect(stored).toContain('2026-10-20');
    expect(stored).not.toContain('Secret.Person');
    expect(stored).not.toContain('Andrei');
    expect(stored).not.toContain('+40710000001');
  });

  it('revokes the assistant grants with account_deleted and keeps the rows', async () => {
    const { auth } = await admin();
    const id = await person();
    await grant(id, 'claude');

    await act(id, 'delete-on-request', auth, DELETION).expect(204);

    expect(
      await prisma.assistantGrant.findMany({ where: { accountId: id } }),
    ).toMatchObject([{ revokeReason: 'account_deleted' }]);
  });
});

describe('reset access repeated and shaped', () => {
  it('answers exactly the email field and takes a repeat', async () => {
    const { auth } = await admin();
    const id = await person();

    const first = await act(id, 'reset-access', auth);
    const second = await act(id, 'reset-access', auth);

    expect(first.status).toBe(200);
    expect(Object.keys(first.body)).toEqual(['email']);
    expect(second.status).toBe(200);
    expect(await auditOf(id, 'access_reset')).toHaveLength(2);
  });

  it('answers none to an account with a password but no e-mail address', async () => {
    const { auth } = await admin();
    const id = await person('x@example.test');
    await prisma.account.update({ data: { email: null }, where: { id } });

    const res = await act(id, 'reset-access', auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'none' });
  });
});

describe('what the answers must not carry', () => {
  it('has no hash, subject or token in the page after a suspension', async () => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'suspend', auth, { reason: REASON });

    const text = JSON.stringify(res.body);
    expect(text).not.toContain('$argon');
    expect(text).not.toContain(hash);
    expect(text).not.toMatch(/passwordHash|subject|token/i);
  });
});

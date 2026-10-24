// @traces 003-FR-001 003-FR-002 003-FR-003 003-FR-005 003-FR-006 003-FR-007
// @traces 003-FR-008 003-FR-010 003-FR-011 003-FR-012 003-FR-013 003-FR-014
// @traces 003-FR-015 003-FR-016 003-FR-021 003-SC-001 003-SC-002 003-SC-003
// @traces 003-SC-004 003-SC-005 003-FR-009
import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AdminAccountModule } from './account.module';
import { AuditService } from '../../../audit/audit.service';
import { signAccessToken } from '../../../auth/access-token';
import { AccountsService } from '../../../auth/accounts.service';
import { AuthModule } from '../../../auth/auth.module';
import type { Role } from '../../../auth/capabilities';
import { hashPassword } from '../../../auth/password/password';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { noEvents } from '../../../events/event.port';
import { outboxMark } from '../../../events/outbox.testing';
import { NotificationsModule } from '../../../notifications/notifications.module';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../../notifications/notifications.testing';
import { AccountClosed } from '../../../quotes/account-closed/account-closed';
import { AccountClosedModule } from '../../../quotes/account-closed/account-closed.module';
import { quotesWorld } from '../../../quotes/quotes.testing';
import { until } from '../../../waits.testing';

const redisUrl = redisUrlFor(9);
const tokenSecret = 'test-secret';
const webUrl = 'https://motorfix.test';
const support = 'suport@motorfix.test';
const PASSWORD = 'parola-de-test';
const REASON = 'Cereri false repetate către service-uri.';
const { account, prisma, reset } = fixtures();
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
const world = quotesWorld(prisma);
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
  jest.restoreAllMocks();
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

const signIn = (email = 'andrei@example.test') =>
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

const emailsOf = (accountId: string, purpose: string) =>
  prisma.notification.findMany({
    where: {
      accountId,
      channel: 'email',
      kind: 'ACCOUNT_EMAIL',
      params: { equals: purpose, path: ['purpose'] },
    },
  });

const actions = (action: string, outcome: string) =>
  counterTotal(reader, 'motorfix_admin_account_actions_total', {
    action,
    outcome,
  });

async function garage(
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

describe('GET /admin/accounts/:id', () => {
  it("answers an admin with the driver's details, methods and counts, and nothing secret", async () => {
    const { auth } = await admin();
    const id = await person();

    const res = await read(id, auth);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      counts: { cars: 0, requests: 0, reviews: 0 },
      documents: [],
      email: 'andrei@example.test',
      garage: null,
      id,
      isAdmin: false,
      isOwner: false,
      language: 'ro',
      name: 'Andrei Ion Marin',
      phone: '+40710000001',
      roles: ['driver'],
      signInMethods: ['password'],
      status: 'active',
      suspendedReason: null,
    });
    expect(typeof res.body.createdAt).toBe('string');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(hash);
    expect(text).not.toMatch(/passwordHash|subject|token/i);
  });

  it("names an owner's garage and lists its current legal documents", async () => {
    const { auth } = await admin();
    const id = await person('ion@example.test', ['garage']);
    const nord = await garage('Service Nord', 'suspended');
    await prisma.garageMember.create({
      data: { accountId: id, garageId: nord.id, role: 'owner' },
    });
    const file = await prisma.verificationFile.create({
      data: { garageId: nord.id },
    });
    const doc = await prisma.legalDocument.create({
      data: { kind: 'rar', pages: ['a', 'b'], verificationFileId: file.id },
    });

    const res = await read(id, auth);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      documents: [
        { id: doc.id, kind: 'rar', pages: 2, verificationFileId: file.id },
      ],
      garage: {
        id: nord.id,
        name: 'Service Nord',
        relation: 'owner',
        status: 'suspended',
      },
      isOwner: true,
      roles: ['garage'],
    });
  });

  it("names a mechanic's garage", async () => {
    const { auth } = await admin();
    const id = await person('elena@example.test', ['mechanic']);
    const nord = await garage('Service Nord');
    await prisma.mechanic.create({
      data: { accountId: id, garageId: nord.id, name: 'Elena' },
    });

    const res = await read(id, auth);

    expect(res.body.garage).toMatchObject({
      id: nord.id,
      relation: 'mechanic',
    });
  });

  it('says when the account holds admin', async () => {
    const { auth } = await admin();
    const other = await account('Mihai', ['admin']);

    const res = await read(other, auth);

    expect(res.body.isAdmin).toBe(true);
  });

  it('shows a suspended account with its reason', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const res = await read(id, auth);

    expect(res.body).toMatchObject({
      status: 'suspended',
      suspendedReason: REASON,
    });
  });

  it('writes no audit entry for the read', async () => {
    const { auth, id: adminId } = await admin();
    const id = await person();
    const before = await prisma.activityLog.count({
      where: { actorId: adminId },
    });

    await read(id, auth).expect(200);

    expect(
      await prisma.activityLog.count({ where: { actorId: adminId } }),
    ).toBe(before);
  });

  it.each([
    ['an unknown id', () => '5b0c1d9e-7f43-4a51-9d2c-0b6f2a4e8c11'],
    ['a malformed id', () => 'andrei'],
  ])('answers 404 to %s', async (_, id) => {
    const { auth } = await admin();

    const res = await read(id(), auth);

    expect(res.status).toBe(404);
  });

  it('answers 404 to a deleted account', async () => {
    const { auth } = await admin();
    const id = await account('Gone', ['driver'], { status: 'deleted' });

    expect((await read(id, auth)).status).toBe(404);
  });
});

describe('who may use the account routes', () => {
  // Each call is built when it runs: supertest closes its server after a call.
  const routes = (id: string, auth?: string) => {
    const set = (call: request.Test) =>
      auth ? call.set('Authorization', auth) : call;
    return [
      () => set(http().get(`/admin/accounts/${id}`)),
      () => set(http().post(`/admin/accounts/${id}/reset-access`)),
      () =>
        set(
          http().post(`/admin/accounts/${id}/suspend`).send({ reason: REASON }),
        ),
      () => set(http().post(`/admin/accounts/${id}/restore`).send({})),
      () =>
        set(
          http().post(`/admin/accounts/${id}/delete-on-request`).send(DELETION),
        ),
    ];
  };

  it.each(['driver', 'garage', 'receptionist', 'mechanic'] as const)(
    'answers 404 to a %s on every route, changing nothing',
    async (role) => {
      const caller = await account(`Cont ${role}`, [role]);
      const id = await person();

      for (const call of routes(id, bearer(caller, role))) {
        expect((await call()).status).toBe(404);
      }
      expect(
        await prisma.account.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ status: 'active' });
    },
  );

  it('answers 401 sign_in_required without a session', async () => {
    const id = await person();

    for (const call of routes(id)) {
      const res = await call();
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    }
  });

  it('answers 403 account_suspended to a suspended admin', async () => {
    const caller = await account('Ana', ['admin'], { status: 'suspended' });
    const id = await person();

    for (const call of routes(id, bearer(caller, 'admin'))) {
      const res = await call();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('account_suspended');
    }
  });

  it.each([
    ['reset-access', {}],
    ['suspend', { reason: REASON }],
    ['restore', {}],
    ['delete-on-request', DELETION],
  ] as const)(
    'refuses %s on an admin account with 409 admin_account, before any write',
    async (action, body) => {
      const { auth } = await admin();
      const other = await account('Mihai', ['admin', 'driver']);
      const before = await prisma.activityLog.count();

      const res = await act(other, action, auth, body);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('admin_account');
      expect(await prisma.activityLog.count()).toBe(before);
      expect(
        await prisma.account.findUniqueOrThrow({ where: { id: other } }),
      ).toMatchObject({ status: 'active' });
    },
  );
});

describe('POST /admin/accounts/:id/reset-access', () => {
  it('ends every session and sends the reset e-mail to a password account', async () => {
    const { auth, id: adminId } = await admin();
    const id = await person();
    await signIn().expect(200);
    const done = await actions('reset_access', 'done');

    const res = await act(id, 'reset-access', auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'sent' });
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
    const [entry] = await auditOf(id, 'access_reset');
    expect(entry).toMatchObject({
      action: 'update',
      actorId: adminId,
      actorName: 'Ana',
      actorRole: 'admin',
      subjectType: 'account',
    });
    expect(await eventsOf(id, 'account.access_reset')).toHaveLength(1);
    const [mail] = await emailsOf(id, 'password_reset');
    expect((mail?.params as { link?: string } | undefined)?.link).toMatch(
      /^https:\/\/motorfix\.test\/ro\/reset-password\/[\w-]{43}$/,
    );
    expect(await actions('reset_access', 'done')).toBe(done + 1);
    await until('the live sign-out', () =>
      published.some((m) => m.includes('session.revoked') && m.includes(id)),
    );
  });

  it('answers none to an account with no password, and still ends its sessions', async () => {
    const { auth } = await admin();
    const id = await account('Ioana', ['driver']);

    const res = await act(id, 'reset-access', auth);

    expect(res.body).toEqual({ email: 'none' });
    expect(await emailsOf(id, 'password_reset')).toHaveLength(0);
    expect(await auditOf(id, 'access_reset')).toHaveLength(1);
  });

  it('answers failed when the e-mail is refused, with the sessions already ended, and takes a repeat', async () => {
    const { auth } = await admin();
    const id = await person();
    await signIn().expect(200);
    jest
      .spyOn(NotificationsService.prototype, 'sendAccountEmail')
      .mockRejectedValueOnce(new Error('queue down'));
    const failed = await actions('reset_access', 'email_failed');

    const res = await act(id, 'reset-access', auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'failed' });
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
    expect(await actions('reset_access', 'email_failed')).toBe(failed + 1);

    const again = await act(id, 'reset-access', auth);
    expect(again.body).toEqual({ email: 'sent' });
  });

  it('resets a suspended account too', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const res = await act(id, 'reset-access', auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'none' });
  });
});

describe('POST /admin/accounts/:id/suspend', () => {
  it('suspends at once: one entry, one event, sessions and grants gone, sign-in refused', async () => {
    const { auth, id: adminId } = await admin();
    const id = await person();
    await signIn().expect(200);
    await grant(id, 'claude');
    await grant(id, 'chatgpt');

    const res = await act(id, 'suspend', auth, { reason: `  ${REASON}  ` });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      status: 'suspended',
      suspendedReason: REASON,
    });
    const entries = await auditOf(id, 'account_suspended');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: adminId,
      actorRole: 'admin',
      field: 'status',
      newValue: 'suspended',
      oldValue: 'active',
      subjectType: 'account',
      text: REASON,
    });
    const events = await eventsOf(id, 'account.suspended');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: [`account:${id}`],
      payload: { accountId: id },
    });
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
    const grants = await prisma.assistantGrant.findMany({
      where: { accountId: id },
    });
    expect(grants.map((g) => [g.revokeReason, g.revokedBy])).toEqual([
      ['account_suspended', adminId],
      ['account_suspended', adminId],
    ]);

    const again = await signIn();
    expect(again.status).toBe(403);
    expect(again.body.code).toBe('account_suspended');
    await until('the live sign-out', () =>
      published.some((m) => m.includes('session.revoked') && m.includes(id)),
    );
  });

  it('e-mails the person the reason and the support address, in their language', async () => {
    const { auth } = await admin();
    const id = await person();
    await prisma.account.update({ data: { language: 'en' }, where: { id } });

    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const mails = await emailsOf(id, 'account_suspended');
    expect(mails).toHaveLength(1);
    expect(mails[0]?.params).toMatchObject({
      link: 'https://motorfix.test/en/contact',
      reason: REASON,
      support,
    });
  });

  it('sends nothing to an account without an e-mail', async () => {
    const { auth } = await admin();
    const id = await account('Vasile', ['driver'], { email: null });

    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    expect(await emailsOf(id, 'account_suspended')).toHaveLength(0);
  });

  it('keeps the suspension when the e-mail is refused, counting email_failed', async () => {
    const { auth } = await admin();
    const id = await person();
    jest
      .spyOn(NotificationsService.prototype, 'sendAccountEmail')
      .mockRejectedValueOnce(new Error('queue down'));
    const failed = await actions('suspend', 'email_failed');

    const res = await act(id, 'suspend', auth, { reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('suspended');
    expect(await actions('suspend', 'email_failed')).toBe(failed + 1);
  });

  it.each([
    ['a reason under 10 characters after trimming', { reason: '   scurt   ' }],
    ['a reason over 500 characters', { reason: 'x'.repeat(501) }],
    ['no reason', {}],
  ])('answers 400 to %s, changing nothing', async (_, body) => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'suspend', auth, body);

    expect(res.status).toBe(400);
    expect(
      await prisma.account.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: 'active' });
  });

  it('answers 409 account_already_suspended to a suspended account', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const res = await act(id, 'suspend', auth, { reason: REASON });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('account_already_suspended');
  });

  it('answers 404 to a deleted account', async () => {
    const { auth } = await admin();
    const id = await account('Gone', ['driver'], { status: 'deleted' });

    expect((await act(id, 'suspend', auth, { reason: REASON })).status).toBe(
      404,
    );
  });

  it('leaves one winner when two admins suspend at once', async () => {
    const { auth } = await admin();
    const id = await person();

    const results = await Promise.all([
      act(id, 'suspend', auth, { reason: REASON }),
      act(id, 'suspend', auth, { reason: REASON }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await auditOf(id, 'account_suspended')).toHaveLength(1);
    expect(await eventsOf(id, 'account.suspended')).toHaveLength(1);
  });

  it("never touches an owner's garage or its staff", async () => {
    const { auth } = await admin();
    const id = await person('ion@example.test', ['garage']);
    const nord = await garage('Service Nord');
    await prisma.garageMember.create({
      data: { accountId: id, garageId: nord.id, role: 'owner' },
    });
    const ioana = await person('ioana@example.test', ['receptionist'], {
      phone: '+40710000002',
    });
    await prisma.garageMember.create({
      data: { accountId: ioana, garageId: nord.id, role: 'receptionist' },
    });
    await signIn('ioana@example.test').expect(200);

    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: nord.id } }),
    ).toMatchObject({ status: 'approved' });
    expect(
      await prisma.refreshToken.count({ where: { accountId: ioana } }),
    ).toBe(1);
    expect(
      await prisma.garageMember.count({ where: { garageId: nord.id } }),
    ).toBe(2);
  });

  it('writes one log line per action, without the reason or the e-mail', async () => {
    const { auth } = await admin();
    const id = await person();
    const lines: unknown[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((line: unknown) => {
      lines.push(line);
    });

    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const text = JSON.stringify(lines);
    expect(text).toContain('"outcome":"done"');
    expect(text).toContain(id);
    expect(text).not.toContain(REASON);
    expect(text).not.toContain('andrei@example.test');
  });

  it('writes a failure line naming the route with :id', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);
    const lines: unknown[] = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((line: unknown) => {
      lines.push(line);
    });

    await act(id, 'suspend', auth, { reason: REASON }).expect(409);

    expect(lines).toContainEqual({
      message: 'admin accounts request failed',
      route: 'POST /admin/accounts/:id/suspend',
      status: 409,
    });
  });
});

// The existing consumer of account.suspended does the clean-up (428-FR-001);
// this story adds no handler of its own.
describe('the clean-up after a suspension', () => {
  it('closes the open requests and cancels the future booking once, and a restore reopens nothing', async () => {
    const { auth } = await admin();
    const id = await person();
    const dinamo = await world.garage('Atelier Dinamo');
    const { booking, request: booked } = await world.chain(id, dinamo.id, {
      booking: 'confirmed',
    });
    const open = await world.request(id);
    await world.recipient(open.id, dinamo.id);

    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const [event] = await eventsOf(id, 'account.suspended');
    const worker = await Test.createTestingModule({
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
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const handler = worker.get(AccountClosed);
    const job = {
      data: {
        id: String(event?.id),
        kind: String(event?.kind),
        payload: event?.payload as { accountId: string },
        subjectId: id,
      },
    };
    try {
      await handler.onEvent(job);
      const mark = await outboxMark(prisma);
      await handler.onEvent(job);
      expect(
        await prisma.outboxEvent.count({ where: { id: { gt: mark } } }),
      ).toBe(0);
    } finally {
      await worker.close();
    }

    expect(
      await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }),
    ).toMatchObject({ cancelledBySide: 'system', status: 'cancelled' });
    const closed = await prisma.quoteRequest.findMany({
      select: { id: true, status: true },
      where: { id: { in: [booked.id, open.id] } },
    });
    expect(closed.map((r) => r.status)).toEqual(['closed', 'closed']);
    expect(await eventsOf(booking.id, 'booking.cancelled')).toHaveLength(1);

    await act(id, 'restore', auth).expect(200);

    expect(
      await prisma.quoteRequest.count({
        where: { id: { in: [booked.id, open.id] }, status: 'closed' },
      }),
    ).toBe(2);
    expect(
      await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }),
    ).toMatchObject({ status: 'cancelled' });
  });
});

describe('POST /admin/accounts/:id/restore', () => {
  it('lets the person in again, clearing the reason, sending nothing, grants still revoked', async () => {
    const { auth, id: adminId } = await admin();
    const id = await person();
    await grant(id, 'claude');
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const res = await act(id, 'restore', auth, {
      note: 'A promis că nu mai face.',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'active', suspendedReason: null });
    const [entry] = await auditOf(id, 'account_restored');
    expect(entry).toMatchObject({
      actorId: adminId,
      field: 'status',
      newValue: 'active',
      oldValue: 'suspended',
      text: 'A promis că nu mai face.',
    });
    expect(await eventsOf(id, 'account.restored')).toHaveLength(1);
    expect(
      await prisma.notification.count({
        where: {
          accountId: id,
          kind: 'ACCOUNT_EMAIL',
          params: { equals: 'account_restored', path: ['purpose'] },
        },
      }),
    ).toBe(0);
    expect(
      await prisma.assistantGrant.count({
        where: { accountId: id, revokedAt: null },
      }),
    ).toBe(0);
    expect((await signIn()).status).toBe(200);
  });

  it('takes no note', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const res = await act(id, 'restore', auth);

    expect(res.status).toBe(200);
    const [entry] = await auditOf(id, 'account_restored');
    expect(entry?.text).toBeNull();
  });

  it('answers 400 to a note over 500 characters', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    expect(
      (await act(id, 'restore', auth, { note: 'x'.repeat(501) })).status,
    ).toBe(400);
  });

  it('answers 409 account_not_suspended to an active account', async () => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'restore', auth);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('account_not_suspended');
  });

  it('leaves one winner when two admins restore at once', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    const results = await Promise.all([
      act(id, 'restore', auth),
      act(id, 'restore', auth),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await auditOf(id, 'account_restored')).toHaveLength(1);
  });
});

describe('POST /admin/accounts/:id/delete-on-request', () => {
  it("deletes a driver's account: personal fields gone, counts kept, the request recorded", async () => {
    const { auth, id: adminId } = await admin();
    const id = await person();
    await signIn().expect(200);
    await grant(id, 'claude');

    const res = await act(id, 'delete-on-request', auth, DELETION);

    expect(res.status).toBe(204);
    expect(
      await prisma.account.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      city: null,
      email: null,
      name: '',
      phone: null,
      status: 'deleted',
      suspendedReason: null,
    });
    expect(
      await prisma.accountIdentity.count({ where: { accountId: id } }),
    ).toBe(0);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
    const [entry] = await auditOf(id, 'account_deleted');
    expect(entry).toMatchObject({
      action: 'delete',
      actorId: adminId,
      actorRole: 'admin',
      subjectType: 'account',
    });
    expect(JSON.parse(entry?.text ?? '{}')).toEqual({
      receivedOn: '2026-10-20',
      reference: 'DR-2026-0042',
    });
    expect(JSON.stringify(entry)).not.toContain('andrei@example.test');
    expect(await eventsOf(id, 'account.deleted')).toHaveLength(1);
    expect(
      await prisma.assistantGrant.findFirstOrThrow({
        where: { accountId: id },
      }),
    ).toMatchObject({ revokedBy: adminId, revokeReason: 'account_deleted' });
    await until('the live sign-out', () =>
      published.some((m) => m.includes('session.revoked') && m.includes(id)),
    );
  });

  it('deletes a suspended account as an active one', async () => {
    const { auth } = await admin();
    const id = await person();
    await act(id, 'suspend', auth, { reason: REASON }).expect(200);

    expect((await act(id, 'delete-on-request', auth, DELETION)).status).toBe(
      204,
    );
    expect(
      await prisma.account.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: 'deleted', suspendedReason: null });
  });

  it('takes a mechanic off the team', async () => {
    const { auth } = await admin();
    const id = await person('elena@example.test', ['mechanic']);
    const nord = await garage('Service Nord');
    await prisma.mechanic.create({
      data: { accountId: id, garageId: nord.id, name: 'Elena' },
    });

    await act(id, 'delete-on-request', auth, DELETION).expect(204);

    expect(
      await prisma.mechanic.findFirstOrThrow({ where: { garageId: nord.id } }),
    ).toMatchObject({ accountId: null });
  });

  it("keeps the reviews of a mechanic's work with the garage", async () => {
    const { auth } = await admin();
    const id = await person('elena@example.test', ['mechanic']);
    const driverId = await account('Mihai Pop', ['driver']);
    const nord = await world.garage('Service Nord');
    const elena = await prisma.mechanic.create({
      data: { accountId: id, garageId: nord.id, name: 'Elena' },
    });
    const { booking } = await world.chain(driverId, nord.id);
    const job = await world.job(booking.id, 'done', { mechanicId: elena.id });
    const review = await prisma.review.create({
      data: {
        driverId,
        garageId: nord.id,
        jobId: job.id,
        mechanicId: elena.id,
        rating: 5,
        source: 'job',
        status: 'published',
      },
    });

    await act(id, 'delete-on-request', auth, DELETION).expect(204);

    expect(
      await prisma.review.findUniqueOrThrow({ where: { id: review.id } }),
    ).toMatchObject({
      garageId: nord.id,
      mechanicId: elena.id,
      status: 'published',
    });
  });

  it('takes a receptionist off the team', async () => {
    const { auth } = await admin();
    const id = await person('irina@example.test', ['receptionist']);
    const nord = await garage('Service Nord');
    await prisma.garageMember.create({
      data: { accountId: id, garageId: nord.id, role: 'receptionist' },
    });

    await act(id, 'delete-on-request', auth, DELETION).expect(204);

    expect(await prisma.garageMember.count({ where: { accountId: id } })).toBe(
      0,
    );
    expect(await eventsOf(nord.id, 'member.removed')).toHaveLength(1);
  });

  it.each(['approved', 'suspended', 'draft'] as const)(
    'refuses an owner of a %s garage with 409 deletion_not_allowed',
    async (status) => {
      const { auth } = await admin();
      const id = await person('ion@example.test', ['garage']);
      const nord = await garage('Service Nord', status);
      await prisma.garageMember.create({
        data: { accountId: id, garageId: nord.id, role: 'owner' },
      });

      const res = await act(id, 'delete-on-request', auth, DELETION);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('deletion_not_allowed');
      expect(
        await prisma.account.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ status: 'active' });
    },
  );

  it.each([
    ['a reference of another shape', { ...DELETION, reference: 'DR-26-1' }],
    ['a date after today', { ...DELETION, receivedOn: '2099-01-01' }],
    ['a date that is no day', { ...DELETION, receivedOn: '2026-02-30' }],
    ['identity not checked', { ...DELETION, identityChecked: false }],
    ['identity checked as text', { ...DELETION, identityChecked: 'true' }],
    ['no reference', { identityChecked: true, receivedOn: '2026-10-20' }],
  ])('answers 400 to %s, deleting nothing', async (_, body) => {
    const { auth } = await admin();
    const id = await person();

    const res = await act(id, 'delete-on-request', auth, body);

    expect(res.status).toBe(400);
    expect(
      await prisma.account.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: 'active' });
  });

  it('leaves one winner when two admins delete at once', async () => {
    const { auth } = await admin();
    const id = await person();

    const results = await Promise.all([
      act(id, 'delete-on-request', auth, DELETION),
      act(id, 'delete-on-request', auth, DELETION),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
    expect(await auditOf(id, 'account_deleted')).toHaveLength(1);
  });

  it('counts the deletion', async () => {
    const { auth } = await admin();
    const id = await person();
    const done = await actions('delete_on_request', 'done');

    await act(id, 'delete-on-request', auth, DELETION).expect(204);

    expect(await actions('delete_on_request', 'done')).toBe(done + 1);
  });
});

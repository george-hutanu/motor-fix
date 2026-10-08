import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import type { Role } from '../../../auth/capabilities';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { NotificationsModule } from '../../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { PlatformRulesModule } from '../platform-rules.module';

const redisUrl = redisUrlFor(10);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const REVIEWS = 'reviews_only_after_confirmed_job';
const NON_ADMIN = ['driver', 'garage', 'receptionist', 'mechanic'] as const;
const NOBODY = '00000000-0000-4000-8000-000000000000';

let app: INestApplication;

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
      PlatformRulesModule.register(
        { production: false, webUrl: 'https://motorfix.test' },
        notifications,
      ),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
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
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.platformRuleChange.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.platformRule.updateMany({
    data: { updatedAt: null, updatedBy: null, value: true },
    where: { key: REVIEWS },
  });
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const as = async (role: Role, name = `Cont ${role}`) =>
  bearer(await account(name, [role]), role);

const server = () => request(app.getHttpServer());

const list = (key: string, auth?: string) => {
  const call = server().get('/admin/platform-rule-changes').query({ key });
  return auth ? call.set('Authorization', auth) : call;
};

const ask = (body: unknown, auth?: string) => {
  const call = server()
    .post('/admin/platform-rule-changes')
    .send(body as object);
  return auth ? call.set('Authorization', auth) : call;
};

const decide = (
  id: string,
  step: 'approve' | 'refuse' | 'cancel',
  auth?: string,
) => {
  const call = server().post(`/admin/platform-rule-changes/${id}/${step}`);
  return auth ? call.set('Authorization', auth) : call;
};

const reviews = async () =>
  (await prisma.platformRule.findUniqueOrThrow({ where: { key: REVIEWS } }))
    .value;

const REASON = 'Testăm recenziile din profil.';

describe('POST /admin/platform-rule-changes', () => {
  it('answers 201 with the waiting request, and the rule stays on', async () => {
    const res = await ask({ key: REVIEWS, reason: REASON }, await as('admin'));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      decidedAt: null,
      decidedByName: null,
      key: REVIEWS,
      mine: true,
      reason: REASON,
      requestedByName: 'Cont',
      status: 'requested',
    });
    expect(await reviews()).toBe(true);
  });

  it('answers the refusals in their order with their code', async () => {
    const ioana = await as('admin', 'Ioana Popa');
    const mihai = await as('admin', 'Mihai Ionescu');

    const unknown = await ask({ key: 'free_beer', reason: 'x' }, ioana);
    const oneAdmin = await ask(
      { key: 'maintenance_mode', reason: REASON },
      ioana,
    );
    const short = await ask({ key: REVIEWS, reason: ' abc ' }, ioana);
    const missing = await ask({ key: REVIEWS }, ioana);
    await ask({ key: REVIEWS, reason: REASON }, ioana);
    const pending = await ask({ key: REVIEWS, reason: REASON }, mihai);

    expect(
      [unknown, oneAdmin, short, missing, pending].map((r) => [
        r.status,
        r.body.code,
      ]),
    ).toEqual([
      [404, 'not_found'],
      [404, 'not_found'],
      [400, 'validation_failed'],
      [400, 'validation_failed'],
      [409, 'change_pending'],
    ]);
  });

  it('answers 409 stale_value when the rule is already off', async () => {
    await prisma.platformRule.update({
      data: { value: false },
      where: { key: REVIEWS },
    });

    const res = await ask({ key: REVIEWS, reason: REASON }, await as('admin'));

    expect([res.status, res.body.code]).toEqual([409, 'stale_value']);
  });

  it('answers 400 to a field it does not take', async () => {
    const res = await ask(
      { key: REVIEWS, reason: REASON, seen: true },
      await as('admin'),
    );

    expect(res.status).toBe(400);
  });

  it.each(NON_ADMIN)('answers 404 to a %s and keeps nothing', async (role) => {
    const res = await ask({ key: REVIEWS, reason: REASON }, await as(role));

    expect(res.status).toBe(404);
    expect(await prisma.platformRuleChange.count()).toBe(0);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const res = await ask({ key: REVIEWS, reason: REASON });

    expect([res.status, res.body.code]).toEqual([401, 'sign_in_required']);
  });
});

describe('POST /admin/platform-rule-changes/:id/approve|refuse|cancel', () => {
  let ioana: string;
  let mihai: string;
  let id: string;

  beforeEach(async () => {
    ioana = await as('admin', 'Ioana Popa');
    mihai = await as('admin', 'Mihai Ionescu');
    id = (await ask({ key: REVIEWS, reason: REASON }, ioana)).body.id;
  });

  it('turns the rule off when another admin approves', async () => {
    const res = await decide(id, 'approve', mihai);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      decidedByName: 'Mihai',
      mine: false,
      status: 'approved',
    });
    expect(await reviews()).toBe(false);
  });

  it('leaves the rule on when another admin refuses', async () => {
    const res = await decide(id, 'refuse', mihai);

    expect([res.status, res.body.status]).toEqual([200, 'refused']);
    expect(await reviews()).toBe(true);
  });

  it('lets the asker withdraw', async () => {
    const res = await decide(id, 'cancel', ioana);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      decidedByName: 'Ioana',
      mine: true,
      status: 'cancelled',
    });
  });

  it('answers each refused step with its code and writes nothing', async () => {
    const entries = () => prisma.activityLog.count();
    const events = () => prisma.outboxEvent.count();
    const before = [await entries(), await events()];

    const own = await decide(id, 'approve', ioana);
    const other = await decide(id, 'cancel', mihai);
    const unknown = await decide(NOBODY, 'refuse', mihai);
    await decide(id, 'refuse', mihai);
    const after = [await entries(), await events()];
    const late = await decide(id, 'approve', mihai);

    expect(
      [own, other, unknown, late].map((r) => [r.status, r.body.code]),
    ).toEqual([
      [403, 'own_request'],
      [403, 'not_requester'],
      [404, 'not_found'],
      [409, 'already_decided'],
    ]);
    expect(late.body.message).toContain('Mihai');
    expect(after[0] - before[0]).toBe(1);
    expect(after[1] - before[1]).toBe(1);
    expect([await entries(), await events()]).toEqual(after);
  });

  it.each(NON_ADMIN)('answers 404 to a %s on every step', async (role) => {
    const auth = await as(role);

    for (const step of ['approve', 'refuse', 'cancel'] as const) {
      expect((await decide(id, step, auth)).status).toBe(404);
    }
    expect(await reviews()).toBe(true);
  });

  it('answers 401 without a session', async () => {
    expect((await decide(id, 'approve')).status).toBe(401);
  });
});

describe('GET /admin/platform-rule-changes?key=', () => {
  it('lists the waiting request, marked as theirs for the asker only', async () => {
    const ioana = await as('admin', 'Ioana Popa');
    const mihai = await as('admin', 'Mihai Ionescu');
    await ask({ key: REVIEWS, reason: REASON }, ioana);

    const mine = await list(REVIEWS, ioana);
    const theirs = await list(REVIEWS, mihai);

    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({
      decided: [],
      waiting: { mine: true, reason: REASON, requestedByName: 'Ioana' },
    });
    expect(theirs.body.waiting.mine).toBe(false);
  });

  it('answers 404 for an unknown rule', async () => {
    expect((await list('free_beer', await as('admin'))).status).toBe(404);
  });

  it.each(NON_ADMIN)('answers 404 to a %s', async (role) => {
    expect((await list(REVIEWS, await as(role))).status).toBe(404);
  });

  it('answers 401 without a session', async () => {
    expect((await list(REVIEWS)).status).toBe(401);
  });
});

describe('the direct change, beside the requests', () => {
  it('still refuses the switch off and lets one admin switch it back on', async () => {
    const admin = await as('admin');
    const off = await server()
      .patch(`/admin/platform-rules/${REVIEWS}`)
      .set('Authorization', admin)
      .send({ seen: true, value: false });
    await prisma.platformRule.update({
      data: { value: false },
      where: { key: REVIEWS },
    });
    const on = await server()
      .patch(`/admin/platform-rules/${REVIEWS}`)
      .set('Authorization', admin)
      .send({ seen: false, value: true });

    expect([off.status, off.body.code]).toEqual([409, 'two_admins_required']);
    expect(on.status).toBe(200);
  });
});

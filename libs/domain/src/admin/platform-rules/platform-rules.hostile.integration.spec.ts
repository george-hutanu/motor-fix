import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PlatformRulesModule } from './platform-rules.module';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';

const redisUrl = redisUrlFor(14);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const TEST_ONLY = ['skip_manual_approval', 'skip_rar_check'];

const boot = async (production: boolean) => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      PlatformRulesModule.register({ production }),
    ],
  }).compile();
  const nest = moduleRef.createNestApplication();
  nest.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await nest.init();
  return nest;
};

let app: INestApplication;
let prod: INestApplication;

beforeAll(async () => {
  app = await boot(false);
  prod = await boot(true);
});

afterAll(async () => {
  await app.close();
  await prod.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  await prisma.platformRule.deleteMany({ where: { key: { in: TEST_ONLY } } });
  await prisma.platformRule.updateMany({
    data: { updatedAt: null, updatedBy: null, value: false },
    where: { key: 'maintenance_mode' },
  });
  await prisma.platformRule.updateMany({
    data: { updatedAt: null, updatedBy: null, value: true },
    where: { key: 'reviews_only_after_confirmed_job' },
  });
  await prisma.platformRule.createMany({
    data: TEST_ONLY.map((key) => ({ defaultValue: false, key, value: false })),
  });
});

let adminId = '';
const admin = async () => {
  adminId = await account('Admin', ['admin']);
  return `Bearer ${signAccessToken({ accountId: adminId, role: 'admin' }, tokenSecret)}`;
};

const asRole = async (role: Role) =>
  `Bearer ${signAccessToken(
    { accountId: await account(`Cont ${role}`, [role]), role },
    tokenSecret,
  )}`;

const patch = (
  target: INestApplication,
  key: string,
  body: unknown,
  auth: string,
) =>
  request(target.getHttpServer())
    .patch(`/admin/platform-rules/${encodeURIComponent(key)}`)
    .set('Authorization', auth)
    .send(body as object);

const rule = (key: string) =>
  prisma.platformRule.findUniqueOrThrow({ where: { key } });
const entries = () =>
  prisma.activityLog.findMany({
    where: { actorId: adminId, subjectType: 'platform_rule' },
  });
const events = () =>
  prisma.outboxEvent.findMany({ where: { kind: 'platform_rule.changed' } });

const codeOf = (res: request.Response) => [res.status, res.body.code];

describe('the order of the checks on a rule change', () => {
  it('answers 404 before 400 for a test-only key in production with a malformed value', async () => {
    const res = await patch(
      prod,
      'skip_rar_check',
      { seen: 'x', value: 'on' },
      await admin(),
    );

    expect(codeOf(res)).toEqual([404, 'not_found']);
  });

  it('answers 404 for an unknown key whatever the body holds', async () => {
    const res = await patch(
      app,
      'nope',
      { seen: true, value: true },
      await admin(),
    );

    expect(codeOf(res)).toEqual([404, 'not_found']);
  });

  it('answers 400 before 409 stale when the value is malformed and seen is stale', async () => {
    const res = await patch(
      app,
      'maintenance_mode',
      { seen: true, value: 'on' },
      await admin(),
    );

    expect(codeOf(res)).toEqual([400, 'validation_failed']);
  });

  it('answers 409 stale_value before the two-admin refusal when seen is wrong', async () => {
    const res = await patch(
      app,
      'reviews_only_after_confirmed_job',
      { seen: false, value: false },
      await admin(),
    );

    expect(codeOf(res)).toEqual([409, 'stale_value']);
  });

  it('answers a no-op 200 for a two-admin rule set to its current true value', async () => {
    const res = await patch(
      app,
      'reviews_only_after_confirmed_job',
      { seen: true, value: true },
      await admin(),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      key: 'reviews_only_after_confirmed_job',
      updatedAt: null,
      value: true,
    });
    expect(await entries()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });

  it('answers 409 stale_value for an unchanged value whose seen differs', async () => {
    const res = await patch(
      app,
      'maintenance_mode',
      { seen: true, value: false },
      await admin(),
    );

    expect(codeOf(res)).toEqual([409, 'stale_value']);
  });
});

describe('hostile request bodies', () => {
  it.each([
    ['null', null],
    ['a number', 1],
    ['a numeric string', 'true'],
    ['an array', [true]],
    ['an object', { a: true }],
    ['zero', 0],
  ])('answers 400 validation_failed for %s as the value', async (_n, value) => {
    const res = await patch(
      app,
      'maintenance_mode',
      { seen: false, value },
      await admin(),
    );

    expect(res.status).toBe(400);
    expect((await rule('maintenance_mode')).value).toBe(false);
  });

  it('answers 400 for null as seen', async () => {
    const res = await patch(
      app,
      'maintenance_mode',
      { seen: null, value: true },
      await admin(),
    );

    expect(res.status).toBe(400);
    expect((await rule('maintenance_mode')).value).toBe(false);
  });

  it.each([
    ['a string', 'false'],
    ['a number', 0],
  ])('answers 409 stale_value for %s as seen', async (_n, seen) => {
    const res = await patch(
      app,
      'maintenance_mode',
      { seen, value: true },
      await admin(),
    );

    expect(codeOf(res)).toEqual([409, 'stale_value']);
    expect((await rule('maintenance_mode')).value).toBe(false);
  });

  it('answers 400 for an empty body', async () => {
    const res = await patch(app, 'maintenance_mode', {}, await admin());

    expect(res.status).toBe(400);
  });

  it.each([
    ['upper case', 'MAINTENANCE_MODE'],
    ['padded', ' maintenance_mode'],
    ['unicode lookalike', 'maintenance_mоde'],
    ['a path traversal', '../maintenance_mode'],
    ['a sql fragment', "x'; DROP TABLE platform_rule;--"],
  ])('answers 404 for a key that is %s', async (_n, key) => {
    const res = await patch(
      app,
      key,
      { seen: false, value: true },
      await admin(),
    );

    expect(res.status).toBe(404);
    expect((await rule('maintenance_mode')).value).toBe(false);
  });

  it.each(['driver', 'garage', 'receptionist', 'mechanic'] as const)(
    'answers a %s 404 even for a malformed body or unknown key',
    async (role) => {
      const auth = await asRole(role);

      const bad = await patch(app, 'maintenance_mode', { value: 7 }, auth);
      const unknown = await patch(app, 'nope', { seen: 1, value: 1 }, auth);

      expect([bad.status, unknown.status]).toEqual([404, 404]);
    },
  );
});

describe('what a saved change leaves behind', () => {
  it('writes exactly one entry and one event over HTTP', async () => {
    const res = await patch(
      app,
      'skip_rar_check',
      { seen: false, value: true },
      await admin(),
    );

    expect(res.status).toBe(200);
    expect(await entries()).toHaveLength(1);
    expect(await events()).toHaveLength(1);
  });

  it('refuses the same change sent twice the second time as stale and writes once', async () => {
    const auth = await admin();
    const body = { seen: false, value: true };

    const first = await patch(app, 'maintenance_mode', body, auth);
    const second = await patch(app, 'maintenance_mode', body, auth);

    expect([first.status, codeOf(second)]).toEqual([200, [409, 'stale_value']]);
    expect(await entries()).toHaveLength(1);
    expect(await events()).toHaveLength(1);
  });

  it('writes one entry per change when a rule is switched on and back off', async () => {
    const auth = await admin();

    await patch(app, 'maintenance_mode', { seen: false, value: true }, auth);
    const back = await patch(
      app,
      'maintenance_mode',
      { seen: true, value: false },
      auth,
    );

    expect(back.status).toBe(200);
    expect(back.body.value).toBe(false);
    expect(await entries()).toHaveLength(2);
    expect(await events()).toHaveLength(2);
  });

  it('does not move updatedAt or updatedBy on an unchanged no-op after a real change', async () => {
    const auth = await admin();
    const saved = await patch(
      app,
      'maintenance_mode',
      { seen: false, value: true },
      auth,
    );

    const again = await patch(
      app,
      'maintenance_mode',
      { seen: true, value: true },
      auth,
    );

    expect(again.status).toBe(200);
    expect(again.body.updatedAt).toBe(saved.body.updatedAt);
    expect(again.body.updatedBy).toBe(saved.body.updatedBy);
    expect(await entries()).toHaveLength(1);
  });

  it('writes nothing for a 400, a 404 and a stale 409', async () => {
    const auth = await admin();

    await patch(app, 'maintenance_mode', { seen: false, value: 'x' }, auth);
    await patch(app, 'nope', { seen: false, value: true }, auth);
    await patch(app, 'maintenance_mode', { seen: true, value: true }, auth);

    expect(await entries()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });

  it('keeps two simultaneous changes of different rules both', async () => {
    const auth = await admin();

    const [a, b] = await Promise.all([
      patch(app, 'maintenance_mode', { seen: false, value: true }, auth),
      patch(app, 'skip_rar_check', { seen: false, value: true }, auth),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await entries()).toHaveLength(2);
    expect(await events()).toHaveLength(2);
  });
});

describe('production over HTTP', () => {
  it('lists only the two always-present rules, ordered by key, with production true', async () => {
    const res = await request(prod.getHttpServer())
      .get('/admin/platform-rules')
      .set('Authorization', await admin());

    expect(res.status).toBe(200);
    expect(res.body.production).toBe(true);
    expect(res.body.rules.map((r: { key: string }) => r.key)).toEqual([
      'maintenance_mode',
      'reviews_only_after_confirmed_job',
    ]);
  });

  it.each(TEST_ONLY)(
    'answers 404 to a change of %s and leaves it',
    async (key) => {
      const res = await patch(
        prod,
        key,
        { seen: false, value: true },
        await admin(),
      );

      expect(codeOf(res)).toEqual([404, 'not_found']);
      expect((await rule(key)).value).toBe(false);
      expect(await events()).toHaveLength(0);
    },
  );

  it('still lets an admin change maintenance_mode', async () => {
    const res = await patch(
      prod,
      'maintenance_mode',
      { seen: false, value: true },
      await admin(),
    );

    expect(res.status).toBe(200);
  });

  it('answers 404 for a non-admin on the list', async () => {
    const res = await request(prod.getHttpServer())
      .get('/admin/platform-rules')
      .set('Authorization', await asRole('garage'));

    expect(res.status).toBe(404);
  });

  it('lists no test-only rule when the table holds none outside production either', async () => {
    await prisma.platformRule.deleteMany({ where: { key: { in: TEST_ONLY } } });

    const res = await request(app.getHttpServer())
      .get('/admin/platform-rules')
      .set('Authorization', await admin());

    expect(res.body.rules.map((r: { key: string }) => r.key)).toEqual([
      'maintenance_mode',
      'reviews_only_after_confirmed_job',
    ]);
  });
});

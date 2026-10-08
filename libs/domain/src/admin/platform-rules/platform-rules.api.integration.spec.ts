import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PlatformRulesModule } from './platform-rules.module';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';

const redisUrl = redisUrlFor(14);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NON_ADMIN = ['driver', 'garage', 'receptionist', 'mechanic'] as const;

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
      PlatformRulesModule.register({ production: false }, notifications),
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
  await prisma.platformRule.updateMany({
    data: { updatedAt: null, updatedBy: null, value: false },
    where: { key: 'maintenance_mode' },
  });
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const as = async (role: Role) =>
  bearer(await account(`Cont ${role}`, [role]), role);

const list = (auth?: string) => {
  const call = request(app.getHttpServer()).get('/admin/platform-rules');
  return auth ? call.set('Authorization', auth) : call;
};

const change = (key: string, body: unknown, auth?: string) => {
  const call = request(app.getHttpServer())
    .patch(`/admin/platform-rules/${key}`)
    .send(body as object);
  return auth ? call.set('Authorization', auth) : call;
};

describe('GET /admin/platform-rules', () => {
  it('answers an admin with the rules and the production flag', async () => {
    const res = await list(await as('admin'));

    expect(res.status).toBe(200);
    expect(res.body.production).toBe(false);
    expect(res.body.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          defaultValue: false,
          key: 'maintenance_mode',
          requiresTwoAdmins: false,
          value: false,
        }),
        expect.objectContaining({
          key: 'reviews_only_after_confirmed_job',
          requiresTwoAdmins: true,
          value: true,
        }),
      ]),
    );
  });

  it.each(NON_ADMIN)('answers 404 to a %s', async (role) => {
    expect((await list(await as(role))).status).toBe(404);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const res = await list();

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });
});

describe('PATCH /admin/platform-rules/:key', () => {
  it('saves a change for an admin and answers the rule', async () => {
    const res = await change(
      'maintenance_mode',
      { seen: false, value: true },
      await as('admin'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'maintenance_mode', value: true });
    expect(res.body.updatedAt).toEqual(expect.any(String));
  });

  it.each(NON_ADMIN)(
    'answers 404 to a %s and changes nothing',
    async (role) => {
      const res = await change(
        'maintenance_mode',
        { seen: false, value: true },
        await as(role),
      );

      expect(res.status).toBe(404);
      expect(
        (
          await prisma.platformRule.findUniqueOrThrow({
            where: { key: 'maintenance_mode' },
          })
        ).value,
      ).toBe(false);
    },
  );

  it('answers 401 sign_in_required without a session', async () => {
    const res = await change('maintenance_mode', { seen: false, value: true });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 400 when the seen value is missing or a field is extra', async () => {
    const admin = await as('admin');

    expect(
      (await change('maintenance_mode', { value: true }, admin)).status,
    ).toBe(400);
    expect(
      (
        await change(
          'maintenance_mode',
          { extra: 1, seen: false, value: true },
          admin,
        )
      ).status,
    ).toBe(400);
  });

  it('answers the refusals with their snake-case code', async () => {
    const admin = await as('admin');

    const unknown = await change(
      'free_beer',
      { seen: false, value: true },
      admin,
    );
    const shape = await change(
      'maintenance_mode',
      { seen: false, value: 'on' },
      admin,
    );
    const stale = await change(
      'maintenance_mode',
      { seen: true, value: false },
      admin,
    );
    const twoAdmins = await change(
      'reviews_only_after_confirmed_job',
      { seen: true, value: false },
      admin,
    );

    expect(
      [unknown, shape, stale, twoAdmins].map((r) => [r.status, r.body.code]),
    ).toEqual([
      [404, 'not_found'],
      [400, 'validation_failed'],
      [409, 'stale_value'],
      [409, 'two_admins_required'],
    ]);
  });
});

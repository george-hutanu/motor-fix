import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';

import { BrevoMock } from './brevo/brevo-mock.testing';
import { NotificationsModule } from './notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { signAccessToken } from '../auth/access-token';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { serialDatabase } from '../auth/serial-db.testing';

const redisUrl = redisUrlFor(13);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
let app: INestApplication;

beforeAll(async () => {
  await mock.start();
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      NotificationsModule.register(
        { databaseUrl, email: testConfig(mock.url), redisUrl },
        auth,
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
  await queue.close();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const sendTest = (body: unknown, auth?: string) => {
  const call = request(app.getHttpServer())
    .post('/admin/notifications/test')
    .send(body as object);
  return auth ? call.set('Authorization', auth) : call;
};

describe('the admin test message', () => {
  it('sends a test e-mail to a driver, a garage owner, a mechanic and an admin', async () => {
    const admin = await account('admin', ['admin']);
    const ids = [
      await account('driver', ['driver']),
      await account('owner', ['garage']),
      await account('mechanic', ['mechanic']),
      admin,
    ];
    const res = await sendTest({ accountIds: ids }, bearer(admin, 'admin'));
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: 4 });
    const rows = await prisma.notification.findMany({
      where: { kind: 'TEST_MESSAGE' },
    });
    expect(rows.filter((r) => r.channel === 'email')).toHaveLength(4);
    expect(rows.filter((r) => r.channel === 'in_app')).toHaveLength(4);
    for (const id of ids) {
      expect(
        rows.find((r) => r.accountId === id && r.channel === 'email')
          ?.subjectId,
      ).toBe(id);
    }
    expect(await queue.getJobCounts('waiting', 'delayed')).toMatchObject({
      waiting: 4,
    });
  });

  it('leaves an entry an admin can read in the admin actions history', async () => {
    const admin = await account('ana', ['admin']);
    const driver = await account('driver', ['driver']);

    const res = await sendTest(
      { accountIds: [driver] },
      bearer(admin, 'admin'),
    );

    expect(res.status).toBe(202);
    const history = await request(app.getHttpServer())
      .get('/audit-history')
      .query({ actorId: admin, area: 'admin_actions' })
      .set('Authorization', bearer(admin, 'admin'));
    expect(history.status).toBe(200);
    expect(
      history.body.items.filter(
        (item: { kind: string | null }) => item.kind === 'notification.test',
      ),
    ).toEqual([
      expect.objectContaining({
        action: 'create',
        actor: expect.objectContaining({ id: admin, role: 'admin' }),
        kind: 'notification.test',
        newValue: { accountIds: [driver] },
        subjectId: admin,
        subjectType: 'account',
      }),
    ]);
  });

  it('sends again when the admin asks again', async () => {
    const admin = await account('admin', ['admin']);
    await sendTest({ accountIds: [admin] }, bearer(admin, 'admin'));
    await sendTest({ accountIds: [admin] }, bearer(admin, 'admin'));
    expect(
      await prisma.notification.count({ where: { channel: 'email' } }),
    ).toBe(2);
  });

  it.each(['driver', 'garage', 'receptionist', 'mechanic'] as const)(
    'answers 404 to a %s',
    async (role) => {
      const caller = await account(`caller-${role}`, [role]);
      const res = await sendTest(
        { accountIds: [caller] },
        bearer(caller, role),
      );
      expect(res.status).toBe(404);
      expect(await prisma.notification.count()).toBe(0);
    },
  );

  it('asks for a session without one', async () => {
    const res = await sendTest({ accountIds: [randomUUID()] });
    expect(res.status).toBe(401);
  });

  it.each([
    ['an id that is no account', () => [randomUUID()]],
    [
      'a deleted account',
      async () => [await account('gone', ['driver'], { status: 'deleted' })],
    ],
  ])('refuses %s and sends nothing', async (_label, ids) => {
    const admin = await account('admin', ['admin']);
    const driver = await account('driver', ['driver']);
    const res = await sendTest(
      { accountIds: [driver, ...(await ids())] },
      bearer(admin, 'admin'),
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('unknown_recipient');
    expect(await prisma.notification.count()).toBe(0);
    expect(
      await prisma.activityLog.count({
        where: { actorId: admin, kind: 'notification.test' },
      }),
    ).toBe(0);
  });

  it.each([
    ['no ids', []],
    ['21 ids', Array.from({ length: 21 }, () => randomUUID())],
    [
      'the same id twice',
      [
        '6d1f6a9c-1b7e-4a52-9a5b-1c1a2e3f4a5b',
        '6d1f6a9c-1b7e-4a52-9a5b-1c1a2e3f4a5b',
      ],
    ],
    ['a value that is not an id', ['admin']],
  ])('refuses %s', async (_label, accountIds) => {
    const admin = await account('admin', ['admin']);
    const res = await sendTest({ accountIds }, bearer(admin, 'admin'));
    expect(res.status).toBe(400);
  });
});

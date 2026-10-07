import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';

import { BrevoMock } from './brevo-mock.testing';
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

const entries = (actorId: string) =>
  prisma.activityLog.findMany({
    where: { actorId, kind: 'notification.test' },
  });

const history = (auth: string) =>
  request(app.getHttpServer())
    .get('/audit-history')
    .query({ area: 'admin_actions' })
    .set('Authorization', auth);

describe('the admin test message audit entry', () => {
  it('records one entry per call when the same call is made twice', async () => {
    const admin = await account('Ana', ['admin']);
    const driver = await account('driver', ['driver']);

    await sendTest({ accountIds: [driver] }, bearer(admin, 'admin'));
    await sendTest({ accountIds: [driver] }, bearer(admin, 'admin'));

    expect(await entries(admin)).toHaveLength(2);
  });

  it('records nothing for a body the validation refuses', async () => {
    const admin = await account('Ana', ['admin']);

    const res = await sendTest(
      { accountIds: [randomUUID()], extra: 1 },
      bearer(admin, 'admin'),
    );

    expect(res.status).toBe(400);
    expect(await entries(admin)).toEqual([]);
  });

  it('shows the actor by first name in the admin actions history', async () => {
    const admin = await account('Ana Maria Popescu', ['admin']);

    await sendTest({ accountIds: [admin] }, bearer(admin, 'admin'));

    const res = await history(bearer(admin, 'admin'));
    const mine = res.body.items.filter(
      (item: { kind: string | null; actor: { id: string } }) =>
        item.kind === 'notification.test' && item.actor.id === admin,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].actor).toMatchObject({ id: admin, name: 'Ana' });
  });

  it('keeps the entry out of what a driver can read', async () => {
    const admin = await account('Ana', ['admin']);
    const driver = await account('driver', ['driver']);
    await sendTest({ accountIds: [driver] }, bearer(admin, 'admin'));

    const res = await history(bearer(driver, 'driver'));

    expect(JSON.stringify(res.body)).not.toContain('notification.test');
    expect(res.status).not.toBe(200);
  });
});

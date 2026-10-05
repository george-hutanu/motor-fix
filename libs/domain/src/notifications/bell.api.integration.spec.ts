import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { BellService } from './bell.service';
import { NotificationsModule } from './notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { signAccessToken } from '../auth/access-token';
import { AuthModule } from '../auth/auth.module';
import { serialDatabase } from '../auth/serial-db.testing';

const redisUrl = redisUrlFor(15);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const subscriber = new Redis(redisUrl);
const published: { audience: string[]; event: { kind: string } }[] = [];
let app: INestApplication;

beforeAll(async () => {
  await subscriber.subscribe('live:events');
  subscriber.on('message', (_channel, message) =>
    published.push(JSON.parse(message)),
  );
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      NotificationsModule.register(
        { databaseUrl, email: testConfig('http://127.0.0.1:9'), redisUrl },
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
  subscriber.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  published.length = 0;
});

const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, tokenSecret)}`;

const DAY = 24 * 60 * 60 * 1000;

// One row per call, `ago` milliseconds old.
async function bell(
  accountId: string,
  options: {
    ago?: number;
    channel?: 'in_app' | 'email';
    kind?: string;
    params?: Record<string, unknown>;
    readAt?: Date;
  } = {},
) {
  const row = await prisma.notification.create({
    data: {
      accountId,
      channel: options.channel ?? 'in_app',
      createdAt: new Date(Date.now() - (options.ago ?? 0)),
      eventId: randomUUID(),
      kind: options.kind ?? 'TEST_MESSAGE',
      params: (options.params ?? {}) as object,
      readAt: options.readAt,
      status: 'sent',
    },
  });
  return row.id;
}

const get = (path: string, accountId: string) =>
  request(app.getHttpServer())
    .get(path)
    .set('Authorization', bearer(accountId));

const post = (path: string, accountId: string) =>
  request(app.getHttpServer())
    .post(path)
    .set('Authorization', bearer(accountId));

describe('the bell list', () => {
  it("lists the person's own bell rows newest first, 20 a page", async () => {
    const andrei = await account('andrei');
    const other = await account('other');
    const ids: string[] = [];
    for (let i = 0; i < 25; i++)
      ids.push(await bell(andrei, { ago: i * 1000 }));
    await bell(other);

    const first = await get('/notifications', andrei).expect(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.items.map((n: { id: string }) => n.id)).toEqual(
      ids.slice(0, 20),
    );
    expect(first.body.items[0]).toEqual({
      at: expect.any(String),
      id: ids[0],
      kind: 'TEST_MESSAGE',
      readAt: null,
      subjectId: null,
      text: 'Mesaj de test: notificările funcționează.',
    });
    expect(first.body.nextCursor).toBe(ids[19]);

    const second = await get(
      `/notifications?cursor=${first.body.nextCursor}`,
      andrei,
    ).expect(200);
    expect(second.body.items.map((n: { id: string }) => n.id)).toEqual(
      ids.slice(20),
    );
    expect(second.body.nextCursor).toBeNull();
  });

  it('leaves out rows older than 90 days and other channels', async () => {
    const andrei = await account('andrei');
    const kept = await bell(andrei, { ago: 89 * DAY });
    await bell(andrei, { ago: 91 * DAY });
    await bell(andrei, { channel: 'email' });

    const res = await get('/notifications', andrei).expect(200);

    expect(res.body.items.map((n: { id: string }) => n.id)).toEqual([kept]);
  });

  it("refuses a cursor that is not one of the person's rows", async () => {
    const andrei = await account('andrei');
    const other = await account('other');
    const theirs = await bell(other);

    const res = await get(`/notifications?cursor=${theirs}`, andrei).expect(
      400,
    );

    expect(res.body.code).toBe('invalid_cursor');
  });

  it("renders each text in the language asked, else the account's", async () => {
    const maria = await account('maria', ['driver'], { language: 'en' });
    await bell(maria);
    await bell(maria, { ago: 1000, kind: 'NO_SUCH_KIND' });

    const own = await get('/notifications', maria).expect(200);
    const asked = await get('/notifications?language=ro', maria).expect(200);

    expect(own.body.items.map((n: { text: string }) => n.text)).toEqual([
      'Test message: notifications work.',
      'You have a new notification',
    ]);
    expect(asked.body.items[0].text).toBe(
      'Mesaj de test: notificările funcționează.',
    );
    await get('/notifications?language=de', maria).expect(400);
  });

  it('answers 401 without a session', async () => {
    await request(app.getHttpServer()).get('/notifications').expect(401);
  });
});

describe('the unread count', () => {
  it('counts the unread bell rows of the last 90 days', async () => {
    const andrei = await account('andrei');
    await bell(andrei);
    await bell(andrei, { ago: 10 * DAY });
    await bell(andrei, { readAt: new Date() });
    await bell(andrei, { ago: 91 * DAY });
    await bell(andrei, { channel: 'email' });
    await bell(await account('other'));

    const res = await get('/notifications/unread-count', andrei).expect(200);

    expect(res.body).toEqual({ count: 2 });
  });
});

describe('marking read', () => {
  it('marks one read and keeps the first read time', async () => {
    const andrei = await account('andrei');
    const id = await bell(andrei);

    const first = await post(`/notifications/${id}/read`, andrei).expect(200);
    const second = await post(`/notifications/${id}/read`, andrei).expect(200);

    expect(first.body.id).toBe(id);
    expect(first.body.readAt).toEqual(expect.any(String));
    expect(second.body.readAt).toBe(first.body.readAt);
    const row = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(row.readAt?.toISOString()).toBe(first.body.readAt);
    const count = await get('/notifications/unread-count', andrei);
    expect(count.body).toEqual({ count: 0 });
  });

  it("answers 404 for another person's notification", async () => {
    const andrei = await account('andrei');
    const theirs = await bell(await account('other'));
    const email = await bell(andrei, { channel: 'email' });

    await post(`/notifications/${theirs}/read`, andrei).expect(404);
    await post(`/notifications/${email}/read`, andrei).expect(404);
    await post(`/notifications/${randomUUID()}/read`, andrei).expect(404);
    await post('/notifications/not-a-uuid/read', andrei).expect(400);

    const row = await prisma.notification.findUniqueOrThrow({
      where: { id: theirs },
    });
    expect(row.readAt).toBeNull();
  });

  it("marks all of the person's rows read and no one else's", async () => {
    const andrei = await account('andrei');
    const other = await account('other');
    await bell(andrei);
    await bell(andrei, { ago: 1000 });
    const theirs = await bell(other);

    await post('/notifications/read-all', andrei).expect(204);

    expect((await get('/notifications/unread-count', andrei)).body).toEqual({
      count: 0,
    });
    const row = await prisma.notification.findUniqueOrThrow({
      where: { id: theirs },
    });
    expect(row.readAt).toBeNull();
  });

  it("announces a read on the person's channel, and a read that changed nothing not at all", async () => {
    const andrei = await account('andrei');
    const id = await bell(andrei);
    await bell(andrei, { ago: 1000 });

    await post(`/notifications/${id}/read`, andrei).expect(200);
    await post(`/notifications/${id}/read`, andrei).expect(200);
    await post('/notifications/read-all', andrei).expect(204);
    await post('/notifications/read-all', andrei).expect(204);

    const reads = () =>
      published.filter(
        (m) =>
          m.event.kind === 'notification.read' &&
          m.audience.join() === `account:${andrei}`,
      );
    for (let i = 0; i < 50 && reads().length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Long enough for a third, wrong, announcement to arrive.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reads()).toHaveLength(2);
  });

  it('still marks read when Redis does not answer', async () => {
    const andrei = await account('andrei');
    const id = await bell(andrei);
    await bell(andrei, { ago: 1000 });
    const down = new BellService(prisma, {
      publish: () => Promise.reject(new Error('redis down')),
    });

    await expect(down.read(andrei, id)).resolves.toMatchObject({ id });
    await expect(down.readAll(andrei)).resolves.toBeUndefined();

    expect(await down.unreadCount(andrei)).toBe(0);
  });
});

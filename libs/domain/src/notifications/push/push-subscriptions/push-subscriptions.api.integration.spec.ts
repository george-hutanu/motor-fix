// @traces 196-FR-001 196-FR-002 196-FR-003 196-FR-014 196-FR-016 196-FR-018
import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { generateVAPIDKeys } from 'web-push';

import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications.testing';

const redisUrl = redisUrlFor(2);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const vapid = generateVAPIDKeys();
const push = {
  privateKey: vapid.privateKey,
  publicKey: vapid.publicKey,
  subject: 'mailto:ops@example.test',
};

async function start(config: typeof push | null) {
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      NotificationsModule.register(
        {
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          push: config,
          redisUrl,
        },
        auth,
      ),
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
  return app;
}

let app: INestApplication;

beforeAll(async () => {
  app = await start(push);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => reset());

const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, tokenSecret)}`;

const body = (n = 1, extra: Record<string, unknown> = {}) => ({
  endpoint: `https://push.example.test/send/${n}`,
  keys: { auth: 'YXV0aA', p256dh: 'cDI1Ng' },
  label: 'Chrome on Android',
  ...extra,
});

const save = (accountId: string, payload: unknown) =>
  request(app.getHttpServer())
    .post('/push-subscriptions')
    .set('Authorization', bearer(accountId))
    .send(payload as object);

describe('GET /push-subscriptions/key', () => {
  it('gives the public key to a signed-in person', async () => {
    const ana = await account('ana');
    const res = await request(app.getHttpServer())
      .get('/push-subscriptions/key')
      .set('Authorization', bearer(ana))
      .expect(200);
    expect(res.body).toEqual({ publicKey: vapid.publicKey });
  });

  it('refuses a visitor', async () => {
    await request(app.getHttpServer())
      .get('/push-subscriptions/key')
      .expect(401);
  });
});

describe('POST /push-subscriptions', () => {
  it('saves the device with its keys and label', async () => {
    const ana = await account('ana');
    const res = await save(ana, body()).expect(200);
    const saved = await prisma.pushSubscription.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(saved).toMatchObject({
      accountId: ana,
      auth: 'YXV0aA',
      endpoint: 'https://push.example.test/send/1',
      label: 'Chrome on Android',
      p256dh: 'cDI1Ng',
    });
  });

  it('answers the same id when the browser saves twice, with the new keys', async () => {
    const ana = await account('ana');
    const first = await save(ana, body()).expect(200);
    const second = await save(ana, {
      ...body(),
      keys: { auth: 'bmV3', p256dh: 'bmV3' },
      label: 'Renamed',
    }).expect(200);
    expect(second.body.id).toBe(first.body.id);
    const all = await prisma.pushSubscription.findMany();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ auth: 'bmV3', label: 'Renamed' });
  });

  it('keeps one device when two saves arrive together', async () => {
    const ana = await account('ana');
    const answers = await Promise.all([save(ana, body()), save(ana, body())]);
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it('keeps the ten newest devices of an account: the oldest makes room', async () => {
    const ana = await account('ana');
    for (let i = 0; i < 11; i++) {
      await save(ana, body(i)).expect(200);
    }
    const kept = await prisma.pushSubscription.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(kept).toHaveLength(10);
    expect(kept[0].endpoint).toBe('https://push.example.test/send/1');
  });

  it('moves a shared browser to the account that saved it last, with a new id', async () => {
    const ana = await account('ana');
    const bob = await account('bob');
    const first = await save(ana, body()).expect(200);
    const second = await save(bob, body()).expect(200);
    expect(second.body.id).not.toBe(first.body.id);
    const all = await prisma.pushSubscription.findMany();
    expect(all.map((d) => d.accountId)).toEqual([bob]);
  });

  it.each([
    ['http address', { endpoint: 'http://push.example.test/x' }],
    ['not an address', { endpoint: 'nope' }],
    ['missing endpoint', { endpoint: undefined }],
    ['missing keys', { keys: undefined }],
    ['empty key', { keys: { auth: '', p256dh: 'x' } }],
    ['missing key', { keys: { p256dh: 'x' } }],
    ['long label', { label: 'x'.repeat(101) }],
    ['unknown field', { extra: 1 }],
  ])('refuses %s with 400 and saves nothing', async (_name, change) => {
    const ana = await account('ana');
    await save(ana, { ...body(), ...change }).expect(400);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('accepts a missing label', async () => {
    const ana = await account('ana');
    await save(ana, { ...body(), label: undefined }).expect(200);
  });

  it('refuses a visitor', async () => {
    await request(app.getHttpServer())
      .post('/push-subscriptions')
      .send(body())
      .expect(401);
  });
});

describe('DELETE /push-subscriptions/:id', () => {
  it('deletes the person’s own device', async () => {
    const ana = await account('ana');
    const { body: saved } = await save(ana, body()).expect(200);
    await request(app.getHttpServer())
      .delete(`/push-subscriptions/${saved.id}`)
      .set('Authorization', bearer(ana))
      .expect(204);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('answers 404 for another account’s device and changes nothing', async () => {
    const ana = await account('ana');
    const bob = await account('bob');
    const { body: saved } = await save(ana, body()).expect(200);
    const res = await request(app.getHttpServer())
      .delete(`/push-subscriptions/${saved.id}`)
      .set('Authorization', bearer(bob))
      .expect(404);
    expect(res.body.code).toBe('not_found');
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it.each([randomUUID(), 'not-a-uuid'])('answers 404 for %s', async (id) => {
    const ana = await account('ana');
    await request(app.getHttpServer())
      .delete(`/push-subscriptions/${id}`)
      .set('Authorization', bearer(ana))
      .expect(404);
  });
});

describe('POST /push-subscriptions/test', () => {
  it('queues a push for the caller’s devices only', async () => {
    const ana = await account('ana');
    const bob = await account('bob');
    await save(ana, body(1)).expect(200);
    await save(bob, body(2)).expect(200);
    const res = await request(app.getHttpServer())
      .post('/push-subscriptions/test')
      .set('Authorization', bearer(ana))
      .expect(202);
    expect(res.body).toEqual({ queued: 1 });
    const queued = await prisma.notification.findMany({
      where: { channel: 'push' },
    });
    expect(queued.map((r) => [r.accountId, r.kind])).toEqual([
      [ana, 'PUSH_TEST'],
    ]);
  });

  it('queues nothing for a person with no device', async () => {
    const ana = await account('ana');
    const res = await request(app.getHttpServer())
      .post('/push-subscriptions/test')
      .set('Authorization', bearer(ana))
      .expect(202);
    expect(res.body).toEqual({ queued: 0 });
  });
});

describe('without push keys', () => {
  let off: INestApplication;
  beforeAll(async () => {
    off = await start(null);
  });
  afterAll(() => off.close());

  it('gives no key, saves nothing and sends no test', async () => {
    const ana = await account('ana');
    const key = await request(off.getHttpServer())
      .get('/push-subscriptions/key')
      .set('Authorization', bearer(ana))
      .expect(200);
    expect(key.body).toEqual({ publicKey: null });
    const res = await request(off.getHttpServer())
      .post('/push-subscriptions')
      .set('Authorization', bearer(ana))
      .send(body())
      .expect(400);
    expect(res.body.code).toBe('push_off');
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});

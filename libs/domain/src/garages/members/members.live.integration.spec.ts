// @traces 400-FR-003
import { randomUUID } from 'node:crypto';
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { EventsModule } from '../../events/events.module';
import { LIVE_CHANNEL } from '../../events/live/live.hub';
import { OutboxRelayModule } from '../../events/outbox-relay/outbox-relay.module';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

// The removal through the route, the outbox relay and the live hub together:
// her open stream leaves the garage as the event goes out.
const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;
const opened: IncomingMessage[] = [];

beforeAll(async () => {
  await brevo.start();
  const email = testConfig(brevo.url);
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
      EventsModule.register({ redisUrl }),
      OutboxRelayModule.register({ databaseUrl, redisUrl }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(0);
});

afterAll(async () => {
  for (const res of opened) res.destroy();
  await app.close();
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  brevo.reset();
});

afterEach(() => {
  for (const res of opened.splice(0)) res.destroy();
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

// Opens /live and keeps the kinds that arrive, so a test can wait for one.
function stream(auth: string) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  return new Promise<{ kinds: string[]; heard: (k: string) => Promise<void> }>(
    (resolve, reject) => {
      const req = get(
        {
          headers: { Authorization: auth },
          host: '127.0.0.1',
          path: '/live',
          port,
        },
        (res) => {
          opened.push(res);
          let body = '';
          const out = {
            heard: (kind: string, ms = 15_000) =>
              new Promise<void>((ok, fail) => {
                const check = () => {
                  if (!out.kinds.includes(kind)) return;
                  clearTimeout(timer);
                  res.off('data', check);
                  ok();
                };
                const timer = setTimeout(() => {
                  res.off('data', check);
                  fail(new Error(`no ${kind} within ${ms} ms`));
                }, ms);
                res.on('data', check);
                check();
              }),
            kinds: [] as string[],
          };
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
            out.kinds = body
              .split('\n\n')
              .slice(0, -1)
              .flatMap((block) =>
                block
                  .split('\n')
                  .filter((l) => l.startsWith('event: '))
                  .map((l) => l.slice('event: '.length)),
              )
              .filter((k) => k !== 'hello');
          });
          resolve(out);
        },
      );
      req.on('error', reject);
    },
  );
}

async function fanOut(garageId: string, kind: string) {
  const publisher = new Redis(redisUrl);
  await publisher.publish(
    LIVE_CHANNEL,
    JSON.stringify({
      audience: [`garage:${garageId}`],
      event: { at: new Date().toISOString(), id: randomUUID(), kind },
    }),
  );
  publisher.disconnect();
}

// An absence window after the wait for what did arrive; never a wait for work.
const settle = () => new Promise((r) => setTimeout(r, 300));

describe('the removed receptionist on the live stream', () => {
  it('takes her open stream off the garage when the owner removes her, and leaves the owner on it', async () => {
    const garage = await prisma.garage.create({
      data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
    });
    const owner = await account('Mihai Ionescu', ['garage']);
    const desk = await account('Ioana Marin', ['receptionist']);
    await prisma.garageMember.createMany({
      data: [
        { accountId: owner, garageId: garage.id, role: 'owner' },
        { accountId: desk, garageId: garage.id, role: 'receptionist' },
      ],
    });
    const ownerLive = await stream(bearer(owner, 'garage'));
    const deskLive = await stream(bearer(desk, 'receptionist'));
    await fanOut(garage.id, 'request.created');
    await deskLive.heard('request.created');
    await ownerLive.heard('request.created');

    const res = await request(app.getHttpServer())
      .delete(`/garages/${garage.id}/members/${desk}`)
      .set('Authorization', bearer(owner, 'garage'));
    await ownerLive.heard('member.removed');
    await fanOut(garage.id, 'job.updated');
    await ownerLive.heard('job.updated');
    // Her own stream stays open for her account: the removal notice reaches it.
    await deskLive.heard('notification.created');
    await settle();

    expect(res.status).toBe(204);
    expect(ownerLive.kinds).toEqual([
      'request.created',
      'member.removed',
      'job.updated',
    ]);
    expect(deskLive.kinds).toEqual(['request.created', 'notification.created']);
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';

import { BrevoMock } from './brevo-mock.testing';
import { AuditService } from '../../audit/audit.service';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../notifications.module';
import { NotificationsService } from '../notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(14);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

async function boot(overrides: Record<string, string> = {}) {
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 's' });
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      NotificationsModule.register(
        { databaseUrl, email: testConfig(mock.url, overrides), redisUrl },
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
  await mock.start();
  app = await boot();
});

afterAll(async () => {
  await app.close();
  await queue.close();
  publisher.disconnect();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
});

const post = (target: INestApplication, body: unknown, secret?: string) => {
  const call = request(target.getHttpServer())
    .post('/webhooks/brevo')
    .send(body as object);
  return secret === undefined
    ? call
    : call.set('Authorization', `Bearer ${secret}`);
};

async function sentEmail(name: string) {
  const id = await account(name);
  const service = new NotificationsService(
    prisma,
    queue,
    publisher,
    testConfig(mock.url),
    null,
    new AuditService(),
  );
  await service.notify({
    eventId: `evt-${name}`,
    kind: 'JOB_READY',
    recipients: [id],
  });
  const row = await prisma.notification.findFirstOrThrow({
    where: { accountId: id, channel: 'email' },
  });
  await prisma.notification.update({
    data: {
      providerMessageId: `<${name}@relay>`,
      sentAt: new Date(),
      status: 'sent',
    },
    where: { id: row.id },
  });
  return { accountId: id, rowId: row.id };
}

const bounce = (name: string) => ({
  email: `${name}@example.test`,
  event: 'hard_bounce',
  'message-id': `<${name}@relay>`,
  reason: 'mailbox does not exist',
});

describe('the Brevo webhook', () => {
  it('records a hard bounce on the row and on the account', async () => {
    const { accountId, rowId } = await sentEmail('andrei');
    const res = await post(app, bounce('andrei'), 'webhook-secret');
    expect(res.status).toBe(204);
    expect(
      await prisma.notification.findUniqueOrThrow({ where: { id: rowId } }),
    ).toMatchObject({
      failure: 'bounced',
      status: 'failed',
    });
    const owner = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(owner.emailBouncedAt).toBeInstanceOf(Date);
  });

  it.each([
    ['a wrong secret', 'not-the-secret'],
    ['no secret', undefined],
  ])('refuses %s and changes nothing', async (_label, secret) => {
    const { accountId, rowId } = await sentEmail('andrei');
    const res = await post(app, bounce('andrei'), secret);
    expect(res.status).toBe(401);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: rowId } }))
        .status,
    ).toBe('sent');
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: accountId } }))
        .emailBouncedAt,
    ).toBeNull();
  });

  it('ignores an event that is not a hard bounce', async () => {
    const { rowId } = await sentEmail('andrei');
    const res = await post(
      app,
      { ...bounce('andrei'), event: 'soft_bounce' },
      'webhook-secret',
    );
    expect(res.status).toBe(204);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: rowId } }))
        .status,
    ).toBe('sent');
  });

  it('ignores a bounce for a message it did not send', async () => {
    const { accountId } = await sentEmail('andrei');
    const res = await post(
      app,
      { ...bounce('andrei'), 'message-id': '<other@relay>' },
      'webhook-secret',
    );
    expect(res.status).toBe(204);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: accountId } }))
        .emailBouncedAt,
    ).toBeNull();
  });

  it('refuses every call when no secret is configured', async () => {
    const open = await boot({ BREVO_WEBHOOK_SECRET: '' });
    const res = await post(open, bounce('andrei'), '');
    expect(res.status).toBe(401);
    await open.close();
  });
});

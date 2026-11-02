// @traces 520-FR-002 520-FR-004
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';

import { HealthModule } from '../../health/health.module';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { BrevoMock } from '../brevo/brevo-mock.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(0);
const brevo = new BrevoMock();
const store = new S3TestStore();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
let app: INestApplication | undefined;

// The worker's own wiring: the notifications consumer behind the boot, and
// the health report that waits on it.
async function boot() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig(brevo.url),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        redisUrl,
      }),
      StorageModule.register(store.env()),
      HealthModule.register({ databaseUrl, redisUrl, version: 'abc123' }),
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

const ready = async () =>
  (await request(app?.getHttpServer()).get('/health/ready')).status;

async function readyWithin(ms: number) {
  const end = Date.now() + ms;
  for (;;) {
    const status = await ready();
    if (status === 200 || Date.now() > end) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

beforeAll(async () => {
  await brevo.start();
  await store.start();
});

afterAll(async () => {
  await queue.close();
  await brevo.stop();
  await store.stop();
});

beforeEach(async () => {
  await queue.obliterate({ force: true });
  brevo.reset();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe('the worker while Brevo is unreachable at start-up', () => {
  it('boots unhealthy, then turns healthy once Brevo answers, without a restart', async () => {
    brevo.answer({ status: 503 });

    await boot();

    expect(await ready()).toBe(503);
    expect(await readyWithin(10_000)).toBe(200);
    expect(brevo.calls.filter((c) => c.path === '/v3/account')).toHaveLength(2);
  });

  it('schedules the re-queue sweep at boot, while the consumer still waits', async () => {
    brevo.answer({ status: 503 }, { status: 503 }, { status: 503 });

    await boot();

    expect(await ready()).toBe(503);
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => s.name)).toEqual(['requeue']);
  });

  it('stays unhealthy on a refused key', async () => {
    brevo.answer({ status: 401 });

    await boot();
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(await ready()).toBe(503);
    expect(brevo.calls.filter((c) => c.path === '/v3/account')).toHaveLength(1);
  });
});

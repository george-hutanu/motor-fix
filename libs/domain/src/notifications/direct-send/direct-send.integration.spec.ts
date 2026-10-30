import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';

import {
  DIRECT_SEND_QUEUE,
  DIRECT_SEND_WAIT_MS,
  type DirectSendJob,
} from './direct-send';
import { DirectSend } from './direct-send.client';
import { DirectSendModule } from './direct-send.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { BrevoMock } from '../brevo/brevo-mock.testing';
import {
  databaseUrl,
  redisUrlFor,
  testConfig,
  testPhone,
  testPhoneConfig,
} from '../notifications.testing';

serialDatabase(databaseUrl);

const redisUrl = redisUrlFor(11);
const brevo = new BrevoMock();
const connection = { maxRetriesPerRequest: null, url: redisUrl };
let api: INestApplicationContext;
let worker: INestApplicationContext | undefined;
let send: DirectSend;
let queue: Queue<DirectSendJob>;

const phone = () =>
  testPhoneConfig({
    WHATSAPP_TEMPLATES:
      'motorfix_sign_in_code_ro=51,motorfix_sign_in_code_en=52',
  });
const code = (s: DirectSend, to = testPhone(1)) =>
  s.whatsapp('SIGN_IN_CODE', 'ro', { code: '123456', minutes: 10 }, to);

async function context(module: ReturnType<typeof DirectSendModule.register>) {
  const ref = await Test.createTestingModule({ imports: [module] }).compile();
  return ref.createNestApplication().init();
}

beforeAll(async () => {
  await brevo.start();
  queue = new Queue(DIRECT_SEND_QUEUE, { connection });
  await queue.obliterate({ force: true });
  api = await context(DirectSendModule.register(redisUrl));
  worker = await context(
    DirectSendModule.registerWorker({
      email: testConfig(brevo.url),
      phone: phone(),
      redisUrl,
    }),
  );
  send = api.get(DirectSend);
});

afterAll(async () => {
  await worker?.close();
  await api?.close();
  await queue?.close();
  await brevo.stop();
});

beforeEach(() => brevo.reset());

// @traces 1379-FR-001
// @traces 1379-FR-002
// @traces 1379-FR-011
describe('direct-send through the worker', () => {
  it('carries the code from the api to the provider once', async () => {
    expect(await code(send)).toBeNull();

    expect(brevo.whatsapp()).toHaveLength(1);
    expect(brevo.whatsapp()[0].body).toMatchObject({ templateId: 51 });
  });

  it('answers a refusal kind the worker found, with no provider call', async () => {
    expect(await code(send, '+40622123456')).toBe('not_allowed');
    expect(brevo.whatsapp()).toHaveLength(0);
  });

  it('answers the provider’s refusal from the failed job, after one call', async () => {
    brevo.answer({ body: { code: 'invalid_parameter' }, status: 400 });

    expect(await code(send)).toBe('invalid_parameter');
    expect(brevo.whatsapp()).toHaveLength(1);
  });

  it('sends an e-mail the same way', async () => {
    const kind = await send.email(
      'STAFF_INVITE.mechanic',
      'ro',
      { app: 'https://motorfix.test', garage: 'Service', link: 'https://l' },
      { email: 'ana@example.test', name: 'Ana' },
    );

    expect(kind).toBeNull();
    expect(brevo.emails()).toHaveLength(1);
  });
});

// @traces 1379-FR-004
// @traces 1379-FR-005
describe('direct-send, once and gone', () => {
  it('never sends a job picked up after the wait cap', async () => {
    const job = await queue.add(
      'whatsapp',
      {
        language: 'ro',
        template: 'SIGN_IN_CODE',
        to: testPhone(1),
        values: { code: '1', minutes: 10 },
      },
      { attempts: 1, timestamp: Date.now() - DIRECT_SEND_WAIT_MS - 1000 },
    );

    for (let i = 0; i < 100 && !(await job.isCompleted()); i += 1)
      await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await queue.getJob(job.id ?? ''))?.returnvalue).toBe('stale');
    expect(brevo.whatsapp()).toHaveLength(0);
  });

  it('leaves no answered job behind with its recipient and code', async () => {
    expect(await code(send)).toBeNull();

    const kept = await queue.getJobs(['completed', 'failed', 'wait', 'active']);
    expect(kept.filter((job) => job.data.values['code'] === '123456')).toEqual(
      [],
    );
  });
});

// @traces 1379-FR-003
// @traces 1379-FR-010
describe('direct-send without a worker or a broker', () => {
  it('answers timeout within the cap when no worker runs', async () => {
    await worker?.close();
    worker = undefined;
    const started = Date.now();

    expect(await code(send)).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(DIRECT_SEND_WAIT_MS + 1000);
    expect(brevo.whatsapp()).toHaveLength(0);
    await queue.obliterate({ force: true });
  });

  it('answers a failure within the cap when the broker cannot be reached', async () => {
    const down = await context(
      DirectSendModule.register('redis://127.0.0.1:1'),
    );
    const started = Date.now();

    expect(await code(down.get(DirectSend))).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(DIRECT_SEND_WAIT_MS + 1000);
    await down.close();
  });
});

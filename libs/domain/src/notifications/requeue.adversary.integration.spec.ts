import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { Brevo } from './brevo';
import { BrevoMock } from './brevo-mock.testing';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import type { Prisma } from '../generated/prisma/client';

const redisUrl = redisUrlFor(14);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

const NOW = new Date('2026-10-05T11:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

let service: NotificationsService;
let processor: NotificationsProcessor;
let owner: string;

function build(jobs: unknown = queue) {
  const config = testConfig(mock.url);
  service = new NotificationsService(
    prisma,
    jobs as Queue,
    publisher,
    config,
    null,
    new AuditService(),
  );
  service.now = () => NOW;
  processor = new NotificationsProcessor(
    prisma,
    service,
    new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
    config,
    testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' }),
  );
  processor.now = () => NOW;
}

const row = (data: Partial<Prisma.NotificationUncheckedCreateInput> = {}) =>
  prisma.notification.create({
    data: {
      accountId: owner,
      channel: 'email',
      createdAt: minutesAgo(10),
      eventId: randomUUID(),
      kind: 'QUOTE_RECEIVED',
      status: 'queued',
      ...data,
    },
  });

const jobFor = (id: string) => queue.getJob(`send-${id}`);
const reload = (id: string) =>
  prisma.notification.findUniqueOrThrow({ where: { id } });

beforeAll(() => mock.start());

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  mock.reset();
  build();
  owner = await account('andrei');
});

afterEach(() => jest.restoreAllMocks());

describe('the sweep under hostile conditions', () => {
  it('answers zero and adds nothing when there are no rows', async () => {
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(await queue.getJobs()).toEqual([]);
  });

  it('leaves a row exactly five minutes old', async () => {
    const edge = await row({ createdAt: minutesAgo(5) });
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(await jobFor(edge.id)).toBeUndefined();
  });

  it('judges staleness against the time it is given', async () => {
    const young = await row({ createdAt: minutesAgo(1) });
    await expect(service.requeueStranded(minutesAgo(-10))).resolves.toBe(1);
    expect(await jobFor(young.id)).toBeDefined();
  });

  it('re-queues hundreds of stranded rows in one pass', async () => {
    const ids = await Promise.all(
      Array.from({ length: 300 }, () => row().then((r) => r.id)),
    );
    await expect(service.requeueStranded()).resolves.toBe(300);
    expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 300 });
    expect(await jobFor(ids[299])).toBeDefined();
  });

  it('re-queues a stranded fallback row like any other', async () => {
    const original = await row({ failure: 'no_address', status: 'failed' });
    const fallback = await row({ fallbackOf: original.id });
    await expect(service.requeueStranded()).resolves.toBe(1);
    expect(await jobFor(fallback.id)).toBeDefined();
    expect(await jobFor(original.id)).toBeUndefined();
  });

  it('skips a row that carries both a claim and a sending mark', async () => {
    const both = await row({
      channel: 'sms',
      claimedAt: minutesAgo(9),
      sendingAt: minutesAgo(9),
    });
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(await jobFor(both.id)).toBeUndefined();
  });

  it('adds nothing for a row whose job sits in the kept-failed set', async () => {
    const poisoned = await row();
    await queue.add(
      'send',
      { id: poisoned.id },
      { attempts: 1, jobId: `send-${poisoned.id}`, removeOnFail: 1000 },
    );
    const worker = new Worker(
      'notifications',
      () => Promise.reject(new Error('poison')),
      { connection: { url: redisUrl } },
    );
    await new Promise((resolve) => worker.once('failed', resolve));
    await worker.close();
    expect(await (await jobFor(poisoned.id))?.getState()).toBe('failed');
    await service.requeueStranded();
    expect(await queue.getJobCounts('waiting', 'failed')).toEqual({
      failed: 1,
      waiting: 0,
    });
  });

  it('survives a queue that rejects with a non-error value', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    build({ addBulk: () => Promise.reject('boom') });
    const stranded = await row();
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(await reload(stranded.id)).toEqual(stranded);
  });

  it('survives a queue that rejects with null', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    build({ addBulk: () => Promise.reject(null) });
    await row();
    await expect(service.requeueStranded()).resolves.toBe(0);
  });

  it('counts only the rows it handed over when the queue fails part way', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await row();
    await row();
    await row();
    let calls = 0;
    build({
      addBulk: (...args: Parameters<Queue['addBulk']>) =>
        ++calls === 2
          ? Promise.reject(new Error('Redis down'))
          : queue.addBulk(...args),
    });
    const answered = await service.requeueStranded();
    const waiting = (await queue.getJobCounts('waiting'))['waiting'];
    expect(answered).toBe(waiting);
  });

  it('runs twice at once without duplicating jobs', async () => {
    await row();
    await row();
    await Promise.all([service.requeueStranded(), service.requeueStranded()]);
    expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 2 });
  });

  it('scheduling never creates a send job', async () => {
    await row();
    await service.scheduleRequeue();
    expect(await queue.getJobs(['waiting', 'delayed'])).toHaveLength(1);
    expect((await queue.getJobSchedulers())[0].name).toBe('requeue');
  });
});

describe('the requeue job through the processor', () => {
  it('re-queues stranded rows and resolves with nothing', async () => {
    const stranded = await row();
    await expect(
      processor.handle({ attemptsMade: 0, data: {}, name: 'requeue' }),
    ).resolves.toBeUndefined();
    expect(await jobFor(stranded.id)).toBeDefined();
  });

  it('sends a re-queued row exactly once when its job then runs twice', async () => {
    const stranded = await row();
    await processor.handle({ attemptsMade: 0, data: {}, name: 'requeue' });
    const job = { attemptsMade: 0, data: { id: stranded.id }, name: 'send' };
    await processor.handle(job);
    await processor.handle(job);
    expect(mock.emails()).toHaveLength(1);
    expect(await reload(stranded.id)).toMatchObject({
      claimedAt: null,
      status: 'sent',
    });
  });

  it('does not send a row that was sent between the read and the late job', async () => {
    const done = await row();
    await processor.handle({ attemptsMade: 0, data: {}, name: 'requeue' });
    await prisma.notification.update({
      data: { sentAt: NOW, status: 'sent' },
      where: { id: done.id },
    });
    await processor.handle({
      attemptsMade: 0,
      data: { id: done.id },
      name: 'send',
    });
    expect(mock.emails()).toHaveLength(0);
  });

  it('still refuses an unknown job name', () => {
    expect(() =>
      processor.handle({ attemptsMade: 0, data: {}, name: 'requeue-all' }),
    ).toThrow('unknown notifications job requeue-all');
  });

  it('resolves when the queue refuses every add', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    build({ addBulk: () => Promise.reject(new Error('Redis down')) });
    await row();
    await expect(
      processor.handle({ attemptsMade: 0, data: {}, name: 'requeue' }),
    ).resolves.toBeUndefined();
  });
});

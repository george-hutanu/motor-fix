import { NEWS_CONSENT_TEXT_VERSION } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';

import {
  NEWS_CONSUMER,
  NEWS_QUEUE,
  type NewsEvent,
  type NewsRun,
} from './news.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { OutboxRelayModule } from '../../events/outbox-relay/outbox-relay.module';
import { NotificationsModule } from '../notifications.module';
import { NotificationsService } from '../notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(6);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const newsJobs = new Queue<NewsEvent>(NEWS_QUEUE, {
  connection: { url: redisUrl },
});

afterAll(async () => {
  await newsJobs.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  await prisma.newsSend.deleteMany();
  await newsJobs.obliterate({ force: true });
});

async function consenting(name: string) {
  const id = await account(name, ['driver']);
  await prisma.notificationPreference.create({
    data: {
      accountId: id,
      channel: 'email',
      consentGivenAt: new Date('2026-10-10T10:00:00Z'),
      consentSource: 'settings',
      consentTextVersion: NEWS_CONSENT_TEXT_VERSION,
      enabled: true,
      type: 'NEWS',
    },
  });
  return id;
}

const worker = (
  tokenSecret?: string,
  webUrl = 'https://motorfix.test',
  withRelay = false,
) =>
  Test.createTestingModule({
    imports: [
      ...(withRelay
        ? [
            OutboxRelayModule.register({
              consumers: [NEWS_CONSUMER],
              databaseUrl,
              redisUrl,
            }),
          ]
        : []),
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9', {
          EMAIL_SENDING: 'off',
          PUBLIC_WEB_URL: webUrl,
        }),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        redisUrl,
        tokenSecret,
      }),
    ],
  }).compile();

const run = (admin: string): NewsRun => ({
  month: '2026-11',
  sentBy: { accountId: admin, role: 'admin' },
  text: { en: 'News', ro: 'Noutăți' },
  title: { en: 'News for November', ro: 'Noutăți din noiembrie' },
});

async function queueRun(admin: string, attempts = NEWS_CONSUMER.jobs.attempts) {
  await newsJobs.add(
    'event',
    { payload: run(admin) },
    {
      ...NEWS_CONSUMER.jobs,
      attempts,
      jobId: 'news-2026-11',
    },
  );
}

// A month claimed with its run's event, relayed `minutes` ago, whose job is
// nowhere in Redis: what an emptied Redis leaves behind.
async function relayedRun(admin: string, minutes: number, ranAt?: Date) {
  const at = new Date(Date.now() - (minutes + 1) * 60_000);
  await prisma.newsSend.create({
    data: {
      createdAt: at,
      month: '2026-11',
      ranAt,
      recipients: 1,
      sentById: admin,
    },
  });
  return prisma.outboxEvent.create({
    data: {
      audience: ['admin', 'system'],
      createdAt: at,
      kind: 'news.sent',
      payload: JSON.parse(JSON.stringify(run(admin))),
      relayedAt: new Date(Date.now() - minutes * 60_000),
      subjectId: '2026-11',
    },
  });
}

const relayedAgain = async (id: bigint) => {
  const row = await prisma.outboxEvent.findUnique({ where: { id } });
  return (row?.relayedAt?.getTime() ?? 0) > Date.now() - 60_000;
};

const newsEmails = () =>
  prisma.notification.findMany({ where: { channel: 'email', kind: 'NEWS' } });

describe('the news worker', () => {
  it('runs a queued news run, one message per consenting driver', async () => {
    const admin = await account('admin', ['admin']);
    const andrei = await consenting('andrei');
    const elena = await consenting('elena');
    const app = await worker('test-secret');
    await app.init();
    try {
      await queueRun(admin);
      const deadline = Date.now() + 10_000;
      while ((await newsEmails()).length < 2 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await app.close();
    }
    const rows = await newsEmails();
    expect(rows.map((r) => r.accountId).sort()).toEqual([andrei, elena].sort());
  }, 20_000);

  it('runs the news the outbox holds, queued by the relay', async () => {
    const admin = await account('admin', ['admin']);
    const andrei = await consenting('andrei');
    await prisma.outboxEvent.create({
      data: {
        audience: ['admin', 'system'],
        kind: 'news.sent',
        payload: JSON.parse(JSON.stringify(run(admin))),
        subjectId: '2026-11',
      },
    });
    const app = await worker('test-secret', undefined, true);
    await app.init();
    try {
      const deadline = Date.now() + 10_000;
      while ((await newsEmails()).length < 1 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await app.close();
    }
    expect((await newsEmails()).map((r) => r.accountId)).toEqual([andrei]);
  }, 20_000);

  it('queues the outbox news with the run’s retries', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const admin = await account('admin', ['admin']);
    const { id } = await prisma.outboxEvent.create({
      data: {
        audience: ['admin', 'system'],
        kind: 'news.sent',
        payload: JSON.parse(JSON.stringify(run(admin))),
        subjectId: '2026-11',
      },
    });
    // No token secret: the job waits in the queue to be read.
    const app = await worker(undefined, undefined, true);
    await app.init();
    let job = await newsJobs.getJob(`event-${id}`);
    try {
      const deadline = Date.now() + 10_000;
      while (!job && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        job = await newsJobs.getJob(`event-${id}`);
      }
    } finally {
      await app.close();
      jest.restoreAllMocks();
    }
    expect(job?.opts).toMatchObject({
      attempts: NEWS_CONSUMER.jobs.attempts,
      backoff: NEWS_CONSUMER.jobs.backoff,
    });
  }, 20_000);

  it.each([
    ['AUTH_TOKEN_SECRET', undefined, 'https://motorfix.test'],
    ['PUBLIC_WEB_URL', 'test-secret', ''],
  ])(
    'leaves the run queued and says why without %s',
    async (name, secret, webUrl) => {
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const admin = await account('admin', ['admin']);
      await consenting('andrei');
      const app = await worker(secret, webUrl);
      await app.init();
      try {
        await queueRun(admin);
        await new Promise((r) => setTimeout(r, 1_000));
      } finally {
        await app.close();
      }
      const logged = error.mock.calls.flat().join('\n');
      error.mockRestore();
      expect(await newsEmails()).toEqual([]);
      expect(await newsJobs.getJobState('news-2026-11')).toBe('waiting');
      expect(logged).toContain(name);
    },
    20_000,
  );

  it('gives the month back once the last attempt fails', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    await prisma.newsSend.create({
      data: { month: '2026-11', recipients: 1, sentById: admin },
    });
    const app = await worker('test-secret');
    jest
      .spyOn(app.get(NotificationsService), 'notify')
      .mockRejectedValue(new Error('pipeline down'));
    await app.init();
    try {
      await queueRun(admin, 1);
      const deadline = Date.now() + 10_000;
      while ((await prisma.newsSend.count()) > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await app.close();
      error.mockRestore();
    }
    expect(await prisma.newsSend.count()).toBe(0);
    expect(await newsJobs.getJobState('news-2026-11')).toBe('unknown');
  }, 20_000);

  it('queues a claimed month’s run again when Redis lost it, and marks it ran', async () => {
    const admin = await account('admin', ['admin']);
    const andrei = await consenting('andrei');
    await relayedRun(admin, 10);
    const app = await worker('test-secret', undefined, true);
    await app.init();
    try {
      const deadline = Date.now() + 10_000;
      while (
        !(await prisma.newsSend.findFirst())?.ranAt &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await app.close();
    }
    expect((await newsEmails()).map((r) => r.accountId)).toEqual([andrei]);
    expect((await prisma.newsSend.findFirst())?.ranAt).toBeInstanceOf(Date);
  }, 20_000);

  it('leaves a run that completed, or was relayed moments ago, where it is', async () => {
    const admin = await account('admin', ['admin']);
    const done = await relayedRun(admin, 10, new Date());
    expect(await NEWS_CONSUMER.requeue(prisma)).toBe(0);
    expect(
      (await prisma.outboxEvent.findUnique({ where: { id: done.id } }))
        ?.relayedAt,
    ).toBeInstanceOf(Date);
    await prisma.newsSend.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await relayedRun(admin, 1);
    expect(await NEWS_CONSUMER.requeue(prisma)).toBe(0);
  });

  it('puts a stranded run’s event back in line for the relay', async () => {
    const admin = await account('admin', ['admin']);
    const { id } = await relayedRun(admin, 10);
    expect(await NEWS_CONSUMER.requeue(prisma)).toBe(1);
    expect(
      (await prisma.outboxEvent.findUnique({ where: { id } }))?.relayedAt,
    ).toBeNull();
  });

  it('never queues again the run of a month given back and sent anew', async () => {
    const admin = await account('admin', ['admin']);
    const old = await relayedRun(admin, 10);
    // The month was given back, then the admin sent it again: a new claim,
    // with its own event still waiting for the relay.
    await prisma.newsSend.deleteMany();
    await prisma.newsSend.create({
      data: { month: '2026-11', recipients: 1, sentById: admin },
    });
    expect(await NEWS_CONSUMER.requeue(prisma)).toBe(0);
    expect(
      (await prisma.outboxEvent.findUnique({ where: { id: old.id } }))
        ?.relayedAt,
    ).toBeInstanceOf(Date);
  });

  it('adds nothing for a run whose job is still in Redis', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const admin = await account('admin', ['admin']);
    const { id } = await relayedRun(admin, 10);
    await newsJobs.add(
      'event',
      { payload: run(admin) },
      { ...NEWS_CONSUMER.jobs, jobId: `event-${id}` },
    );
    // No token secret: the job waits in the queue while the relay requeues.
    const app = await worker(undefined, undefined, true);
    await app.init();
    try {
      // Requeued, then relayed again: its relayed_at is fresh.
      const deadline = Date.now() + 10_000;
      while (!(await relayedAgain(id)) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await app.close();
      jest.restoreAllMocks();
    }
    expect(await relayedAgain(id)).toBe(true);
    expect(await newsJobs.getJobCounts('waiting', 'delayed', 'active')).toEqual(
      { active: 0, delayed: 0, waiting: 1 },
    );
    expect(await newsJobs.getJobState(`event-${id}`)).toBe('waiting');
    expect((await prisma.newsSend.findFirst())?.ranAt).toBeNull();
  }, 20_000);
});

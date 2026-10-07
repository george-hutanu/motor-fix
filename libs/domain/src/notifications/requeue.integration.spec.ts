import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { BrevoMock } from './brevo-mock.testing';
import { NotificationsModule } from './notifications.module';
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
let owner: string;

function build(jobs: unknown = queue) {
  service = new NotificationsService(
    prisma,
    jobs as Queue,
    publisher,
    testConfig(mock.url),
    null,
    new AuditService(),
  );
  service.now = () => NOW;
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

// The page the sweep reads at a time, as its first read asks for it: a fixed
// value in code, which no test or setting can change.
let REQUEUE_PAGE: number;
const pageSize = async () => {
  const read = jest.spyOn(prisma.notification, 'findMany');
  await service.requeueStranded();
  const take = read.mock.calls[0][0]?.take;
  read.mockRestore();
  return take as number;
};

// Stale queued rows, their ids in the order the sweep walks them.
const backlog = async (n: number) => {
  const rows = await prisma.notification.createManyAndReturn({
    data: Array.from({ length: n }, () => ({
      accountId: owner,
      channel: 'email' as const,
      createdAt: minutesAgo(10),
      eventId: randomUUID(),
      kind: 'QUOTE_RECEIVED',
      status: 'queued' as const,
    })),
    select: { id: true },
  });
  return rows.map((r) => r.id).sort();
};

beforeAll(async () => {
  await mock.start();
  await reset();
  build();
  REQUEUE_PAGE = await pageSize();
  expect(REQUEUE_PAGE).toBeGreaterThan(0);
});

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  build();
  owner = await account('andrei');
});

afterEach(() => jest.restoreAllMocks());

describe('the sweep of queued rows with no job', () => {
  it('adds the send job of a stale queued row under its usual id and options', async () => {
    const stranded = await row();
    await expect(service.requeueStranded()).resolves.toBe(1);
    const job = await jobFor(stranded.id);
    expect(job?.name).toBe('send');
    expect(job?.data).toEqual({ id: stranded.id });
    expect(job?.opts).toMatchObject({
      attempts: 6,
      backoff: { type: 'custom' },
      delay: 0,
      removeOnComplete: true,
      removeOnFail: 1000,
    });
    expect(await job?.getState()).toBe('waiting');
  });

  it('re-queues a stranded row on every channel', async () => {
    const rows = await Promise.all(
      (['email', 'push', 'sms', 'whatsapp'] as const).map((channel) =>
        row({ channel }),
      ),
    );
    await expect(service.requeueStranded()).resolves.toBe(4);
    for (const r of rows) expect(await jobFor(r.id)).toBeDefined();
  });

  it('changes nothing for a row whose send job is still in the queue', async () => {
    const waiting = await row();
    await queue.add(
      'send',
      { id: waiting.id },
      { delay: 60_000, jobId: `send-${waiting.id}` },
    );
    await service.requeueStranded();
    const jobs = await queue.getJobs();
    expect(jobs.map((j) => j.id)).toEqual([`send-${waiting.id}`]);
    expect(await jobs[0].getState()).toBe('delayed');
  });

  it('adds one job when it runs twice', async () => {
    await row();
    await service.requeueStranded();
    await service.requeueStranded();
    expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 1 });
  });

  it('leaves a row younger than five minutes', async () => {
    const young = await row({ createdAt: minutesAgo(4.9) });
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(await jobFor(young.id)).toBeUndefined();
  });

  it('takes a row just over five minutes old', async () => {
    const old = await row({ createdAt: new Date(minutesAgo(5).getTime() - 1) });
    await expect(service.requeueStranded()).resolves.toBe(1);
    expect(await jobFor(old.id)).toBeDefined();
  });

  it('never re-queues a row that carries a send claim, live or lapsed', async () => {
    const live = await row({ claimedAt: minutesAgo(0.5) });
    const lapsed = await row({ claimedAt: minutesAgo(9) });
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(await jobFor(live.id)).toBeUndefined();
    expect(await jobFor(lapsed.id)).toBeUndefined();
  });

  it('never re-queues an SMS row marked as being sent', async () => {
    const marked = await row({ channel: 'sms', sendingAt: minutesAgo(8) });
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(await jobFor(marked.id)).toBeUndefined();
  });

  it('leaves a listing draft e-mail, whose link only its own job carried', async () => {
    const draft = await prisma.listingDraft.create({
      data: {
        data: {},
        email: 'owner@example.test',
        language: 'ro',
        step: 1,
        updatedAt: NOW,
      },
    });
    const stranded = await row({
      accountId: null,
      kind: 'LISTING_CONTINUE_LINK',
      listingDraftId: draft.id,
    });
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(await jobFor(stranded.id)).toBeUndefined();
  });

  it('leaves held, sent and failed rows alone', async () => {
    const others = await Promise.all([
      row({ sendAfter: minutesAgo(9), status: 'held' }),
      row({ sentAt: minutesAgo(9), status: 'sent' }),
      row({ failure: 'no_address', status: 'failed' }),
    ]);
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(await queue.getJobs()).toEqual([]);
    for (const r of others) expect(await jobFor(r.id)).toBeUndefined();
  });

  it('logs the rows it re-queued, and nothing when there were none', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await service.requeueStranded();
    expect(warn).not.toHaveBeenCalled();
    const stranded = await row();
    await service.requeueStranded();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(stranded.id));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('re-queued 1 '));
  });

  it('logs and ends without touching the rows when the queue refuses the add', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    build({ addBulk: () => Promise.reject(new Error('Redis down')) });
    const stranded = await row();
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Redis down'));
    expect(
      await prisma.notification.findUniqueOrThrow({
        where: { id: stranded.id },
      }),
    ).toEqual(stranded);
    build();
    await expect(service.requeueStranded()).resolves.toBe(1);
  });

  it('logs and ends when the rows cannot be read', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await row();
    jest
      .spyOn(prisma.notification, 'findMany')
      .mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.requeueStranded()).resolves.toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('connection lost'),
    );
    expect(await queue.getJobs()).toEqual([]);
  });

  it('re-queues a backlog larger than one page, one bounded read and one bulk add per page', async () => {
    const ids = await backlog(REQUEUE_PAGE * 2 + 1);
    const read = jest.spyOn(prisma.notification, 'findMany');
    const bulk = jest.spyOn(queue, 'addBulk');
    await expect(service.requeueStranded()).resolves.toBe(ids.length);
    expect(await queue.getJobCounts('waiting')).toEqual({
      waiting: ids.length,
    });
    for (const id of [ids[0], ids[REQUEUE_PAGE], ids.at(-1) as string])
      expect(await jobFor(id)).toBeDefined();
    expect(read).toHaveBeenCalledTimes(3);
    for (const [args] of read.mock.calls)
      expect(args).toMatchObject({
        orderBy: { id: 'asc' },
        take: REQUEUE_PAGE,
      });
    expect(read.mock.calls[1][0]).toMatchObject({
      where: { id: { gt: ids[REQUEUE_PAGE - 1] } },
    });
    expect(bulk.mock.calls.map(([jobs]) => jobs.length)).toEqual([
      REQUEUE_PAGE,
      REQUEUE_PAGE,
      1,
    ]);
    const [first] = bulk.mock.calls[0][0];
    expect(first).toMatchObject({
      name: 'send',
      opts: {
        attempts: 6,
        delay: 0,
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    });
  });

  it('stops at the empty page after a backlog that fills its pages exactly', async () => {
    const ids = await backlog(REQUEUE_PAGE);
    const read = jest.spyOn(prisma.notification, 'findMany');
    const bulk = jest.spyOn(queue, 'addBulk');
    await expect(service.requeueStranded()).resolves.toBe(REQUEUE_PAGE);
    expect(read).toHaveBeenCalledTimes(2);
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(await jobFor(ids[REQUEUE_PAGE - 1])).toBeDefined();
  });

  it('counts and names the pages handed over before an add failed', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const ids = await backlog(REQUEUE_PAGE + 1);
    jest
      .spyOn(queue, 'addBulk')
      .mockImplementationOnce((jobs) =>
        Queue.prototype.addBulk.call(queue, jobs),
      )
      .mockRejectedValueOnce(new Error('Redis down'));
    await expect(service.requeueStranded()).resolves.toBe(REQUEUE_PAGE);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Redis down'));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`re-queued ${REQUEUE_PAGE} `),
    );
    expect(await jobFor(ids[REQUEUE_PAGE])).toBeUndefined();
    await expect(service.requeueStranded()).resolves.toBe(REQUEUE_PAGE + 1);
    expect(await jobFor(ids[REQUEUE_PAGE])).toBeDefined();
  });

  it('schedules itself on the queue every five minutes', async () => {
    await service.scheduleRequeue();
    await service.scheduleRequeue();
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({ every: 300_000, name: 'requeue' });
    expect(schedulers[0].template?.opts).toMatchObject({
      removeOnComplete: true,
      removeOnFail: 10,
    });
  });
});

describe('the worker', () => {
  const boot = () =>
    Test.createTestingModule({
      imports: [
        NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig(mock.url, { EMAIL_SENDING: 'off' }),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
      ],
    }).compile();

  const settled = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const { status } = await prisma.notification.findUniqueOrThrow({
        where: { id },
      });
      if (status !== 'queued') return status;
      await new Promise((r) => setTimeout(r, 100));
    }
    return 'queued';
  };

  it('schedules the sweep when it starts', async () => {
    const app = await boot();
    try {
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.map((s) => s.name)).toEqual(['requeue']);
    } finally {
      await app.close();
    }
  });

  it('still starts and logs when the sweep cannot be scheduled', async () => {
    jest
      .spyOn(NotificationsService.prototype, 'scheduleRequeue')
      .mockRejectedValue(new Error('Redis refused'));
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const app = await boot();
    try {
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Redis refused'),
      );
      const queued = await row({ createdAt: NOW });
      await queue.add(
        'send',
        { id: queued.id },
        { jobId: `send-${queued.id}` },
      );
      expect(await settled(queued.id)).toBe('failed');
    } finally {
      await app.close();
    }
  });
});

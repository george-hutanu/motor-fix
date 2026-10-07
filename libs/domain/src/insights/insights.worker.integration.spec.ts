import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue, QueueEvents } from 'bullmq';

import { INSIGHTS_QUEUE, InsightsModule } from './insights.module';
import { writeSnapshot } from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(4);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const queue = new Queue(INSIGHTS_QUEUE, { connection: { url: redisUrl } });

const boot = async (url = databaseUrl) => {
  const app = await Test.createTestingModule({
    imports: [InsightsModule.registerWorker({ databaseUrl: url, redisUrl })],
  }).compile();
  await app.init();
  return app;
};

afterAll(async () => {
  await queue.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE platform_daily, outbox_event');
  await queue.obliterate({ force: true });
});

describe('the daily snapshot', () => {
  it('writes one row for the Bucharest day of the run, holding the three figures', async () => {
    await prisma.garage.create({
      data: {
        approvedAt: new Date('2026-11-02T08:00:00Z'),
        name: 'Service',
        slug: 'service-1',
        status: 'approved',
      },
    });

    await writeSnapshot(prisma, new Date('2026-11-09T23:00:00Z'));

    expect(await prisma.platformDaily.findMany()).toEqual([
      {
        activeDrivers: 0,
        day: new Date('2026-11-10'),
        garagesApprovedThisMonth: 1,
        garagesListed: 1,
        writtenAt: new Date('2026-11-09T23:00:00Z'),
      },
    ]);
  });

  it('replaces the row when it runs twice for the same day', async () => {
    await writeSnapshot(prisma, new Date('2026-11-09T23:00:00Z'));
    await prisma.garage.create({
      data: {
        approvedAt: new Date('2026-11-09T23:10:00Z'),
        name: 'Service',
        slug: 'service-2',
        status: 'approved',
      },
    });

    await writeSnapshot(prisma, new Date('2026-11-09T23:30:00Z'));

    const rows = await prisma.platformDaily.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      garagesListed: 1,
      writtenAt: new Date('2026-11-09T23:30:00Z'),
    });
  });

  it('writes no outbox event', async () => {
    await writeSnapshot(prisma, new Date('2026-11-09T23:00:00Z'));

    expect(await prisma.outboxEvent.count()).toBe(0);
  });
});

describe('the night job', () => {
  it('is one schedule at 01:00 Europe/Bucharest with one attempt, however many workers start', async () => {
    const first = await boot();
    const second = await boot();

    const schedulers = await queue.getJobSchedulers();
    await first.close();
    await second.close();

    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({
      key: 'platform-daily',
      name: 'platform-daily',
      pattern: '0 1 * * *',
      tz: 'Europe/Bucharest',
    });
    expect(schedulers[0].template?.opts?.attempts).toBe(1);
  });

  it('writes the day when the job runs', async () => {
    const app = await boot();
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    const job = await queue.add('platform-daily', {});
    await job.waitUntilFinished(events, 10_000);
    await events.close();
    await app.close();

    expect(await prisma.platformDaily.count()).toBe(1);
  });

  it('logs a failed run and does not try it again', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const app = await boot('postgresql://nobody@localhost:1/none');
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    // Queued with the schedule's own options, as the night would queue it.
    const scheduled = await queue.getJobScheduler('platform-daily');
    const job = await queue.add(
      'platform-daily',
      {},
      scheduled?.template?.opts,
    );
    await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow();
    await events.close();
    await app.close();

    const failed = await queue.getJob(job.id as string);
    expect(failed?.attemptsMade).toBe(1);
    expect(await failed?.getState()).toBe('failed');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('platform-daily'),
    );
    error.mockRestore();
  });
});

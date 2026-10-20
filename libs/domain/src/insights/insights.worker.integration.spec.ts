// @traces 384-FR-005 384-FR-010
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

import { INSIGHTS_QUEUE, InsightsModule } from './insights.module';
import { writeSnapshot } from './platform-figures';
import { serialDatabase } from '../auth/serial-db.testing';
import { addDays, atLocal, localDay } from '../bucharest';
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
    imports: [
      InsightsModule.registerWorker({
        databaseUrl: url,
        places: { provider: 'fake' },
        redisUrl,
      }),
    ],
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
  it('writes a row for the Bucharest day of the run, holding the three figures', async () => {
    await prisma.garage.create({
      data: {
        approvedAt: new Date('2026-11-02T08:00:00Z'),
        name: 'Service',
        slug: 'service-1',
        status: 'approved',
      },
    });

    await writeSnapshot(prisma, new Date('2026-11-09T23:00:00Z'));

    expect(
      await prisma.platformDaily.findMany({
        where: { day: new Date('2026-11-10') },
      }),
    ).toEqual([
      {
        activeDrivers: 0,
        bookingsConfirmed: null,
        city: 'all',
        day: new Date('2026-11-10'),
        garagesApprovedThisMonth: 1,
        garagesListed: 1,
        jobsDone: null,
        requestsAccepted: null,
        requestsQuoted: null,
        reviewsPosted: null,
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

    const rows = await prisma.platformDaily.findMany({
      where: { day: new Date('2026-11-10') },
    });
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
  it('keeps one schedule per job at 01:00 Europe/Bucharest, however many workers start', async () => {
    const first = await boot();
    const second = await boot();

    const schedulers = await queue.getJobSchedulers();
    await first.close();
    await second.close();

    expect(schedulers.map((s) => s.key).sort()).toEqual([
      'demand-daily',
      'platform-daily',
      'profile-views',
      'response-stats',
    ]);
    for (const scheduler of schedulers) {
      expect(scheduler).toMatchObject({
        name: scheduler.key,
        pattern: '0 1 * * *',
        tz: 'Europe/Bucharest',
      });
    }
  });

  it('runs the daily snapshot once and the response figures up to three times, a minute apart and doubling', async () => {
    const app = await boot();

    const snapshot = await queue.getJobScheduler('platform-daily');
    const figures = await queue.getJobScheduler('response-stats');
    await app.close();

    expect(snapshot?.template?.opts?.attempts).toBe(1);
    expect(figures?.template?.opts).toMatchObject({
      attempts: 3,
      backoff: { delay: 60_000, type: 'exponential' },
    });
  });

  // @traces 143-FR-011 143-FR-012
  it('runs the profile views once and retries them three times, a minute apart and doubling', async () => {
    const app = await boot();

    const views = await queue.getJobScheduler('profile-views');
    await app.close();

    expect(views).toMatchObject({
      name: 'profile-views',
      pattern: '0 1 * * *',
      tz: 'Europe/Bucharest',
    });
    expect(views?.template?.opts).toMatchObject({
      attempts: 4,
      backoff: { delay: 60_000, type: 'exponential' },
    });
  });

  // @traces 103-FR-012
  it('retries the demand rows up to three times, a minute apart and doubling, and writes them when the job runs', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE demand_daily');
    const app = await boot();
    const demand = await queue.getJobScheduler('demand-daily');
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    const job = await queue.add('demand-daily', {});
    await job.waitUntilFinished(events, 10_000);
    await events.close();
    await app.close();

    expect(demand?.template?.opts).toMatchObject({
      attempts: 3,
      backoff: { delay: 60_000, type: 'exponential' },
    });
    expect(
      await prisma.demandDaily.count({
        where: { dimension: 'total', key: 'all' },
      }),
    ).toBe(29);
  });

  // @traces 228-FR-012 228-FR-013
  it('ranks the brands by the searches once the demand rows are written, and drops the cached brand list', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE brand, demand_daily CASCADE');
    await prisma.brand.create({
      data: { key: 'bmw', name: 'BMW', popularity: 1, slug: 'bmw' },
    });
    const dacia = await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', popularity: 2, slug: 'dacia' },
    });
    // Searched three days ago: the job counts the day, then ranks by it.
    const at = atLocal(addDays(localDay(new Date()), -3), 12);
    await prisma.searchLog.createMany({
      data: [1, 2, 3].map(() => ({ at, brandId: dacia.id })),
    });
    const cache = new Redis(redisUrl);
    await cache.set('brands:active', '[]');
    const info = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const app = await boot();
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    try {
      const job = await queue.add('demand-daily', {});
      await job.waitUntilFinished(events, 10_000);

      expect(
        await prisma.brand.findMany({
          orderBy: { name: 'asc' },
          select: { name: true, popularity: true },
        }),
      ).toEqual([
        { name: 'BMW', popularity: 2 },
        { name: 'Dacia', popularity: 1 },
      ]);
      expect(await cache.get('brands:active')).toBeNull();
      expect(info).toHaveBeenCalledWith('demand-daily ranked 2, changed 2');
    } finally {
      info.mockRestore();
      cache.disconnect();
      await events.close();
      await app.close();
    }
  });

  // @traces 228-FR-014
  it('fails the demand job when the ranking cannot be written, keeps the ranks and logs the final failure once', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE brand, demand_daily CASCADE');
    await prisma.brand.create({
      data: { key: 'bmw', name: 'BMW', popularity: 1, slug: 'bmw' },
    });
    const dacia = await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', popularity: 2, slug: 'dacia' },
    });
    const at = atLocal(addDays(localDay(new Date()), -3), 12);
    await prisma.searchLog.createMany({
      data: [1, 2, 3].map(() => ({ at, brandId: dacia.id })),
    });
    // The ranking's write is the only brand update the job makes.
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION refuse_brand_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'brand writes refused'; END $$",
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER refuse_brand_update BEFORE UPDATE ON brand FOR EACH ROW EXECUTE FUNCTION refuse_brand_update()',
    );
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const app = await boot();
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    try {
      const job = await queue.add(
        'demand-daily',
        {},
        { attempts: 2, backoff: { delay: 10, type: 'fixed' } },
      );
      await expect(job.waitUntilFinished(events, 20_000)).rejects.toThrow();

      expect(
        await prisma.brand.findMany({
          orderBy: { name: 'asc' },
          select: { name: true, popularity: true },
        }),
      ).toEqual([
        { name: 'BMW', popularity: 1 },
        { name: 'Dacia', popularity: 2 },
      ]);
      const lines = error.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('demand-daily'));
      expect(lines).toEqual([
        expect.stringMatching(/^insights job demand-daily failed: /),
      ]);
    } finally {
      error.mockRestore();
      await events.close();
      await app.close();
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER refuse_brand_update ON brand',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION refuse_brand_update()');
    }
  });

  // @traces 143-FR-011
  it('writes the daily figures when the profile views job runs', async () => {
    await prisma.garage.create({
      data: { name: 'Service', slug: 'service-views', status: 'approved' },
    });
    const app = await boot();
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    const job = await queue.add('profile-views', {});
    await job.waitUntilFinished(events, 10_000);
    await events.close();
    await app.close();

    expect(await prisma.garageDailyFigures.count()).toBe(2);
    expect(await prisma.platformDaily.count()).toBe(0);
  });

  it("writes the day and the day before's funnel when the job runs, logging the funnel", async () => {
    const today = localDay(new Date());
    await prisma.platformDaily.create({
      data: {
        city: 'all',
        day: new Date(addDays(today, -1)),
        garagesApprovedThisMonth: 0,
        garagesListed: 0,
        writtenAt: new Date(),
      },
    });
    const info = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const app = await boot();
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    const job = await queue.add('platform-daily', {});
    await job.waitUntilFinished(events, 10_000);
    await events.close();
    await app.close();

    const rows = await prisma.platformDaily.findMany({
      orderBy: { day: 'asc' },
      select: { city: true, day: true, requestsQuoted: true },
    });
    expect(rows).toEqual([
      { city: 'all', day: new Date(addDays(today, -1)), requestsQuoted: 0 },
      { city: 'all', day: new Date(today), requestsQuoted: null },
    ]);
    expect(info).toHaveBeenCalledWith(
      `platform-daily funnel ${addDays(today, -1)} requestsQuoted 0, requestsAccepted 0, bookingsConfirmed 0, jobsDone 0, reviewsPosted 0`,
    );
    info.mockRestore();
  });

  // @traces 163-FR-005 163-FR-006
  it("places the garages with no city before it writes the night's rows", async () => {
    await prisma.garage.create({
      data: {
        address: 'Strada Exemplu 2, Cluj-Napoca',
        approvedAt: new Date(),
        name: 'Service',
        slug: 'service-unplaced',
        status: 'approved',
      },
    });
    const app = await boot();
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    const job = await queue.add('platform-daily', {});
    await job.waitUntilFinished(events, 10_000);
    await events.close();
    await app.close();

    const rows = await prisma.platformDaily.findMany({
      orderBy: { city: 'asc' },
      select: { city: true, garagesListed: true },
      where: { day: new Date(localDay(new Date())) },
    });
    expect(rows).toEqual([
      { city: 'all', garagesListed: 1 },
      { city: 'cluj-napoca', garagesListed: 1 },
    ]);
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
  it('writes the response figures when that job runs, logging the counts and no garage', async () => {
    const info = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const garage = await prisma.garage.create({
      data: { name: 'Service', slug: 'service-3', status: 'approved' },
    });
    const app = await boot();
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    const job = await queue.add('response-stats', {});
    await job.waitUntilFinished(events, 10_000);
    await events.close();
    await app.close();

    expect(await prisma.garageResponseStats.count()).toBe(1);
    expect(await prisma.platformDaily.count()).toBe(0);
    const lines = info.mock.calls.map(([line]) => String(line));
    expect(lines).toContainEqual(
      expect.stringMatching(/computed 1\b.*written 1\b/),
    );
    expect(lines.join('\n')).not.toContain(garage.id);
    info.mockRestore();
  });

  it('fails a job of a name it does not know', async () => {
    const app = await boot();
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    const job = await queue.add('no-such-job', {});
    await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow();
    await events.close();
    await app.close();

    expect(await prisma.platformDaily.count()).toBe(0);
  });

  it('logs the response figures only when their last attempt has failed', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const app = await boot('postgresql://nobody@localhost:1/none');
    const events = new QueueEvents(INSIGHTS_QUEUE, {
      connection: { url: redisUrl },
    });
    await events.waitUntilReady();

    // The schedule's three attempts, without its minute of waiting between.
    const job = await queue.add(
      'response-stats',
      {},
      { attempts: 3, backoff: { delay: 10, type: 'fixed' } },
    );
    await expect(job.waitUntilFinished(events, 20_000)).rejects.toThrow();
    await events.close();
    await app.close();

    const failed = await queue.getJob(job.id as string);
    expect(failed?.attemptsMade).toBe(3);
    const lines = error.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('response-stats'));
    expect(lines).toEqual([
      expect.stringMatching(/^insights job response-stats failed: /),
    ]);
    error.mockRestore();
  });
});

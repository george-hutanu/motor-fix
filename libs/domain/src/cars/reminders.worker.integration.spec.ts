import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Job, Queue } from 'bullmq';

import {
  REMINDERS_CLOCK,
  REMINDERS_QUEUE,
  RemindersModule,
  RemindersScheduler,
} from './reminders.module';
import { RemindersService } from './reminders.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { addDays } from '../bucharest';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications/notifications.testing';
import { bucharestDaily, type DailyClock } from '../scheduler/daily';

const redisUrl = redisUrlFor(4);
const { account, prisma, reset } = fixtures();

// A reminder's car must exist (the foreign key); any car of the account will do.
const car = async (ownerId: string) => {
  const brand = await prisma.brand.upsert({
    create: { key: 'test-dacia', name: 'Dacia', slug: 'test-dacia' },
    update: {},
    where: { name: 'Dacia' },
  });
  const { id } = await prisma.car.create({
    data: {
      brandId: brand.id,
      fuel: 'petrol',
      idempotencyKey: randomUUID(),
      model: 'Logan',
      odometerKm: 90000,
      ownerId,
      year: 2018,
    },
  });
  return id;
};
serialDatabase(databaseUrl);

const queue = new Queue(REMINDERS_QUEUE, { connection: { url: redisUrl } });

afterAll(async () => {
  await queue.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
});

describe('the reminders schedule at start-up', () => {
  const run = jest.fn(async () => 0);
  const scheduler = (iso: string) => {
    const s = new RemindersScheduler(queue, bucharestDaily(9), {
      run,
    } as unknown as RemindersService);
    s.now = () => new Date(iso);
    return s;
  };

  beforeEach(() => run.mockClear());

  it('runs a missed day at once when it starts at 11:20, then waits for tomorrow', async () => {
    await scheduler('2026-11-10T09:20:00Z').start();

    const today = await queue.getJob('daily-2026-11-10');
    expect(today).toMatchObject({ data: { day: '2026-11-10' }, name: 'daily' });
    expect(today?.opts.delay ?? 0).toBe(0);

    const tomorrow = await queue.getJob('daily-2026-11-11');
    expect(tomorrow?.opts.delay).toBe(
      new Date('2026-11-11T07:00:00Z').getTime() -
        new Date('2026-11-10T09:20:00Z').getTime(),
    );
    expect(await queue.getJobs(['delayed', 'waiting'])).toHaveLength(2);
  });

  it('only waits for 09:00 when it starts before it', async () => {
    await scheduler('2026-11-10T05:00:00Z').start();

    const jobs = await queue.getJobs(['delayed', 'waiting']);
    expect(jobs.map((j) => j.id)).toEqual(['daily-2026-11-10']);
    expect(jobs[0].opts.delay).toBe(2 * 3_600_000);
  });

  it('starts twice without a second job for the same day', async () => {
    await scheduler('2026-11-10T05:00:00Z').start();
    await scheduler('2026-11-10T05:30:00Z').start();
    expect(await queue.getJobs(['delayed', 'waiting'])).toHaveLength(1);
  });

  it('runs the day of its job, then queues the next day', async () => {
    const s = scheduler('2026-11-10T07:00:01Z');
    await s.handle({ data: { day: '2026-11-10' } } as Job);

    expect(run).toHaveBeenCalledWith('2026-11-10');
    expect(await queue.getJob('daily-2026-11-11')).toBeDefined();
  });

  it('runs every daily task after the reminders, in order, at the time it runs', async () => {
    const order: string[] = [];
    run.mockImplementationOnce(async () => {
      order.push('reminders');
      return 0;
    });
    const task = (name: string) => ({
      run: jest.fn(async () => {
        order.push(name);
      }),
    });
    const first = task('first');
    const second = task('second');
    const s = new RemindersScheduler(
      queue,
      bucharestDaily(9),
      { run } as unknown as RemindersService,
      [first, second],
    );
    s.now = () => new Date('2026-11-10T07:00:01Z');

    await s.handle({ data: { day: '2026-11-10' } } as Job);

    expect(order).toEqual(['reminders', 'first', 'second']);
    expect(first.run).toHaveBeenCalledWith(new Date('2026-11-10T07:00:01Z'));
  });

  it('still queues the next day when the run fails', async () => {
    run.mockRejectedValueOnce(new Error('database down'));
    const s = scheduler('2026-11-10T07:00:01Z');
    await expect(
      s.handle({ data: { day: '2026-11-10' } } as Job),
    ).rejects.toThrow('database down');
    expect(await queue.getJob('daily-2026-11-11')).toBeDefined();
  });

  it('retries a failed run 3 times with backoff', async () => {
    await scheduler('2026-11-10T05:00:00Z').start();
    const [job] = await queue.getJobs(['delayed']);
    expect(job.opts.attempts).toBe(4);
    expect(job.opts.backoff).toMatchObject({ type: 'exponential' });
    // A finished day keeps its id, so a restart that day does not rerun it;
    // a failed one frees it, so a restart tries it again.
    expect(job.opts.removeOnComplete).toEqual({ age: 2 * 86_400 });
    expect(job.opts.removeOnFail).toBe(true);
  });

  it('logs an error when a run fails for good, not before', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const s = scheduler('2026-11-10T07:00:00Z');
    const job = (attemptsMade: number) =>
      ({
        attemptsMade,
        data: { day: '2026-11-10' },
        opts: { attempts: 4 },
      }) as Job;

    s.failed(job(2), new Error('database down'));
    expect(error).not.toHaveBeenCalled();
    s.failed(job(4), new Error('database down'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('2026-11-10'));
    error.mockRestore();
  });
});

describe('the reminders worker with shortened days', () => {
  it('sends the 30-day and then the 7-day ITP reminder, once each', async () => {
    const notifications = NotificationsModule.registerWorker({
      databaseUrl,
      email: testConfig('http://127.0.0.1:9', { EMAIL_SENDING: 'off' }),
      phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
      redisUrl,
    });
    const app = await Test.createTestingModule({
      imports: [
        RemindersModule.registerWorker({ dayMs: 250, notifications, redisUrl }),
      ],
    }).compile();
    await app.init();

    const driver = await account('florin', ['driver'], { email: null });
    const clock = app.get<DailyClock>(REMINDERS_CLOCK);
    const carId = await car(driver);
    await app.get(RemindersService).setCarDue({
      accountId: driver,
      carId,
      dueOn: addDays(clock.today(new Date()), 31),
      kind: 'itp',
    });

    const bell = () =>
      prisma.notification.findMany({
        orderBy: { createdAt: 'asc' },
        where: { accountId: driver, channel: 'in_app', kind: 'DUE_ITP' },
      });
    const deadline = Date.now() + 20_000;
    while ((await bell()).length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // Two more shortened days: nothing more goes.
    await new Promise((r) => setTimeout(r, 600));
    await app.close();

    const sent = await bell();
    expect(sent.map((n) => n.eventId.split(':')[2])).toEqual(['30', '7']);
  }, 30_000);
});

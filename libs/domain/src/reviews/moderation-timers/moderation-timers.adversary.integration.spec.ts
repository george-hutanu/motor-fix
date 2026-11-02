import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job, Queue } from 'bullmq';

import {
  MODERATION_TIMERS_QUEUE,
  type ModerationEvent,
  ModerationTimers,
} from './moderation-timers';
import { ModerationTimersModule } from './moderation-timers.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { garageReviews } from '../reviews.testing';

const redisUrl = redisUrlFor(13);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
const { review } = garageReviews(world);
serialDatabase(databaseUrl);

const jobs = new Queue(MODERATION_TIMERS_QUEUE, {
  connection: { url: redisUrl },
});

const HOUR = 3_600_000;
const NOW = new Date('2026-10-26T12:00:00Z');
const KIND = 'ADMIN_REVIEW_REPORTED';

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await jobs.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
  await jobs.obliterate({ force: true });
});

async function start() {
  app = await Test.createTestingModule({
    imports: [
      ModerationTimersModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
        redisUrl,
        webUrl: 'https://motorfix.test',
      }),
    ],
  }).compile();
  app.get(NotificationsService).now = () => NOW;
  const timers = app.get(ModerationTimers);
  timers.now = () => NOW;
  return timers;
}

const event = (
  kind: string,
  payload: ModerationEvent['payload'],
  id = '9001',
): Pick<Job<ModerationEvent>, 'data'> => ({ data: { id, kind, payload } });

async function reported(createdAt = new Date(NOW.getTime() - HOUR)) {
  const ana = await account('Ana Admin', ['admin']);
  const andrei = await account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  const one = await review(garage.id, andrei, { rating: 2 });
  const report = await prisma.reviewReport.create({
    data: {
      createdAt,
      dueAt: new Date(createdAt.getTime() + 48 * HOUR),
      reason: 'insults',
      reviewId: one.id,
      source: 'garage',
    },
  });
  return { ana, one, report };
}

const delays = async () =>
  (await jobs.getJobs(['delayed', 'waiting'])).map((j) => j.id);

const told = () => prisma.notification.count({ where: { kind: KIND } });

// @traces 177-FR-011 177-FR-012 177-FR-013
describe('the moderation-timers consumer under hostile events', () => {
  it.each(['review.reported', 'review.decided', 'review.deleted'])(
    'ignores a %s event with an empty payload',
    async (kind) => {
      await reported();
      const timers = await start();

      await expect(timers.onEvent(event(kind, {}))).resolves.toBeUndefined();

      expect(await told()).toBe(0);
      expect(await delays()).toEqual([]);
    },
  );

  it('ignores a kind it was not given', async () => {
    const { report } = await reported();
    const timers = await start();

    await timers.onEvent(event('review.edited', { reportId: report.id }));

    expect(await told()).toBe(0);
    expect(await delays()).toEqual([]);
  });

  it.each([
    ['review.reported', { reportId: 'not-a-uuid' }],
    ['review.reported', { reportId: 42 }],
    ['review.decided', { reportId: 'not-a-uuid' }],
    ['review.deleted', { reviewId: 'not-a-uuid' }],
    ['review.deleted', { reviewId: 42 }],
  ])(
    'settles a %s event carrying %j without failing the job',
    async (kind, payload) => {
      await reported();
      const timers = await start();

      await expect(
        timers.onEvent(event(kind, payload as ModerationEvent['payload'])),
      ).resolves.toBeUndefined();
    },
  );

  it('sets a reminder for an unknown report id as nothing at all', async () => {
    const timers = await start();

    await timers.onEvent(
      event('review.reported', {
        reportId: '00000000-0000-4000-8000-000000000000',
      }),
    );

    expect(await told()).toBe(0);
    expect(await delays()).toEqual([]);
  });

  it('keeps one reminder job when the same reported event comes twice', async () => {
    const { report } = await reported();
    const timers = await start();
    const again = event('review.reported', { reportId: report.id }, '777');

    await timers.onEvent(again);
    await timers.onEvent(again);

    expect(await delays()).toHaveLength(1);
  });

  it('does not remind about a report that was never pending when its timer fires', async () => {
    const { report } = await reported();
    await prisma.reviewReport.update({
      data: { status: 'closed' },
      where: { id: report.id },
    });
    const timers = await start();

    await timers.timers.handle({
      data: { id: report.id },
      name: 'report-reminder',
    } as Job<{ id?: string }>);

    expect(await told()).toBe(0);
  });

  it('does not remind twice when the timer fires twice', async () => {
    const { report } = await reported(new Date(NOW.getTime() - 49 * HOUR));
    const timers = await start();
    const fire = () =>
      timers.timers.handle({
        data: { id: report.id },
        name: 'report-reminder',
      } as Job<{ id?: string }>);

    await fire();
    const first = await told();
    await fire();

    expect(first).toBeGreaterThan(0);
    expect(await told()).toBe(first);
  });

  it('closes every pending report on a deleted review, reply reports too', async () => {
    const { one, report } = await reported();
    await prisma.reviewReport.update({
      data: { status: 'decided' },
      where: { id: report.id },
    });
    const second = await prisma.reviewReport.create({
      data: {
        dueAt: new Date(NOW.getTime() + HOUR),
        reason: 'insults',
        reviewId: one.id,
        source: 'author',
        target: 'reply',
      },
    });
    const timers = await start();

    await timers.onEvent(event('review.deleted', { reviewId: one.id }, 'x'));

    const rows = await prisma.reviewReport.findMany({
      select: { id: true, status: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: second.id, status: 'closed' },
        { id: report.id, status: 'decided' },
      ]),
    );
  });

  it('closes with the processing time when the event id is not an outbox row', async () => {
    const { one, report } = await reported();
    const timers = await start();

    await timers.onEvent(
      event('review.deleted', { reviewId: one.id }, '999999999999999999999'),
    );

    expect(
      await prisma.reviewReport.findUniqueOrThrow({ where: { id: report.id } }),
    ).toMatchObject({ decidedAt: NOW, status: 'closed' });
  });
});

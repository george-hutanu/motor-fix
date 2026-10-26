import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job, Queue } from 'bullmq';

import {
  MODERATION_TIMERS_CONSUMER,
  MODERATION_TIMERS_QUEUE,
  type ModerationEvent,
  ModerationTimers,
} from './moderation-timers';
import { ModerationTimersModule } from './moderation-timers.module';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import type {
  ReviewReportSource,
  ReviewReportStatus,
} from '../../generated/prisma/enums';
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
import { garageReviews, reviewReply } from '../reviews.testing';

const redisUrl = redisUrlFor(13);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
const { review } = garageReviews(world);
const reply = reviewReply(world);
serialDatabase(databaseUrl);

const reader = countedMetrics();
const alerts = (outcome: string) =>
  counterTotal(reader, 'motorfix_review_report_alerts_total', { outcome });
const reminders = (outcome: string) =>
  counterTotal(reader, 'motorfix_review_report_reminders_total', { outcome });

const jobs = new Queue(MODERATION_TIMERS_QUEUE, {
  connection: { url: redisUrl },
});

const HOUR = 3_600_000;
const NOW = new Date('2026-10-26T12:00:00Z');
const WEB = 'https://motorfix.test';
const KIND = 'ADMIN_REVIEW_REPORTED';
const REVIEW_TEXT = 'Mi-au zgâriat ușa și nu au recunoscut.';

let app: TestingModule | undefined;
let logged: string[];

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await jobs.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  logged = [];
  const keep = (message: unknown) => {
    logged.push(String(message));
  };
  jest.spyOn(Logger.prototype, 'log').mockImplementation(keep);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(keep);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(keep);
  await reset();
  await prisma.outboxEvent.deleteMany();
  await jobs.obliterate({ force: true });
});

// Compiled, never started: no worker takes the jobs and no sweep is
// scheduled, so each case runs the timers itself at `now`.
async function start(now = NOW, webUrl = WEB) {
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
        webUrl,
      }),
    ],
  }).compile();
  app.get(NotificationsService).now = () => now;
  const timers = app.get(ModerationTimers);
  timers.now = () => now;
  return timers;
}

interface Setting {
  source?: ReviewReportSource;
  target?: 'review' | 'reply';
  status?: ReviewReportStatus;
  createdAt?: Date;
}

// Ana (Romanian) and Ben (English) are active admins, Sorin a suspended
// one; Andrei's one-star review of Atelier Dinamo is reported.
async function setting(options: Setting = {}) {
  const ana = await account('Ana Admin', ['admin']);
  const ben = await account('Ben Admin', ['admin'], { language: 'en' });
  const sorin = await account('Sorin Admin', ['admin'], {
    status: 'suspended',
  });
  const andrei = await account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  const one = await review(garage.id, andrei, {
    rating: 1,
    text: REVIEW_TEXT,
  });
  if (options.target === 'reply') await reply(one.id);
  const createdAt = options.createdAt ?? new Date(NOW.getTime() - HOUR);
  const report = await prisma.reviewReport.create({
    data: {
      createdAt,
      dueAt: new Date(createdAt.getTime() + 48 * HOUR),
      reason: 'insults',
      reviewId: one.id,
      source: options.source ?? 'garage',
      status: options.status ?? 'pending',
      target: options.target ?? 'review',
    },
  });
  const reported: Pick<Job<ModerationEvent>, 'data'> = {
    data: {
      id: '501',
      kind: 'review.reported',
      payload: {
        garageId: garage.id,
        reason: 'insults',
        reportId: report.id,
        reviewId: one.id,
        source: report.source,
        target: report.target,
      },
      subjectId: one.id,
    },
  };
  return { ana, andrei, ben, garage, report, reported, review: one, sorin };
}

const sent = (where: { accountId?: string; eventId?: string } = {}) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { fallbackOf: null, kind: KIND, ...where },
  });

const bells = async (accountId: string) =>
  (await sent({ accountId })).filter((m) => m.channel === 'in_app');

const delays = async () =>
  Object.fromEntries(
    (await jobs.getJobs(['delayed', 'waiting'])).map((j) => [
      j.id,
      j.opts.delay,
    ]),
  );

const fire = (timers: ModerationTimers, id: string) =>
  timers.timers.handle({
    data: { id },
    name: 'report-reminder',
  } as Job<{ id?: string }>);

// @traces 177-FR-011 177-FR-012 177-FR-013
describe('the moderation-timers consumer', () => {
  it('takes review.reported, review.decided and review.deleted on its own queue, retried six times', () => {
    expect(MODERATION_TIMERS_CONSUMER).toEqual({
      jobs: {
        attempts: 6,
        backoff: { delay: 60_000, type: 'exponential' },
        removeOnComplete: true,
        removeOnFail: true,
      },
      kinds: ['review.reported', 'review.decided', 'review.deleted'],
      queue: 'moderation-timers',
    });
  });
});

// @traces 177-FR-011 177-FR-018
describe('telling the admins a review was reported', () => {
  it('tells every active admin once, never a suspended one, under the event id', async () => {
    const { ana, ben, reported, report, sorin } = await setting();
    const timers = await start();
    const built = await alerts('built');

    await timers.onEvent(reported);

    for (const admin of [ana, ben]) {
      const bell = await bells(admin);
      expect(bell).toHaveLength(1);
      expect(bell[0]).toMatchObject({ eventId: '501', subjectId: report.id });
      expect(bell[0].params).toMatchObject({
        garage: 'Atelier Dinamo',
        reason: 'insults',
        score: 1,
      });
      expect(bell[0].params).not.toHaveProperty('variant');
    }
    expect(await sent({ accountId: sorin })).toEqual([]);
    expect((await alerts('built')) - built).toBe(1);
  });

  it('sends e-mail and push, never SMS or WhatsApp', async () => {
    const { reported } = await setting();
    const timers = await start();

    await timers.onEvent(reported);

    const channels = new Set((await sent()).map((m) => m.channel));
    expect(channels.has('email')).toBe(true);
    expect(channels.has('sms')).toBe(false);
    expect(channels.has('whatsapp')).toBe(false);
  });

  it('builds nothing more when the event comes again', async () => {
    const { reported } = await setting();
    const timers = await start();
    await timers.onEvent(reported);
    const first = (await sent()).length;

    await timers.onEvent(reported);

    expect((await sent()).length).toBe(first);
  });

  it('words a reported reply by its author', async () => {
    const { ana, reported } = await setting({
      source: 'author',
      target: 'reply',
    });
    const timers = await start();

    await timers.onEvent(reported);

    expect((await bells(ana))[0].params).toMatchObject({
      author: 'Andrei M.',
      variant: 'reply',
    });
  });

  it('words an automatic flag', async () => {
    const { ana, reported } = await setting({ source: 'automatic' });
    const timers = await start();

    await timers.onEvent(reported);

    expect((await bells(ana))[0].params).toMatchObject({
      variant: 'automatic',
    });
  });

  it('tells nobody when the report is gone or no longer pending', async () => {
    const { reported } = await setting({ status: 'decided' });
    const timers = await start();
    const skipped = await alerts('skipped');

    await timers.onEvent(reported);

    expect(await sent()).toEqual([]);
    expect((await alerts('skipped')) - skipped).toBe(1);
  });
});

// @traces 177-FR-011 177-FR-017
describe('when nobody can be told', () => {
  const noAdmins = () =>
    prisma.account.updateMany({
      data: { status: 'suspended' },
      where: { roles: { some: { role: 'admin' } } },
    });

  it('tells nobody and counts a skipped alert when no admin is active', async () => {
    const { reported } = await setting();
    await noAdmins();
    const timers = await start();
    const skipped = await alerts('skipped');

    await timers.onEvent(reported);

    expect(await sent()).toEqual([]);
    expect((await alerts('skipped')) - skipped).toBe(1);
  });

  it('tells nobody and counts a skipped alert without the web address', async () => {
    const { reported } = await setting();
    const timers = await start(NOW, '');
    const skipped = await alerts('skipped');

    await timers.onEvent(reported);

    expect(await sent()).toEqual([]);
    expect((await alerts('skipped')) - skipped).toBe(1);
  });

  it('sends no reminder without the web address, and the sweep does not retry it', async () => {
    const { report } = await setting({
      createdAt: new Date(NOW.getTime() - 49 * HOUR),
    });
    const timers = await start(NOW, '');
    const skipped = await reminders('skipped');

    await fire(timers, report.id);
    await timers.timers.sweep(NOW);
    await timers.timers.sweep(NOW);

    expect(await sent()).toEqual([]);
    expect((await reminders('skipped')) - skipped).toBe(1);
  });

  it('sends no reminder with no active admin, and the sweep does not retry it', async () => {
    const { report } = await setting({
      createdAt: new Date(NOW.getTime() - 49 * HOUR),
    });
    await noAdmins();
    const timers = await start();
    const skipped = await reminders('skipped');

    await fire(timers, report.id);
    await timers.timers.sweep(NOW);
    await timers.timers.sweep(NOW);

    expect(await sent()).toEqual([]);
    expect((await reminders('skipped')) - skipped).toBe(1);
  });
});

// @traces 177-FR-012 177-FR-018
describe('the 48-hour reminder', () => {
  it('sets one delayed job at the report’s due time', async () => {
    const { reported, report } = await setting();
    const timers = await start();

    await timers.onEvent(reported);
    await timers.onEvent(reported);

    expect(await delays()).toEqual({
      [`report-reminder-${report.id}`]: 47 * HOUR,
    });
  });

  it('fires at once when the due time has already passed', async () => {
    const { reported, report } = await setting({
      createdAt: new Date(NOW.getTime() - 50 * HOUR),
    });
    const timers = await start();

    await timers.onEvent(reported);

    expect(await delays()).toEqual({ [`report-reminder-${report.id}`]: 0 });
  });

  it('reminds every active admin once while the report is pending', async () => {
    const { ana, ben, report, sorin } = await setting();
    const timers = await start(new Date(NOW.getTime() + 47 * HOUR));
    const sentBefore = await reminders('sent');

    await fire(timers, report.id);
    await fire(timers, report.id);

    for (const admin of [ana, ben]) {
      const bell = await bells(admin);
      expect(bell).toHaveLength(1);
      expect(bell[0]).toMatchObject({
        eventId: `report-reminder:${report.id}`,
        subjectId: report.id,
      });
      expect(bell[0].params).toMatchObject({
        garage: 'Atelier Dinamo',
        score: 1,
        variant: 'reminder',
      });
    }
    expect(await sent({ accountId: sorin })).toEqual([]);
    expect((await reminders('sent')) - sentBefore).toBe(1);
  });

  it.each(['decided', 'closed'] as const)(
    'sends nothing for a %s report',
    async (status) => {
      const { report } = await setting({ status });
      const timers = await start(new Date(NOW.getTime() + 47 * HOUR));
      const skipped = await reminders('skipped');

      await fire(timers, report.id);

      expect(await sent()).toEqual([]);
      expect((await reminders('skipped')) - skipped).toBe(1);
    },
  );

  it('names a reported reply as a reply', async () => {
    const { ana, report } = await setting({
      source: 'author',
      target: 'reply',
    });
    const timers = await start(new Date(NOW.getTime() + 47 * HOUR));

    await fire(timers, report.id);

    expect((await bells(ana))[0].params).toMatchObject({
      author: 'Andrei M.',
      variant: 'reminder_reply',
    });
  });

  it('keeps the job when a decision names no report', async () => {
    const { reported, report, review: one } = await setting();
    const timers = await start();
    await timers.onEvent(reported);

    await timers.onEvent({
      data: {
        id: '502',
        kind: 'review.decided',
        payload: { reviewId: one.id },
        subjectId: one.id,
      },
    });

    expect(Object.keys(await delays())).toEqual([
      `report-reminder-${report.id}`,
    ]);
  });

  it('removes the job when the report is decided', async () => {
    const { reported, report, review: one } = await setting();
    const timers = await start();
    await timers.onEvent(reported);

    await timers.onEvent({
      data: {
        id: '502',
        kind: 'review.decided',
        payload: { reportId: report.id, reviewId: one.id },
        subjectId: one.id,
      },
    });

    expect(await delays()).toEqual({});
  });

  it('lets the sweep send a reminder whose job was lost, only once', async () => {
    const { ana, report } = await setting({
      createdAt: new Date(NOW.getTime() - 49 * HOUR),
    });
    const timers = await start();

    await timers.timers.sweep(NOW);
    await timers.timers.sweep(NOW);

    const bell = await bells(ana);
    expect(bell.map((m) => m.eventId)).toEqual([
      `report-reminder:${report.id}`,
    ]);
  });
});

// @traces 177-FR-013 177-FR-018
describe('closing the report when its author deletes the review', () => {
  const deleted = async (reviewId: string, at: Date) => {
    const event = await prisma.outboxEvent.create({
      data: {
        audience: [],
        createdAt: at,
        kind: 'review.deleted',
        payload: { reviewId },
        subjectId: reviewId,
      },
    });
    return {
      data: {
        id: String(event.id),
        kind: 'review.deleted',
        payload: { reviewId },
        subjectId: reviewId,
      },
    };
  };

  it('closes the pending report at the event’s time, with no decision, and clears its reminder', async () => {
    const { reported, report, review: one } = await setting();
    const timers = await start();
    await timers.onEvent(reported);
    const at = new Date(NOW.getTime() - 5 * 60_000);

    await timers.onEvent(await deleted(one.id, at));

    expect(
      await prisma.reviewReport.findUniqueOrThrow({
        where: { id: report.id },
      }),
    ).toMatchObject({ decidedAt: at, decision: null, status: 'closed' });
    expect(await delays()).toEqual({});
  });

  it('saves the close with its audit entry and an admin-only event', async () => {
    const { report, review: one } = await setting();
    const timers = await start();
    const event = await deleted(one.id, NOW);

    await timers.onEvent(event);
    await timers.onEvent(event);

    const entries = await prisma.activityLog.findMany({
      where: { subjectId: report.id, subjectType: 'review_report' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: null,
      actorRole: 'system',
      field: 'status',
    });
    const closed = await prisma.outboxEvent.findMany({
      where: { kind: 'review.report_closed' },
    });
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      audience: ['admin'],
      payload: { reportId: report.id, reviewId: one.id },
      subjectId: report.id,
    });
  });

  it('closes nothing when its audit entry cannot be written, and closes on the next delivery', async () => {
    const { report, review: one } = await setting();
    const timers = await start();
    jest
      .spyOn(AuditService.prototype, 'record')
      .mockRejectedValueOnce(new Error('audit down'));
    const event = await deleted(one.id, NOW);

    await expect(timers.onEvent(event)).rejects.toThrow('audit down');

    expect(
      await prisma.reviewReport.findUniqueOrThrow({
        where: { id: report.id },
      }),
    ).toMatchObject({ status: 'pending' });
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'review.report_closed' },
      }),
    ).toBe(0);

    await timers.onEvent(event);

    expect(
      await prisma.reviewReport.findUniqueOrThrow({
        where: { id: report.id },
      }),
    ).toMatchObject({ status: 'closed' });
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'review.report_closed' },
      }),
    ).toBe(1);
  });

  it('changes nothing on a second delivery', async () => {
    const { report, review: one } = await setting();
    const timers = await start();
    const event = await deleted(one.id, NOW);
    await timers.onEvent(event);
    const first = await prisma.reviewReport.findUniqueOrThrow({
      where: { id: report.id },
    });

    await timers.onEvent(event);

    expect(
      await prisma.reviewReport.findUniqueOrThrow({
        where: { id: report.id },
      }),
    ).toEqual(first);
  });

  it('leaves a decided report as it was', async () => {
    const { report, review: one } = await setting({ status: 'decided' });
    const timers = await start();

    await timers.onEvent(await deleted(one.id, NOW));

    expect(
      await prisma.reviewReport.findUniqueOrThrow({
        where: { id: report.id },
      }),
    ).toMatchObject({ status: 'decided' });
  });
});

// @traces 177-FR-017
describe('the log lines', () => {
  it('name ids and steps only: no review text, no names', async () => {
    const { reported, report } = await setting();
    const timers = await start();

    await timers.onEvent(reported);
    await fire(timers, report.id);

    const lines = logged.join('\n');
    expect(lines).toContain(report.id);
    for (const secret of [
      REVIEW_TEXT,
      'Atelier Dinamo',
      'Andrei',
      'Ana Admin',
      'Ben Admin',
      '@example.test',
    ]) {
      expect(lines).not.toContain(secret);
    }
  });
});

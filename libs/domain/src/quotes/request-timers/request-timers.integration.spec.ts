import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job, Queue } from 'bullmq';

import {
  REQUEST_TIMERS_CONSUMER,
  REQUEST_TIMERS_QUEUE,
  RequestTimers,
} from './request-timers';
import { RequestTimersModule } from './request-timers.module';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import type {
  QuoteRequestStatus,
  QuoteStatus,
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
import { AcceptService } from '../accept/accept.service';
import { quotesWorld } from '../quotes.testing';

const redisUrl = redisUrlFor(13);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (step: string, sweep: boolean) =>
  counterTotal(reader, 'motorfix_request_timers_total', {
    step,
    sweep: String(sweep),
  });

const jobs = new Queue(REQUEST_TIMERS_QUEUE, { connection: { url: redisUrl } });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const WEB = 'https://motorfix.test';
// Monday 10:00 in Bucharest; day 2 is Wednesday, day 5 Saturday, the
// seventh day ends the next Monday, all at 10:00.
const CREATED = new Date('2026-11-09T08:00:00Z');
const DAY2 = new Date('2026-11-11T08:00:00Z');
const DAY5 = new Date('2026-11-14T08:00:00Z');
const EXPIRES = new Date('2026-11-16T08:00:00Z');
// Tuesday 15:00 in Bucharest, seven days after a quote sent the Tuesday before.
const QUOTE_EXPIRES = new Date('2026-11-17T13:00:00Z');

let app: TestingModule | undefined;

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
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
  await jobs.obliterate({ force: true });
});

// Compiled, never started: no worker takes the queue's jobs and no sweep is
// scheduled, so each case runs the timers itself at `now`.
async function start(now: Date) {
  app = await Test.createTestingModule({
    imports: [
      RequestTimersModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
        redisUrl,
        webUrl: WEB,
      }),
    ],
  }).compile();
  const service = app.get(NotificationsService);
  service.now = () => now;
  const timers = app.get(RequestTimers);
  timers.now = () => now;
  const at = (later: Date) => {
    service.now = () => later;
    timers.now = () => later;
  };
  return { at, timers };
}

// A garage with an owner, an English-speaking receptionist, a mechanic who
// may answer quotes and one who may not.
async function staffed(name: string) {
  const garage = await world.garage(name);
  const owner = await account(`${name} Owner`, ['garage']);
  const desk = await account(`${name} Desk`, ['garage'], {
    language: 'en',
  });
  const fixer = await account(`${name} Fixer`, ['mechanic']);
  const silent = await account(`${name} Silent`, ['mechanic']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: desk, garageId: garage.id, role: 'receptionist' },
    ],
  });
  await prisma.mechanic.createMany({
    data: [
      {
        accountId: fixer,
        canAnswerQuotes: true,
        garageId: garage.id,
        name: 'Fixer',
      },
      { accountId: silent, garageId: garage.id, name: 'Silent' },
    ],
  });
  return { desk, fixer, garage, owner, silent };
}

type Staffed = Awaited<ReturnType<typeof staffed>>;

// Andrei's request, sent at `createdAt` to the given garages, each waiting.
async function sent(
  garages: Staffed[],
  options: { createdAt?: Date; status?: QuoteRequestStatus } = {},
) {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const request = await world.request(driverId, {
    createdAt: options.createdAt ?? CREATED,
    status: options.status ?? 'sent',
  });
  const recipients = [];
  for (const { garage } of garages) {
    recipients.push(await world.recipient(request.id, garage.id));
  }
  const event = {
    data: {
      id: '501',
      kind: 'request.created',
      payload: {
        driverId,
        garageIds: garages.map((g) => g.garage.id),
        requestId: request.id,
      },
      subjectId: request.id,
    },
  };
  return { driverId, event, recipients, request };
}

// A waiting quote from `garage` on the request, valid until `expiresAt`.
async function quoted(
  requestId: string,
  garage: Staffed,
  expiresAt = QUOTE_EXPIRES,
  status: QuoteStatus = 'waiting',
) {
  await prisma.requestRecipient.updateMany({
    data: { answeredAt: CREATED, status: 'quoted' },
    where: { garageId: garage.garage.id, requestId },
  });
  const quote = await world.quote(requestId, garage.garage.id, status);
  await prisma.quote.update({ data: { expiresAt }, where: { id: quote.id } });
  await prisma.quoteRequest.updateMany({
    data: { status: 'quoted' },
    where: { id: requestId, status: 'sent' },
  });
  return quote;
}

const event = (kind: string, payload: Record<string, unknown>) => ({
  data: {
    id: randomUUID(),
    kind,
    payload,
    subjectId: String(payload['quoteId'] ?? payload['requestId']),
  },
});

const delays = async () =>
  Object.fromEntries(
    (await jobs.getJobs(['delayed', 'waiting'])).map((j) => [
      j.id,
      j.opts.delay,
    ]),
  );

const fire = (timers: RequestTimers, name: string, id: string) =>
  timers.timers.handle({ data: { id }, name } as Job<{ id?: string }>);

// The relay's hand-over of this module's own events to its queue.
async function relay(timers: RequestTimers, kind: string) {
  const rows = await prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { kind },
  });
  for (const row of rows) {
    await timers.onEvent({
      data: {
        id: String(row.id),
        kind: row.kind,
        payload: row.payload as Record<string, unknown> & { requestId: string },
        subjectId: row.subjectId,
      },
    });
  }
}

const messages = (kind: string, accountId?: string) =>
  prisma.notification.findMany({
    orderBy: { channel: 'asc' },
    where: { fallbackOf: null, kind, ...(accountId && { accountId }) },
  });

const bells = async (kind: string, accountId: string) =>
  (await messages(kind, accountId)).filter((m) => m.channel === 'in_app');

const recipientOf = (id: string) =>
  prisma.requestRecipient.findUniqueOrThrow({ where: { id } });

const requestOf = (id: string) =>
  prisma.quoteRequest.findUniqueOrThrow({ where: { id } });

const quoteOf = (id: string) =>
  prisma.quote.findUniqueOrThrow({ where: { id } });

const driverActor = (accountId: string): Actor => ({
  accountId,
  garageId: null,
  language: 'ro',
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
});

const muteRequests = (accountId: string, garageId: string) =>
  prisma.notificationPreference.createMany({
    data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
      accountId,
      channel,
      enabled: false,
      garageId,
      type: 'REQUEST_RECEIVED',
    })),
  });

// @traces 1257-FR-010 1257-FR-011
describe('setting and clearing a request’s timers', () => {
  it('takes the request’s and the quote’s events on its own queue', () => {
    expect(REQUEST_TIMERS_CONSUMER).toMatchObject({
      kinds: [
        'request.created',
        'quote.sent',
        'quote.accepted',
        'request.cancelled',
        'quote.withdrawn',
        'quote.declined_by_driver',
        'request.expired',
        'quote.expired',
      ],
      queue: 'request-timers',
    });
  });

  it('sets the day-2 and day-5 reminders and the expiry as the request is sent', async () => {
    const { event: created, request } = await sent([await staffed('Dinamo')]);
    const { timers } = await start(CREATED);

    await timers.onEvent(created);

    expect(await delays()).toEqual({
      [`request-expiry-${request.id}`]: EXPIRES.getTime() - CREATED.getTime(),
      [`request-reminder-2-${request.id}`]: DAY2.getTime() - CREATED.getTime(),
      [`request-reminder-5-${request.id}`]: DAY5.getTime() - CREATED.getTime(),
    });
  });

  it('sets no reminder whose day has already passed, and replaces rather than doubles', async () => {
    const { event: created, request } = await sent([await staffed('Dinamo')]);
    const late = new Date(DAY2.getTime() + MINUTE);
    const { timers } = await start(late);

    await timers.onEvent(created);
    await timers.onEvent(created);

    expect(Object.keys(await delays()).sort()).toEqual([
      `request-expiry-${request.id}`,
      `request-reminder-5-${request.id}`,
    ]);
  });

  it('sets the quote’s expiry as it is sent', async () => {
    const dinamo = await staffed('Dinamo');
    const { driverId, request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo);
    const now = new Date(QUOTE_EXPIRES.getTime() - 7 * 24 * HOUR);
    const { timers } = await start(now);

    await timers.onEvent(
      event('quote.sent', {
        driverId,
        garageId: dinamo.garage.id,
        quoteId: quote.id,
        requestId: request.id,
      }),
    );

    expect(await delays()).toEqual({
      [`quote-expiry-${quote.id}`]: 7 * 24 * HOUR,
    });
  });

  it('clears all three request timers when the request is cancelled', async () => {
    const { event: created, request } = await sent([await staffed('Dinamo')]);
    const { timers } = await start(CREATED);
    await timers.onEvent(created);

    await timers.onEvent(event('request.cancelled', { requestId: request.id }));

    expect(await delays()).toEqual({});
  });

  it('clears the reminders and the accepted quote’s expiry, keeping the request’s expiry, when a quote is accepted', async () => {
    const dinamo = await staffed('Dinamo');
    const { driverId, event: created, request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo);
    const { timers } = await start(CREATED);
    await timers.onEvent(created);
    await timers.onEvent(
      event('quote.sent', {
        driverId,
        garageId: dinamo.garage.id,
        quoteId: quote.id,
        requestId: request.id,
      }),
    );

    await timers.onEvent(
      event('quote.accepted', {
        bookingId: randomUUID(),
        quoteId: quote.id,
        requestId: request.id,
      }),
    );

    expect(Object.keys(await delays())).toEqual([
      `request-expiry-${request.id}`,
    ]);
  });

  it.each(['quote.withdrawn', 'quote.declined_by_driver'])(
    'clears the quote’s expiry on %s',
    async (kind) => {
      const dinamo = await staffed('Dinamo');
      const { driverId, request } = await sent([dinamo]);
      const quote = await quoted(request.id, dinamo);
      const { timers } = await start(CREATED);
      await timers.onEvent(
        event('quote.sent', {
          driverId,
          garageId: dinamo.garage.id,
          quoteId: quote.id,
          requestId: request.id,
        }),
      );

      await timers.onEvent(
        event(kind, { quoteId: quote.id, requestId: request.id }),
      );

      expect(await delays()).toEqual({});
    },
  );
});

// @traces 1257-FR-001 1257-FR-002 1257-FR-003 1257-FR-012 1257-FR-013
describe('reminding the garages still waiting', () => {
  it('tells the staff who may answer at each waiting garage once on day 2, and not the garage that quoted', async () => {
    const [dinamo, berceni, militari] = [
      await staffed('Dinamo'),
      await staffed('Berceni'),
      await staffed('Militari'),
    ];
    const { recipients, request } = await sent([dinamo, berceni, militari]);
    await quoted(request.id, militari);
    const { timers } = await start(DAY2);
    const before = await counted('reminder_sent', false);

    await fire(timers, 'request-reminder-2', request.id);
    await fire(timers, 'request-reminder-2', request.id);
    await timers.timers.sweep(DAY2);

    for (const garage of [dinamo, berceni]) {
      for (const person of [garage.owner, garage.desk, garage.fixer]) {
        const [bell, ...more] = await bells('REQUEST_REMINDER', person);
        expect(more).toEqual([]);
        expect(bell.params).toMatchObject({
          car: 'Mini Cooper S',
          driver: 'Andrei M.',
        });
        expect(bell.subjectId).toBe(request.id);
      }
      expect(await messages('REQUEST_REMINDER', garage.silent)).toEqual([]);
    }
    for (const person of [militari.owner, militari.desk, militari.fixer]) {
      expect(await messages('REQUEST_REMINDER', person)).toEqual([]);
    }
    const [first, second, third] = await Promise.all(
      recipients.map((r) => recipientOf(r.id)),
    );
    expect(first.remindedDay2At).toEqual(DAY2);
    expect(second.remindedDay2At).toEqual(DAY2);
    expect(third.remindedDay2At).toBeNull();
    expect(first.remindedDay5At).toBeNull();
    expect(await counted('reminder_sent', false)).toBe(before + 2);
  });

  it('reminds again on day 5, recorded apart from day 2', async () => {
    const dinamo = await staffed('Dinamo');
    const { recipients, request } = await sent([dinamo]);
    const { at, timers } = await start(DAY2);
    await fire(timers, 'request-reminder-2', request.id);

    at(DAY5);
    await fire(timers, 'request-reminder-5', request.id);

    expect(await bells('REQUEST_REMINDER', dinamo.owner)).toHaveLength(2);
    expect(await recipientOf(recipients[0].id)).toMatchObject({
      remindedDay2At: DAY2,
      remindedDay5At: DAY5,
    });
  });

  it('sends nothing outside to a garage that muted new requests, still writes the bell and marks the day; unmuted, it gets day 5', async () => {
    const dinamo = await staffed('Dinamo');
    for (const person of [dinamo.owner, dinamo.desk, dinamo.fixer]) {
      await muteRequests(person, dinamo.garage.id);
    }
    const { recipients, request } = await sent([dinamo]);
    const { at, timers } = await start(DAY2);
    const before = await counted('reminder_muted', false);

    await fire(timers, 'request-reminder-2', request.id);

    expect(
      (await messages('REQUEST_REMINDER', dinamo.owner)).map((m) => m.channel),
    ).toEqual(['in_app']);
    expect((await recipientOf(recipients[0].id)).remindedDay2At).toEqual(DAY2);
    expect(await counted('reminder_muted', false)).toBe(before + 1);

    await prisma.notificationPreference.deleteMany();
    at(DAY5);
    await fire(timers, 'request-reminder-5', request.id);

    expect(
      (await messages('REQUEST_REMINDER', dinamo.owner)).map((m) => m.channel),
    ).toContain('email');
  });

  it('holds a reminder built at 23:00 in Bucharest until 08:00', async () => {
    const dinamo = await staffed('Dinamo');
    const late = new Date('2026-11-09T21:00:00Z');
    const { request } = await sent([dinamo], { createdAt: late });
    const { timers } = await start(new Date('2026-11-11T21:00:00Z'));

    await fire(timers, 'request-reminder-2', request.id);

    const [email] = (await messages('REQUEST_REMINDER', dinamo.owner)).filter(
      (m) => m.channel === 'email',
    );
    expect(email).toMatchObject({
      sendAfter: new Date('2026-11-12T06:00:00Z'),
      status: 'held',
    });
  });

  it('sends nothing once the request’s seven days have ended', async () => {
    const dinamo = await staffed('Dinamo');
    const { recipients, request } = await sent([dinamo]);
    const { timers } = await start(EXPIRES);

    await fire(timers, 'request-reminder-5', request.id);

    expect(await messages('REQUEST_REMINDER')).toEqual([]);
    expect((await recipientOf(recipients[0].id)).remindedDay5At).toBeNull();
  });

  it.each(['booked', 'closed'] as const)(
    'sends nothing for a request %s',
    async (status) => {
      const dinamo = await staffed('Dinamo');
      const { request } = await sent([dinamo], { status });
      const { timers } = await start(DAY2);

      await fire(timers, 'request-reminder-2', request.id);
      await timers.timers.sweep(DAY2);

      expect(await messages('REQUEST_REMINDER')).toEqual([]);
    },
  );

  it('does nothing when its timer fires before the day has come', async () => {
    const dinamo = await staffed('Dinamo');
    const { recipients, request } = await sent([dinamo]);
    const { timers } = await start(new Date(DAY2.getTime() - MINUTE));

    await fire(timers, 'request-reminder-2', request.id);

    expect(await messages('REQUEST_REMINDER')).toEqual([]);
    expect((await recipientOf(recipients[0].id)).remindedDay2At).toBeNull();
  });

  it('sends a reminder whose timer was lost once, from the sweep', async () => {
    const dinamo = await staffed('Dinamo');
    const { request } = await sent([dinamo]);
    const now = new Date(DAY2.getTime() + 10 * MINUTE);
    const { timers } = await start(now);
    const before = await counted('reminder_sent', true);

    await timers.timers.sweep(now);
    await timers.timers.sweep(now);
    await fire(timers, 'request-reminder-2', request.id);

    expect(await bells('REQUEST_REMINDER', dinamo.owner)).toHaveLength(1);
    expect(await counted('reminder_sent', true)).toBe(before + 1);
  });
});

// @traces 1257-FR-004 1257-FR-005 1257-FR-010 1257-FR-012 1257-FR-013
describe('expiring a request at the end of its seven days', () => {
  it('expires every waiting garage, closes the request and tells both sides, the driver with a way to ask others', async () => {
    const [dinamo, berceni] = [
      await staffed('Dinamo'),
      await staffed('Berceni'),
    ];
    const { driverId, recipients, request } = await sent([dinamo, berceni]);
    const { timers } = await start(EXPIRES);
    const before = {
      closed: await counted('request_closed', false),
      expired: await counted('recipient_expired', false),
    };

    await fire(timers, 'request-expiry', request.id);

    for (const recipient of recipients) {
      expect((await recipientOf(recipient.id)).status).toBe('expired');
      expect(
        await prisma.activityLog.findMany({
          where: { subjectId: recipient.id },
        }),
      ).toEqual([
        expect.objectContaining({ actorRole: 'system', newValue: 'expired' }),
      ]);
    }
    const closed = await requestOf(request.id);
    expect(closed).toMatchObject({ closedReason: 'expired', status: 'closed' });
    expect(closed.closedAt).not.toBeNull();
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'request.expired' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].subjectId).toBe(request.id);
    expect(events[0].payload).toEqual({
      closed: true,
      garageIds: expect.arrayContaining([dinamo.garage.id, berceni.garage.id]),
      requestId: request.id,
    });
    expect(await counted('recipient_expired', false)).toBe(before.expired + 2);
    expect(await counted('request_closed', false)).toBe(before.closed + 1);

    await relay(timers, 'request.expired');

    for (const garage of [dinamo, berceni]) {
      for (const person of [garage.owner, garage.desk]) {
        const [bell, ...more] = await bells('REQUEST_EXPIRED', person);
        expect(more).toEqual([]);
        expect(bell.params).toMatchObject({
          car: 'Mini Cooper S',
          driver: 'Andrei M.',
          side: 'garage',
        });
      }
      expect(await messages('REQUEST_EXPIRED', garage.fixer)).toEqual([]);
    }
    const toDriver = await messages('REQUEST_EXPIRED', driverId);
    expect(toDriver.filter((m) => m.channel === 'in_app')).toHaveLength(1);
    expect(toDriver.find((m) => m.channel === 'email')?.params).toMatchObject({
      car: 'Mini Cooper S',
      link: `${WEB}/app/driver/requests/${request.id}`,
      side: 'driver',
    });
  });

  it('expires the waiting garages but keeps the request open while a quote is still waiting', async () => {
    const [dinamo, berceni] = [
      await staffed('Dinamo'),
      await staffed('Berceni'),
    ];
    const { driverId, recipients, request } = await sent([dinamo, berceni]);
    await quoted(request.id, berceni, new Date(EXPIRES.getTime() + 24 * HOUR));
    const { timers } = await start(EXPIRES);

    await fire(timers, 'request-expiry', request.id);
    await relay(timers, 'request.expired');

    expect((await recipientOf(recipients[0].id)).status).toBe('expired');
    expect((await recipientOf(recipients[1].id)).status).toBe('quoted');
    expect((await requestOf(request.id)).status).toBe('quoted');
    const [expired] = await prisma.outboxEvent.findMany({
      where: { kind: 'request.expired' },
    });
    expect(expired.payload).toEqual({
      closed: false,
      garageIds: [dinamo.garage.id],
      requestId: request.id,
    });
    expect(await bells('REQUEST_EXPIRED', dinamo.owner)).toHaveLength(1);
    expect(await messages('REQUEST_EXPIRED', berceni.owner)).toEqual([]);
    expect(await messages('REQUEST_EXPIRED', driverId)).toEqual([]);
  });

  it.each(['booked', 'in_work', 'done', 'closed'] as const)(
    'changes nothing and tells nobody for a request %s',
    async (status) => {
      const dinamo = await staffed('Dinamo');
      const { recipients, request } = await sent([dinamo], { status });
      const { timers } = await start(EXPIRES);

      await fire(timers, 'request-expiry', request.id);
      await timers.timers.sweep(EXPIRES);

      expect((await recipientOf(recipients[0].id)).status).toBe('waiting');
      expect((await requestOf(request.id)).status).toBe(status);
      expect(await prisma.outboxEvent.count()).toBe(0);
    },
  );

  it('does nothing before its time', async () => {
    const dinamo = await staffed('Dinamo');
    const { recipients, request } = await sent([dinamo]);
    const { timers } = await start(new Date(EXPIRES.getTime() - MINUTE));

    await fire(timers, 'request-expiry', request.id);

    expect((await recipientOf(recipients[0].id)).status).toBe('waiting');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('writes and sends nothing more when the timer fires again, the sweep finds it or the event comes twice', async () => {
    const dinamo = await staffed('Dinamo');
    const { driverId, request } = await sent([dinamo]);
    const { timers } = await start(EXPIRES);

    await fire(timers, 'request-expiry', request.id);
    await fire(timers, 'request-expiry', request.id);
    await timers.timers.sweep(EXPIRES);
    await relay(timers, 'request.expired');
    await relay(timers, 'request.expired');

    expect(
      await prisma.outboxEvent.count({ where: { kind: 'request.expired' } }),
    ).toBe(1);
    expect(await bells('REQUEST_EXPIRED', dinamo.owner)).toHaveLength(1);
    expect(await bells('REQUEST_EXPIRED', driverId)).toHaveLength(1);
  });

  it('expires a request whose timer was lost, from the sweep, counted as the sweep’s', async () => {
    const dinamo = await staffed('Dinamo');
    const { request } = await sent([dinamo]);
    const now = new Date(EXPIRES.getTime() + 10 * MINUTE);
    const { timers } = await start(now);
    const before = await counted('request_closed', true);

    await timers.timers.sweep(now);

    expect((await requestOf(request.id)).status).toBe('closed');
    expect(await counted('request_closed', true)).toBe(before + 1);
  });
});

// @traces 1257-FR-006 1257-FR-007 1257-FR-008 1257-FR-010 1257-FR-012 1257-FR-013
describe('expiring a quote seven days after it was sent', () => {
  const accept = (driverId: string, quoteId: string) =>
    new AcceptService(prisma, new AuditService(), outbox).accept(
      driverActor(driverId),
      quoteId,
      randomUUID(),
      {},
    );

  it('expires it, tells the driver and the garage, keeps the request open for another quote and refuses its accept', async () => {
    const [dinamo, berceni] = [
      await staffed('Dinamo'),
      await staffed('Berceni'),
    ];
    const { driverId, request } = await sent([dinamo, berceni]);
    const quote = await quoted(request.id, dinamo);
    await quoted(request.id, berceni, new Date(QUOTE_EXPIRES.getTime() + HOUR));
    const { timers } = await start(QUOTE_EXPIRES);
    const before = await counted('quote_expired', false);

    await fire(timers, 'quote-expiry', quote.id);

    expect((await quoteOf(quote.id)).status).toBe('expired');
    expect((await requestOf(request.id)).status).toBe('quoted');
    expect(
      await prisma.activityLog.findMany({
        where: { field: 'expired_reason', subjectId: quote.id },
      }),
    ).toEqual([
      expect.objectContaining({ actorRole: 'system', newValue: 'time' }),
    ]);
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'quote.expired' },
    });
    expect(events.map((e) => e.payload)).toEqual([
      expect.objectContaining({
        quoteId: quote.id,
        reason: 'time',
        requestId: request.id,
      }),
    ]);
    expect(
      await prisma.outboxEvent.count({ where: { kind: 'request.expired' } }),
    ).toBe(0);
    expect(await counted('quote_expired', false)).toBe(before + 1);

    await relay(timers, 'quote.expired');

    const [toDriver, ...more] = await bells('QUOTE_EXPIRED', driverId);
    expect(more).toEqual([]);
    expect(toDriver.params).toMatchObject({
      car: 'Mini Cooper S',
      garage: 'Dinamo',
      side: 'driver',
    });
    for (const person of [dinamo.owner, dinamo.desk]) {
      const [bell] = await bells('QUOTE_EXPIRED', person);
      expect(bell.params).toMatchObject({
        driver: 'Andrei M.',
        side: 'garage',
      });
    }
    expect(await messages('QUOTE_EXPIRED', dinamo.fixer)).toEqual([]);
    expect(await messages('QUOTE_EXPIRED', berceni.owner)).toEqual([]);

    const refused = await accept(driverId, quote.id).catch((e) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(409);
  });

  it('closes the request when it was the last waiting quote, expiring the garages still waiting first, and tells the driver both', async () => {
    const [dinamo, berceni] = [
      await staffed('Dinamo'),
      await staffed('Berceni'),
    ];
    const { driverId, recipients, request } = await sent([dinamo, berceni]);
    const quote = await quoted(request.id, dinamo);
    const { timers } = await start(QUOTE_EXPIRES);

    await fire(timers, 'quote-expiry', quote.id);

    expect(await requestOf(request.id)).toMatchObject({
      closedReason: 'expired',
      status: 'closed',
    });
    expect((await recipientOf(recipients[1].id)).status).toBe('expired');
    const closes = await prisma.outboxEvent.findMany({
      where: { kind: 'request.expired' },
    });
    expect(closes.map((e) => e.payload)).toEqual([
      { closed: true, garageIds: [berceni.garage.id], requestId: request.id },
    ]);

    await relay(timers, 'quote.expired');
    await relay(timers, 'request.expired');

    expect(await bells('QUOTE_EXPIRED', driverId)).toHaveLength(1);
    expect(await bells('REQUEST_EXPIRED', driverId)).toHaveLength(1);
    expect(await bells('REQUEST_EXPIRED', berceni.owner)).toHaveLength(1);
    expect(await messages('REQUEST_EXPIRED', dinamo.owner)).toEqual([]);
  });

  it('keeps it waiting while the request holds a booking awaiting confirmation', async () => {
    const [dinamo, berceni] = [
      await staffed('Dinamo'),
      await staffed('Berceni'),
    ];
    const { request } = await sent([dinamo, berceni]);
    const held = await quoted(request.id, dinamo);
    const chosen = await quoted(
      request.id,
      berceni,
      new Date(QUOTE_EXPIRES.getTime() + HOUR),
      'accepted',
    );
    await world.booking(chosen.id, 'awaiting_confirmation');
    await prisma.quoteRequest.update({
      data: { status: 'booked' },
      where: { id: request.id },
    });
    const { timers } = await start(QUOTE_EXPIRES);
    const before = {
      held: await counted('quote_held', false),
      swept: await counted('quote_held', true),
    };

    await fire(timers, 'quote-expiry', held.id);
    await timers.timers.sweep(QUOTE_EXPIRES);

    expect((await quoteOf(held.id)).status).toBe('waiting');
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(await counted('quote_held', false)).toBe(before.held + 1);
    expect(await counted('quote_held', true)).toBe(before.swept);
  });

  it.each(['withdrawn', 'lost', 'expired'] as const)(
    'changes nothing and tells nobody for a quote already %s',
    async (status) => {
      const dinamo = await staffed('Dinamo');
      const { request } = await sent([dinamo]);
      const quote = await quoted(request.id, dinamo, QUOTE_EXPIRES, status);
      const { timers } = await start(QUOTE_EXPIRES);

      await fire(timers, 'quote-expiry', quote.id);
      await timers.timers.sweep(QUOTE_EXPIRES);

      expect((await quoteOf(quote.id)).status).toBe(status);
      expect(
        await prisma.outboxEvent.count({ where: { kind: 'quote.expired' } }),
      ).toBe(0);
    },
  );

  it('does nothing before its time', async () => {
    const dinamo = await staffed('Dinamo');
    const { request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo);
    const { timers } = await start(new Date(QUOTE_EXPIRES.getTime() - MINUTE));

    await fire(timers, 'quote-expiry', quote.id);

    expect((await quoteOf(quote.id)).status).toBe('waiting');
  });

  it.each(['booking_lapsed', 'held_past_validity'])(
    'tells nobody of a quote the booking lapse expired (%s)',
    async (reason) => {
      const dinamo = await staffed('Dinamo');
      const { driverId, request } = await sent([dinamo]);
      const quote = await quoted(request.id, dinamo, QUOTE_EXPIRES, 'expired');
      const { timers } = await start(QUOTE_EXPIRES);

      await timers.onEvent(
        event('quote.expired', {
          quoteId: quote.id,
          reason,
          requestId: request.id,
        }),
      );

      expect(await messages('QUOTE_EXPIRED', driverId)).toEqual([]);
      expect(await messages('QUOTE_EXPIRED', dinamo.owner)).toEqual([]);
    },
  );

  it('closes the request once when its two last quotes expire in one sweep', async () => {
    const [dinamo, berceni] = [
      await staffed('Dinamo'),
      await staffed('Berceni'),
    ];
    const { request } = await sent([dinamo, berceni]);
    const first = await quoted(request.id, dinamo);
    const second = await quoted(request.id, berceni);
    const now = new Date(QUOTE_EXPIRES.getTime() + 10 * MINUTE);
    const { timers } = await start(now);
    const before = await counted('quote_expired', true);

    await timers.timers.sweep(now);
    await timers.timers.sweep(now);
    await fire(timers, 'quote-expiry', first.id);

    expect((await quoteOf(first.id)).status).toBe('expired');
    expect((await quoteOf(second.id)).status).toBe('expired');
    expect((await requestOf(request.id)).status).toBe('closed');
    expect(
      await prisma.outboxEvent.count({ where: { kind: 'request.expired' } }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({ where: { kind: 'quote.expired' } }),
    ).toBe(2);
    expect(await counted('quote_expired', true)).toBe(before + 2);
  });
});

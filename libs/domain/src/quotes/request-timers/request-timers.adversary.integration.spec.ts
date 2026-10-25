import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job, Queue } from 'bullmq';

import { REQUEST_TIMERS_QUEUE, RequestTimers } from './request-timers';
import { RequestTimersModule } from './request-timers.module';
import { serialDatabase } from '../../auth/serial-db.testing';
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
import { quotesWorld } from '../quotes.testing';

const redisUrl = redisUrlFor(13);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const jobs = new Queue(REQUEST_TIMERS_QUEUE, { connection: { url: redisUrl } });

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

// @traces 1257-FR-001 1257-FR-002 1257-FR-010
describe('reminders under hostile timing and state', () => {
  it('sends the day-2 reminder at exactly its time and not one millisecond before', async () => {
    const dinamo = await staffed('Dinamo');
    const { recipients, request } = await sent([dinamo]);
    const { at, timers } = await start(new Date(DAY2.getTime() - 1));

    await fire(timers, 'request-reminder-2', request.id);
    expect((await recipientOf(recipients[0].id)).remindedDay2At).toBeNull();

    at(DAY2);
    await fire(timers, 'request-reminder-2', request.id);
    expect((await recipientOf(recipients[0].id)).remindedDay2At).toEqual(DAY2);
  });

  it('sends the day-5 reminder one millisecond before the request expires', async () => {
    const dinamo = await staffed('Dinamo');
    const { recipients, request } = await sent([dinamo]);
    const { timers } = await start(new Date(EXPIRES.getTime() - 1));

    await fire(timers, 'request-reminder-5', request.id);

    expect((await recipientOf(recipients[0].id)).remindedDay5At).not.toBeNull();
    expect(await bells('REQUEST_REMINDER', dinamo.owner)).toHaveLength(1);
  });

  it('reminds a garage of a request that is quoted by another garage', async () => {
    const [dinamo, berceni] = [
      await staffed('Dinamo'),
      await staffed('Berceni'),
    ];
    const { request } = await sent([dinamo, berceni]);
    await quoted(request.id, dinamo);
    const { timers } = await start(DAY2);

    await fire(timers, 'request-reminder-2', request.id);

    expect(await bells('REQUEST_REMINDER', berceni.owner)).toHaveLength(1);
    expect(await messages('REQUEST_REMINDER', dinamo.owner)).toEqual([]);
  });

  it.each(['declined', 'expired', 'quoted'] as const)(
    'never reminds a recipient that is %s',
    async (status) => {
      const dinamo = await staffed('Dinamo');
      const { request } = await sent([]);
      const row = await world.recipient(
        request.id,
        dinamo.garage.id,
        status,
        status === 'declined' ? dinamo.owner : undefined,
      );
      const { timers } = await start(DAY5);

      await fire(timers, 'request-reminder-2', request.id);
      await fire(timers, 'request-reminder-5', request.id);
      await timers.timers.sweep(DAY5);

      expect(await messages('REQUEST_REMINDER')).toEqual([]);
      const after = await recipientOf(row.id);
      expect(after.remindedDay2At).toBeNull();
      expect(after.remindedDay5At).toBeNull();
    },
  );

  it('sends the day-5 reminder to a garage that already had day 2, and the day-2 one only once', async () => {
    const dinamo = await staffed('Dinamo');
    const { recipients, request } = await sent([dinamo]);
    const { at, timers } = await start(DAY2);
    await fire(timers, 'request-reminder-2', request.id);
    at(DAY5);

    await fire(timers, 'request-reminder-2', request.id);
    await fire(timers, 'request-reminder-5', request.id);
    await timers.timers.sweep(DAY5);

    const row = await recipientOf(recipients[0].id);
    expect(row.remindedDay2At).toEqual(DAY2);
    expect(row.remindedDay5At).toEqual(DAY5);
    expect(await bells('REQUEST_REMINDER', dinamo.owner)).toHaveLength(2);
  });

  it('sends one reminder per person when the same timer fires twice at once', async () => {
    const dinamo = await staffed('Dinamo');
    const { request } = await sent([dinamo]);
    const { timers } = await start(DAY2);

    await Promise.all([
      fire(timers, 'request-reminder-2', request.id),
      fire(timers, 'request-reminder-2', request.id),
      timers.timers.sweep(DAY2),
    ]);

    expect(await bells('REQUEST_REMINDER', dinamo.owner)).toHaveLength(1);
    expect(await bells('REQUEST_REMINDER', dinamo.desk)).toHaveLength(1);
  });

  it('reminds the unmuted receptionist when only the owner muted new requests', async () => {
    const dinamo = await staffed('Dinamo');
    const { request } = await sent([dinamo]);
    await muteRequests(dinamo.owner, dinamo.garage.id);
    const { timers } = await start(DAY2);

    await fire(timers, 'request-reminder-2', request.id);

    const outside = (id: string) =>
      messages('REQUEST_REMINDER', id).then((all) =>
        all.filter((m) => m.channel === 'email'),
      );
    expect(await outside(dinamo.owner)).toEqual([]);
    expect(await outside(dinamo.desk)).toHaveLength(1);
  });

  it('survives a reminder for a garage with no staff at all and still marks the day', async () => {
    const garage = await world.garage('Empty');
    const { request } = await sent([]);
    const row = await world.recipient(request.id, garage.id);
    const { timers } = await start(DAY2);

    await fire(timers, 'request-reminder-2', request.id);

    expect((await recipientOf(row.id)).remindedDay2At).toEqual(DAY2);
    expect(await messages('REQUEST_REMINDER')).toEqual([]);
  });

  it.each([
    'request-reminder-2',
    'request-reminder-5',
    'request-expiry',
    'quote-expiry',
  ])('ignores a %s timer for an id that does not exist', async (name) => {
    const { timers } = await start(EXPIRES);

    await expect(fire(timers, name, randomUUID())).resolves.toBeUndefined();
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('runs a sweep over an empty database without writing or sending anything', async () => {
    const { timers } = await start(EXPIRES);

    await timers.timers.sweep(EXPIRES);

    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('fires the reminders at Bucharest calendar days across the clock change', async () => {
    // Fri 23 Oct 2026 10:00 EEST (07:00Z); the clocks go back on Sun 25 Oct.
    const createdAt = new Date('2026-10-23T07:00:00Z');
    const dinamo = await staffed('Dinamo');
    const { event: created, request } = await sent([dinamo], { createdAt });
    const { timers } = await start(createdAt);

    await timers.onEvent(created);

    const set = await delays();
    expect(set[`request-reminder-2-${request.id}`]).toBe(
      new Date('2026-10-25T08:00:00Z').getTime() - createdAt.getTime(),
    );
    expect(set[`request-reminder-5-${request.id}`]).toBe(
      new Date('2026-10-28T08:00:00Z').getTime() - createdAt.getTime(),
    );
  });
});

// @traces 1257-FR-010 1257-FR-011
describe('setting timers from malformed or stale events', () => {
  it('sets no timer for a request that is already closed', async () => {
    const { event: created } = await sent([await staffed('Dinamo')], {
      status: 'closed',
    });
    const { timers } = await start(CREATED);

    await timers.onEvent(created);

    expect(await delays()).toEqual({});
  });

  it('sets no timer when request.created names a request that does not exist', async () => {
    const { timers } = await start(CREATED);

    await expect(
      timers.onEvent(event('request.created', { requestId: randomUUID() })),
    ).resolves.toBeUndefined();
    expect(await delays()).toEqual({});
  });

  it('sets no timer for a quote that is no longer waiting', async () => {
    const dinamo = await staffed('Dinamo');
    const { driverId, request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo, QUOTE_EXPIRES, 'withdrawn');
    const { timers } = await start(CREATED);

    await timers.onEvent(
      event('quote.sent', {
        driverId,
        garageId: dinamo.garage.id,
        quoteId: quote.id,
        requestId: request.id,
      }),
    );

    expect(await delays()).toEqual({});
  });

  it('ignores an event kind it was not given', async () => {
    const { timers } = await start(CREATED);

    await expect(
      timers.onEvent(event('garage.deleted', { requestId: randomUUID() })),
    ).resolves.toBeUndefined();
    expect(await delays()).toEqual({});
  });

  it('keeps the request’s expiry and clears the reminders when a quote is accepted, twice in a row', async () => {
    const dinamo = await staffed('Dinamo');
    const { event: created, request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo);
    const { timers } = await start(CREATED);
    await timers.onEvent(created);
    const accepted = event('quote.accepted', {
      bookingId: randomUUID(),
      quoteId: quote.id,
      requestId: request.id,
    });

    await timers.onEvent(accepted);
    await timers.onEvent(accepted);

    expect(Object.keys(await delays())).toEqual([
      `request-expiry-${request.id}`,
    ]);
  });
});

// @traces 1257-FR-004 1257-FR-005 1257-FR-010
describe('request expiry under hostile state', () => {
  it('does nothing one millisecond before the request expires and acts at the instant', async () => {
    const dinamo = await staffed('Dinamo');
    const { recipients, request } = await sent([dinamo]);
    const { at, timers } = await start(new Date(EXPIRES.getTime() - 1));

    await fire(timers, 'request-expiry', request.id);
    await timers.timers.sweep(new Date(EXPIRES.getTime() - 1));
    expect((await recipientOf(recipients[0].id)).status).toBe('waiting');

    at(EXPIRES);
    await fire(timers, 'request-expiry', request.id);
    expect((await recipientOf(recipients[0].id)).status).toBe('expired');
  });

  it.each(['booked', 'in_work', 'done', 'closed'] as const)(
    'leaves a %s request and its waiting recipient alone',
    async (status) => {
      const dinamo = await staffed('Dinamo');
      const { recipients, request } = await sent([dinamo], { status });
      const { timers } = await start(EXPIRES);

      await fire(timers, 'request-expiry', request.id);
      await timers.timers.sweep(EXPIRES);

      expect((await recipientOf(recipients[0].id)).status).toBe('waiting');
      expect((await requestOf(request.id)).status).toBe(status);
      expect(await prisma.outboxEvent.count()).toBe(0);
      expect(await prisma.notification.count()).toBe(0);
    },
  );

  it('keeps the quoted and declined recipients as they were and expires only the waiting one', async () => {
    const [a, b, c] = [
      await staffed('A'),
      await staffed('B'),
      await staffed('C'),
    ];
    const { request } = await sent([a]);
    await quoted(request.id, b);
    const declined = await world.recipient(
      request.id,
      c.garage.id,
      'declined',
      c.owner,
    );
    const [waiting] = await prisma.requestRecipient.findMany({
      where: { garageId: a.garage.id },
    });
    const { timers } = await start(EXPIRES);

    await fire(timers, 'request-expiry', request.id);

    expect((await recipientOf(waiting.id)).status).toBe('expired');
    expect((await recipientOf(declined.id)).status).toBe('declined');
    const quotedRow = await prisma.requestRecipient.findFirstOrThrow({
      where: { garageId: b.garage.id },
    });
    expect(quotedRow.status).toBe('quoted');
    expect((await requestOf(request.id)).status).toBe('quoted');
  });

  it('closes once and tells each side once when the timer fires three times at once', async () => {
    const dinamo = await staffed('Dinamo');
    const { driverId, request } = await sent([dinamo]);
    const { timers } = await start(EXPIRES);

    await Promise.all([
      fire(timers, 'request-expiry', request.id),
      fire(timers, 'request-expiry', request.id),
      timers.timers.sweep(EXPIRES),
    ]);
    await relay(timers, 'request.expired');
    await relay(timers, 'request.expired');

    expect(
      await prisma.outboxEvent.count({ where: { kind: 'request.expired' } }),
    ).toBe(1);
    expect(await bells('REQUEST_EXPIRED', driverId)).toHaveLength(1);
    expect(await bells('REQUEST_EXPIRED', dinamo.owner)).toHaveLength(1);
  });

  it('closes a request with no recipients at all', async () => {
    const { request } = await sent([]);
    const { timers } = await start(EXPIRES);

    await fire(timers, 'request-expiry', request.id);

    expect(await requestOf(request.id)).toMatchObject({
      closedReason: 'expired',
      status: 'closed',
    });
  });

  it('expires thirty waiting garages without staff in one run and closes the request', async () => {
    const { request } = await sent([]);
    for (let i = 0; i < 30; i++) {
      const garage = await world.garage(`G${i}`);
      await world.recipient(request.id, garage.id);
    }
    const { timers } = await start(EXPIRES);

    await fire(timers, 'request-expiry', request.id);

    expect(
      await prisma.requestRecipient.count({
        where: { requestId: request.id, status: 'expired' },
      }),
    ).toBe(30);
    const [event] = await prisma.outboxEvent.findMany({
      where: { kind: 'request.expired' },
    });
    expect((event.payload as { garageIds: string[] }).garageIds).toHaveLength(
      30,
    );
  });

  it('records no request.expired event for a quoted request with nobody waiting and a quote still open', async () => {
    const dinamo = await staffed('Dinamo');
    const { request } = await sent([dinamo]);
    await quoted(request.id, dinamo);
    const { timers } = await start(EXPIRES);

    await fire(timers, 'request-expiry', request.id);

    expect(
      await prisma.outboxEvent.count({ where: { kind: 'request.expired' } }),
    ).toBe(0);
    expect((await requestOf(request.id)).status).toBe('quoted');
  });

  it('does not tell the garage that muted REQUEST_EXPIRED outside the app but writes its bell', async () => {
    const dinamo = await staffed('Dinamo');
    const { request } = await sent([dinamo]);
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: dinamo.owner,
        channel,
        enabled: false,
        garageId: dinamo.garage.id,
        type: 'REQUEST_EXPIRED',
      })),
    });
    const { timers } = await start(EXPIRES);

    await fire(timers, 'request-expiry', request.id);
    await relay(timers, 'request.expired');

    const all = await messages('REQUEST_EXPIRED', dinamo.owner);
    expect(all.filter((m) => m.channel !== 'in_app')).toEqual([]);
    expect(all.filter((m) => m.channel === 'in_app')).toHaveLength(1);
  });
});

// @traces 1257-FR-006 1257-FR-007 1257-FR-008
describe('quote expiry under hostile state', () => {
  it('acts at the instant and not one millisecond before', async () => {
    const dinamo = await staffed('Dinamo');
    const { request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo);
    const { at, timers } = await start(new Date(QUOTE_EXPIRES.getTime() - 1));

    await fire(timers, 'quote-expiry', quote.id);
    expect((await quoteOf(quote.id)).status).toBe('waiting');

    at(QUOTE_EXPIRES);
    await fire(timers, 'quote-expiry', quote.id);
    expect((await quoteOf(quote.id)).status).toBe('expired');
    const [expired] = await prisma.outboxEvent.findMany({
      where: { kind: 'quote.expired' },
    });
    expect(expired.payload).toMatchObject({ reason: 'time' });
  });

  it.each(['lapsed', 'cancelled', 'completed'] as const)(
    'expires a waiting quote when the other quote’s booking is %s',
    async (bookingStatus) => {
      const [dinamo, berceni] = [
        await staffed('Dinamo'),
        await staffed('Berceni'),
      ];
      const { request } = await sent([dinamo, berceni]);
      const open = await quoted(request.id, dinamo);
      const other = await quoted(request.id, berceni, QUOTE_EXPIRES, 'lost');
      await world.booking(other.id, bookingStatus);
      const { timers } = await start(QUOTE_EXPIRES);

      await fire(timers, 'quote-expiry', open.id);

      expect((await quoteOf(open.id)).status).toBe('expired');
    },
  );

  it('leaves a waiting quote on a booked request waiting and tells nobody', async () => {
    const [dinamo, berceni] = [
      await staffed('Dinamo'),
      await staffed('Berceni'),
    ];
    const { driverId, request } = await sent([dinamo, berceni]);
    const held = await quoted(request.id, dinamo);
    const chosen = await quoted(request.id, berceni, QUOTE_EXPIRES, 'accepted');
    await world.booking(chosen.id, 'awaiting_confirmation');
    await prisma.quoteRequest.update({
      data: { status: 'booked' },
      where: { id: request.id },
    });
    const { timers } = await start(QUOTE_EXPIRES);

    await Promise.all([
      fire(timers, 'quote-expiry', held.id),
      timers.timers.sweep(QUOTE_EXPIRES),
    ]);

    expect((await quoteOf(held.id)).status).toBe('waiting');
    expect((await requestOf(request.id)).status).toBe('booked');
    expect(await messages('QUOTE_EXPIRED', driverId)).toEqual([]);
    expect(await messages('REQUEST_EXPIRED', driverId)).toEqual([]);
  });

  it('expires and tells once when the timer and the sweep race', async () => {
    const dinamo = await staffed('Dinamo');
    const { driverId, request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo);
    const { timers } = await start(QUOTE_EXPIRES);

    await Promise.all([
      fire(timers, 'quote-expiry', quote.id),
      fire(timers, 'quote-expiry', quote.id),
      timers.timers.sweep(QUOTE_EXPIRES),
    ]);
    await relay(timers, 'quote.expired');
    await relay(timers, 'request.expired');

    expect(
      await prisma.outboxEvent.count({ where: { kind: 'quote.expired' } }),
    ).toBe(1);
    expect(await bells('QUOTE_EXPIRED', driverId)).toHaveLength(1);
    expect(await bells('QUOTE_EXPIRED', dinamo.owner)).toHaveLength(1);
    expect(await bells('REQUEST_EXPIRED', driverId)).toHaveLength(1);
  });

  it('does not tell the mechanic who may answer quotes about the garage’s expired quote', async () => {
    const dinamo = await staffed('Dinamo');
    const { request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo);
    const { timers } = await start(QUOTE_EXPIRES);

    await fire(timers, 'quote-expiry', quote.id);
    await relay(timers, 'quote.expired');

    expect(await messages('QUOTE_EXPIRED', dinamo.silent)).toEqual([]);
    expect(await bells('QUOTE_EXPIRED', dinamo.desk)).toHaveLength(1);
  });

  it('honours the driver’s mute of QUOTE_EXPIRED outside the app', async () => {
    const dinamo = await staffed('Dinamo');
    const { driverId, request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo);
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: driverId,
        channel,
        enabled: false,
        type: 'QUOTE_EXPIRED',
      })),
    });
    const { timers } = await start(QUOTE_EXPIRES);

    await fire(timers, 'quote-expiry', quote.id);
    await relay(timers, 'quote.expired');

    const sentToDriver = await messages('QUOTE_EXPIRED', driverId);
    expect(sentToDriver.filter((m) => m.channel !== 'in_app')).toEqual([]);
  });

  it('closes the request exactly once when a request expiry and the last quote’s expiry run together', async () => {
    const dinamo = await staffed('Dinamo');
    const { driverId, request } = await sent([dinamo]);
    const quote = await quoted(request.id, dinamo, EXPIRES);
    const { timers } = await start(EXPIRES);

    await Promise.all([
      fire(timers, 'request-expiry', request.id),
      fire(timers, 'quote-expiry', quote.id),
    ]);
    await relay(timers, 'request.expired');

    expect(await requestOf(request.id)).toMatchObject({
      closedReason: 'expired',
      status: 'closed',
    });
    expect(await bells('REQUEST_EXPIRED', driverId)).toHaveLength(1);
    expect(await bells('REQUEST_EXPIRED', dinamo.owner)).toHaveLength(0);
  });
});

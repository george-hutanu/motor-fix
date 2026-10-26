import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException, Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job, Queue, Worker } from 'bullmq';

import {
  BOOKING_TIMERS_CONSUMER,
  BOOKING_TIMERS_QUEUE,
  BookingTimers,
} from './booking-timers';
import {
  BOOKING_TIMERS_WORKER,
  BookingTimersModule,
} from './booking-timers.module';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
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
const lapses = (request: string) =>
  counterTotal(reader, 'motorfix_booking_lapses_total', { request });

const jobs = new Queue(BOOKING_TIMERS_QUEUE, {
  connection: { url: redisUrl },
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const WEB = 'https://motorfix.test';

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
async function start(now: Date, webUrl: string | undefined = WEB) {
  app = await Test.createTestingModule({
    imports: [
      BookingTimersModule.registerWorker({
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
  const timers = app.get(BookingTimers);
  timers.now = () => now;
  return timers;
}

// Andrei's request at Atelier Dinamo (an owner, an English-speaking
// receptionist, a mechanic), its quote accepted at `acceptedAt` and the
// booking awaiting confirmation until `confirmBy`.
async function awaiting(times: {
  acceptedAt: Date;
  confirmBy: Date;
  startsAt: Date;
}) {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  const owner = await account('Dinamo Owner', ['garage']);
  const desk = await account('Dinamo Desk', ['receptionist'], {
    language: 'en',
  });
  const fixer = await account('Dinamo Fixer', ['mechanic']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: desk, garageId: garage.id, role: 'receptionist' },
    ],
  });
  await prisma.mechanic.create({
    data: {
      accountId: fixer,
      canAnswerQuotes: true,
      garageId: garage.id,
      name: 'Fixer',
    },
  });
  const request = await world.request(driverId, { status: 'booked' });
  const quote = await world.quote(request.id, garage.id, 'accepted');
  await prisma.quote.update({
    data: { acceptedAt: times.acceptedAt, slot: times.startsAt },
    where: { id: quote.id },
  });
  const booking = await prisma.booking.create({
    data: {
      confirmBy: times.confirmBy,
      driverId,
      durationMinutes: 90,
      garageId: garage.id,
      quoteId: quote.id,
      requestId: request.id,
      startsAt: times.startsAt,
      status: 'awaiting_confirmation',
    },
  });
  const event = {
    data: {
      id: '77',
      kind: 'quote.accepted',
      payload: {
        bookingId: booking.id,
        from: 'waiting',
        historyShared: false,
        quoteId: quote.id,
        requestId: request.id,
        to: 'accepted',
      },
      subjectId: quote.id,
    },
  };
  return {
    booking,
    desk,
    driverId,
    event,
    fixer,
    garage,
    owner,
    quote,
    request,
  };
}

const delays = async () =>
  Object.fromEntries(
    (await jobs.getJobs(['delayed', 'waiting'])).map((j) => [
      j.id,
      j.opts.delay,
    ]),
  );

const fire = (timers: BookingTimers, name: string, id: string) =>
  timers.timers.handle({ data: { id }, name } as Job<{ id?: string }>);

// @traces 389-FR-010
describe('setting the booking’s timers', () => {
  it('relays quote.accepted and booking.confirmed to its own queue', () => {
    expect(BOOKING_TIMERS_CONSUMER).toMatchObject({
      kinds: ['quote.accepted', 'booking.confirmed'],
      queue: 'booking-timers',
    });
  });

  it('sets both reminders and the lapse for a slot days away (Monday for Thursday)', async () => {
    const acceptedAt = new Date('2026-11-09T08:00:00Z');
    const { booking, event } = await awaiting({
      acceptedAt,
      confirmBy: new Date(acceptedAt.getTime() + 24 * HOUR),
      startsAt: new Date('2026-11-12T08:00:00Z'),
    });
    const timers = await start(acceptedAt);

    await timers.onEvent(event);

    expect(await delays()).toEqual({
      [`booking-confirm-reminder-12h-${booking.id}`]: 12 * HOUR,
      [`booking-confirm-reminder-2h-${booking.id}`]: 22 * HOUR,
      [`booking-lapse-${booking.id}`]: 24 * HOUR,
    });
  });

  it('skips the 12-hour reminder for a slot the same day (Monday for Monday)', async () => {
    const acceptedAt = new Date('2026-11-09T07:00:00Z');
    const startsAt = new Date('2026-11-09T15:00:00Z');
    const { booking, event } = await awaiting({
      acceptedAt,
      confirmBy: startsAt,
      startsAt,
    });
    const timers = await start(acceptedAt);

    await timers.onEvent(event);

    expect(await delays()).toEqual({
      [`booking-confirm-reminder-2h-${booking.id}`]: 6 * HOUR,
      [`booking-lapse-${booking.id}`]: 8 * HOUR,
    });
  });

  it('sets only the lapse for a slot under two hours away', async () => {
    const acceptedAt = new Date('2026-11-09T07:00:00Z');
    const startsAt = new Date(acceptedAt.getTime() + 90 * MINUTE);
    const { booking, event } = await awaiting({
      acceptedAt,
      confirmBy: startsAt,
      startsAt,
    });
    const timers = await start(acceptedAt);

    await timers.onEvent(event);

    expect(await delays()).toEqual({
      [`booking-lapse-${booking.id}`]: 90 * MINUTE,
    });
  });

  it('replaces the timers, not doubling them, when the event comes again', async () => {
    const acceptedAt = new Date('2026-11-09T08:00:00Z');
    const { event } = await awaiting({
      acceptedAt,
      confirmBy: new Date(acceptedAt.getTime() + 24 * HOUR),
      startsAt: new Date('2026-11-12T08:00:00Z'),
    });
    const timers = await start(acceptedAt);

    await timers.onEvent(event);
    await timers.onEvent(event);

    expect(await jobs.getJobs(['delayed', 'waiting'])).toHaveLength(3);
  });

  it('clears all three when the booking is confirmed', async () => {
    const acceptedAt = new Date('2026-11-09T08:00:00Z');
    const { booking, event, quote, request } = await awaiting({
      acceptedAt,
      confirmBy: new Date(acceptedAt.getTime() + 24 * HOUR),
      startsAt: new Date('2026-11-12T08:00:00Z'),
    });
    const timers = await start(acceptedAt);
    await timers.onEvent(event);

    await timers.onEvent({
      data: {
        id: '78',
        kind: 'booking.confirmed',
        payload: {
          bookingId: booking.id,
          quoteId: quote.id,
          requestId: request.id,
        },
        subjectId: booking.id,
      },
    });

    expect(await jobs.getJobs(['delayed', 'waiting'])).toEqual([]);
  });
});

// @traces 389-FR-011
describe('reminding the garage to confirm', () => {
  const acceptedAt = new Date('2026-11-09T08:00:00Z');
  const times = {
    acceptedAt,
    confirmBy: new Date(acceptedAt.getTime() + 24 * HOUR),
    startsAt: new Date('2026-11-12T08:00:00Z'),
  };
  // 22:00 in Bucharest, inside quiet hours.
  const TWELVE = new Date(acceptedAt.getTime() + 12 * HOUR);

  const reminders = (accountId?: string) =>
    prisma.notification.findMany({
      where: {
        fallbackOf: null,
        kind: 'BOOKING_CONFIRM_REMINDER',
        ...(accountId && { accountId }),
      },
    });

  it('tells each owner and receptionist once, never a mechanic, and holds nothing for the night', async () => {
    const { booking, desk, fixer, owner } = await awaiting(times);
    const timers = await start(TWELVE);

    await fire(timers, 'booking-confirm-reminder-12h', booking.id);
    await fire(timers, 'booking-confirm-reminder-12h', booking.id);

    for (const person of [owner, desk]) {
      const bells = (await reminders(person)).filter(
        (m) => m.channel === 'in_app',
      );
      expect(bells).toHaveLength(1);
      expect(bells[0].params).toMatchObject({
        car: 'Mini Cooper S',
        driver: 'Andrei M.',
        left: 12,
        slot: times.startsAt.toISOString(),
      });
    }
    expect(await reminders(fixer)).toEqual([]);
    expect((await reminders()).filter((m) => m.status === 'held')).toEqual([]);
  });

  it('sends the two-hour reminder apart from the twelve-hour one', async () => {
    const { booking, owner } = await awaiting(times);
    const timers = await start(TWELVE);
    await fire(timers, 'booking-confirm-reminder-12h', booking.id);
    timers.now = () => new Date(times.confirmBy.getTime() - 2 * HOUR);

    await fire(timers, 'booking-confirm-reminder-2h', booking.id);

    const bells = (await reminders(owner)).filter(
      (m) => m.channel === 'in_app',
    );
    expect(
      bells.map((m) => (m.params as { left: number }).left).sort(),
    ).toEqual([12, 2]);
  });

  it('says the time really left when confirm-by comes before a day has passed', async () => {
    const soon = {
      acceptedAt,
      confirmBy: new Date(acceptedAt.getTime() + 13 * HOUR),
      startsAt: new Date(acceptedAt.getTime() + 13 * HOUR),
    };
    const { booking, owner } = await awaiting(soon);
    const timers = await start(TWELVE);

    await fire(timers, 'booking-confirm-reminder-12h', booking.id);

    const [bell] = (await reminders(owner)).filter(
      (m) => m.channel === 'in_app',
    );
    expect(bell.params).toMatchObject({ left: 1 });
  });

  it('sends no reminder without the web address for its link', async () => {
    const { booking } = await awaiting(times);
    const timers = await start(TWELVE, '');

    await fire(timers, 'booking-confirm-reminder-12h', booking.id);

    expect(await reminders()).toEqual([]);
  });

  // @traces 1258-driver-cancel-FR-012
  it.each(['confirmed', 'cancelled'] as const)(
    'tells nobody once the booking is %s',
    async (status) => {
      const { booking } = await awaiting(times);
      await prisma.booking.update({
        data: {
          status,
          ...(status === 'confirmed' && { confirmedAt: acceptedAt }),
          ...(status === 'cancelled' && {
            cancelledAt: acceptedAt,
            cancelledBySide: 'driver',
            cancelReason: 'plans_changed',
          }),
        },
        where: { id: booking.id },
      });
      const timers = await start(TWELVE);

      await fire(timers, 'booking-confirm-reminder-12h', booking.id);

      expect(await reminders()).toEqual([]);
    },
  );

  it('tells nobody once confirm-by has passed', async () => {
    const { booking } = await awaiting(times);
    const timers = await start(new Date(times.confirmBy.getTime() + MINUTE));

    await fire(timers, 'booking-confirm-reminder-2h', booking.id);

    expect(await reminders()).toEqual([]);
  });
});

// @traces 389-FR-012
describe('lapsing an unconfirmed booking', () => {
  // A day ago, its hour to confirm past a minute ago.
  async function overdue(other: { expiresAt: Date } | null) {
    const now = new Date();
    const made = await awaiting({
      acceptedAt: new Date(now.getTime() - 24 * HOUR),
      confirmBy: new Date(now.getTime() - MINUTE),
      startsAt: new Date(now.getTime() + 48 * HOUR),
    });
    const rival = other
      ? await world.quote(
          made.request.id,
          (await world.garage('Service Militari')).id,
        )
      : null;
    if (rival && other) {
      await prisma.quote.update({
        data: { expiresAt: other.expiresAt },
        where: { id: rival.id },
      });
    }
    return { ...made, now, rival };
  }

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

  const accept = (driverId: string, quoteId: string) =>
    new AcceptService(prisma, new AuditService(), outbox).accept(
      driverActor(driverId),
      quoteId,
      randomUUID(),
      {},
    );

  it('reopens the request while another quote is still valid, and that quote can be accepted', async () => {
    const { booking, driverId, now, quote, request, rival } = await overdue({
      expiresAt: new Date(Date.now() + 3 * 24 * HOUR),
    });
    const timers = await start(now);
    const before = await lapses('quoted');

    await fire(timers, 'booking-lapse', booking.id);

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe('lapsed');
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }))
        .status,
    ).toBe('expired');
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: rival?.id } }))
        .status,
    ).toBe('waiting');
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('quoted');
    expect(await lapses('quoted')).toBe(before + 1);
    const events = await prisma.outboxEvent.findMany({
      orderBy: { kind: 'asc' },
    });
    expect(events.map((e) => [e.kind, e.payload])).toEqual(
      expect.arrayContaining([
        [
          'booking.lapsed',
          { bookingId: booking.id, quoteId: quote.id, requestId: request.id },
        ],
        [
          'quote.expired',
          expect.objectContaining({
            bookingId: booking.id,
            quoteId: quote.id,
            reason: 'booking_lapsed',
            requestId: request.id,
          }),
        ],
      ]),
    );

    const again = await accept(driverId, rival?.id ?? '');
    expect(again.booking.status).toBe('awaiting_confirmation');
  });

  it('closes the request when no quote is left, expiring the one held past its validity', async () => {
    const { booking, driverId, now, request, rival } = await overdue({
      expiresAt: new Date(Date.now() - HOUR),
    });
    const timers = await start(now);
    const before = await lapses('closed');

    await fire(timers, 'booking-lapse', booking.id);

    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: rival?.id } }))
        .status,
    ).toBe('expired');
    expect(
      await prisma.quoteRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).toMatchObject({ closedReason: 'booking_lapsed', status: 'closed' });
    expect(await lapses('closed')).toBe(before + 1);
    const held = await prisma.outboxEvent.findMany({
      where: { kind: 'quote.expired', subjectId: rival?.id },
    });
    expect(held.map((e) => e.payload)).toEqual([
      expect.objectContaining({ reason: 'held_past_validity' }),
    ]);

    const refused = await accept(driverId, rival?.id ?? '').catch((e) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(409);
    expect((refused as HttpException).getResponse()).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'expired',
    });
  });

  it('leaves the request’s recipients as they were', async () => {
    const { booking, now, request } = await overdue(null);
    const waiting = await world.recipient(
      request.id,
      (await world.garage('Auto Berceni')).id,
    );
    const timers = await start(now);

    await fire(timers, 'booking-lapse', booking.id);

    expect(
      (
        await prisma.requestRecipient.findUniqueOrThrow({
          where: { id: waiting.id },
        })
      ).status,
    ).toBe('waiting');
  });

  it('does nothing for a booking confirmed before its timer fired', async () => {
    const { booking, now } = await overdue(null);
    await prisma.booking.update({
      data: { confirmedAt: now, status: 'confirmed' },
      where: { id: booking.id },
    });
    const timers = await start(now);

    await fire(timers, 'booking-lapse', booking.id);

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe('confirmed');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  // @traces 1258-driver-cancel-FR-012
  it('does nothing for a booking the driver cancelled before its timer fired', async () => {
    const { booking, driverId, now, request } = await overdue(null);
    await prisma.booking.update({
      data: {
        cancelledAt: now,
        cancelledBy: driverId,
        cancelledBySide: 'driver',
        cancelReason: 'plans_changed',
        status: 'cancelled',
      },
      where: { id: booking.id },
    });
    await prisma.quoteRequest.update({
      data: {
        closedAt: now,
        closedReason: 'booking_cancelled',
        status: 'closed',
      },
      where: { id: request.id },
    });
    const timers = await start(now);

    await fire(timers, 'booking-lapse', booking.id);

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe('cancelled');
    expect(
      (
        await prisma.quoteRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).closedReason,
    ).toBe('booking_cancelled');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('does nothing before confirm-by', async () => {
    const { booking, now } = await overdue(null);
    const timers = await start(new Date(now.getTime() - 2 * MINUTE));

    await fire(timers, 'booking-lapse', booking.id);

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe('awaiting_confirmation');
  });

  it('still lapses, with a worker on its queue, when the web address is missing', async () => {
    const { booking, now } = await overdue(null);
    const timers = await start(now, '');

    expect(app?.get(BOOKING_TIMERS_WORKER)).toBeInstanceOf(Worker);
    await fire(timers, 'booking-lapse', booking.id);

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe('lapsed');
  });

  it('lapses a booking whose timer was lost once, from the sweep', async () => {
    const { booking, now } = await overdue(null);
    const timers = await start(now);

    await timers.timers.sweep(now);
    await timers.timers.sweep(now);

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe('lapsed');
    expect(
      await prisma.outboxEvent.count({ where: { kind: 'booking.lapsed' } }),
    ).toBe(1);
  });
});

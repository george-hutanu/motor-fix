import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  BOOKING_CANCELLED_CONSUMER,
  BookingCancelledFanOut,
} from './booking-cancelled.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { NotificationsModule } from '../notifications.module';
import { NotificationsService } from '../notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(9);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

// 23:00 in Bucharest, inside quiet hours.
const NIGHT = new Date('2026-10-09T20:00:00Z');

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
});

async function start() {
  app = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        push: null,
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  app.get(NotificationsService).now = () => NIGHT;
  return app.get(BookingCancelledFanOut);
}

// Andrei's confirmed booking at Atelier Dinamo, cancelled when his account
// closed, with Fixer on it when `mechanic` has an account.
async function cancelled(
  options: {
    mechanicAccount?: boolean;
    reason?: string;
    side?: 'driver';
    late?: boolean;
    note?: string;
  } = {},
) {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  const owner = await account('Dinamo Owner', ['garage']);
  const desk = await account('Dinamo Desk', ['receptionist']);
  const fixer = await account('Dinamo Fixer', ['mechanic']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: desk, garageId: garage.id, role: 'receptionist' },
    ],
  });
  const mechanic = await prisma.mechanic.create({
    data: {
      accountId: (options.mechanicAccount ?? true) ? fixer : null,
      canAnswerQuotes: false,
      garageId: garage.id,
      name: 'Fixer',
    },
  });
  const { booking, request } = await world.chain(driverId, garage.id, {
    booking: 'cancelled',
    request: 'closed',
  });
  await prisma.booking.update({
    data: {
      mechanicId: mechanic.id,
      ...(options.side && {
        cancelledBy: driverId,
        cancelNote: options.note ?? null,
        lateCancellation: options.late ?? false,
      }),
    },
    where: { id: booking.id },
  });
  const payload = {
    bookingId: booking.id,
    garageId: garage.id,
    reason: options.reason ?? 'driver_account_closed',
    requestId: request.id,
    ...(options.side && { late: options.late ?? false, side: options.side }),
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, `garage:${garage.id}`],
      kind: 'booking.cancelled',
      payload,
      subjectId: booking.id,
    },
  });
  const job = {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload,
      subjectId: booking.id,
    },
  };
  return { desk, driverId, fixer, job, owner };
}

const bells = (accountId: string) =>
  prisma.notification.findMany({
    where: {
      accountId,
      channel: 'in_app',
      fallbackOf: null,
      kind: 'BOOKING_CANCELLED',
    },
  });

// @traces 428-FR-010 428-FR-011
describe('telling the garage a closed account’s booking is cancelled', () => {
  it('listens to booking.cancelled on its own queue', () => {
    expect(BOOKING_CANCELLED_CONSUMER.kinds).toEqual(['booking.cancelled']);
    expect(BOOKING_CANCELLED_CONSUMER.queue).toBe('booking-cancelled');
  });

  it('tells each owner, receptionist and the booking’s mechanic once, and not the driver', async () => {
    const { desk, driverId, fixer, job, owner } = await cancelled();
    const fanOut = await start();

    await fanOut.handle(job);

    for (const person of [owner, desk, fixer]) {
      const mine = await bells(person);
      expect(mine).toHaveLength(1);
      expect(mine[0].params).toMatchObject({ reason: 'driver_account_closed' });
    }
    expect(await bells(driverId)).toEqual([]);
  });

  it('tells the garage but no mechanic when the booking’s mechanic has no account', async () => {
    const { fixer, job, owner } = await cancelled({ mechanicAccount: false });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await bells(owner)).toHaveLength(1);
    expect(await bells(fixer)).toEqual([]);
  });

  it('leaves a booking cancelled for another reason to its own story', async () => {
    const { job } = await cancelled({ reason: 'plans_changed' });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(
      await prisma.notification.count({ where: { kind: 'BOOKING_CANCELLED' } }),
    ).toBe(0);
  });

  it('holds nothing for the night', async () => {
    const { job } = await cancelled();
    const fanOut = await start();

    await fanOut.handle(job);

    expect(
      await prisma.notification.count({
        where: { kind: 'BOOKING_CANCELLED', status: 'held' },
      }),
    ).toBe(0);
  });

  // @traces 428-FR-007
  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await cancelled();
    const fanOut = await start();
    const count = () =>
      prisma.notification.count({ where: { kind: 'BOOKING_CANCELLED' } });

    await fanOut.handle(job);
    const once = await count();
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect(await count()).toBe(once);
  });
});

// @traces 1258-driver-cancel-FR-005
describe('telling the garage the driver cancelled the booking', () => {
  const byDriver = (over: { late?: boolean; note?: string } = {}) =>
    cancelled({ reason: 'plans_changed', side: 'driver', ...over });

  it('tells each owner, receptionist and the booking’s mechanic once, and not the driver', async () => {
    const { desk, driverId, fixer, job, owner } = await byDriver();
    const fanOut = await start();

    await fanOut.handle(job);

    for (const person of [owner, desk, fixer]) {
      const mine = await bells(person);
      expect(mine).toHaveLength(1);
      expect(mine[0].params).toMatchObject({
        reason: 'plans_changed',
        variant: 'driver',
      });
    }
    expect(await bells(driverId)).toEqual([]);
  });

  it('tells no mechanic when the booking’s mechanic has no account', async () => {
    const { fixer, job, owner } = await cancelled({
      mechanicAccount: false,
      reason: 'other',
      side: 'driver',
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await bells(owner)).toHaveLength(1);
    expect(await bells(fixer)).toEqual([]);
  });

  it('picks the late text for a late cancel and carries the note from the booking', async () => {
    const { job, owner } = await byDriver({
      late: true,
      note: 'Am găsit un loc mai aproape',
    });
    const fanOut = await start();

    await fanOut.handle(job);

    const [bell] = await bells(owner);
    expect(bell.params).toMatchObject({
      note: 'Am găsit un loc mai aproape',
      variant: 'driver_late',
    });
  });

  it('holds nothing for the night', async () => {
    const { job } = await byDriver();
    const fanOut = await start();

    await fanOut.handle(job);

    expect(
      await prisma.notification.count({
        where: { kind: 'BOOKING_CANCELLED', status: 'held' },
      }),
    ).toBe(0);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await byDriver();
    const fanOut = await start();
    const count = () =>
      prisma.notification.count({ where: { kind: 'BOOKING_CANCELLED' } });

    await fanOut.handle(job);
    const once = await count();
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect(await count()).toBe(once);
  });
});

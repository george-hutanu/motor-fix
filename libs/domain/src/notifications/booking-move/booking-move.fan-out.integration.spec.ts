import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  BOOKING_MOVE_CONSUMER,
  BookingMoveFanOut,
} from './booking-move.fan-out';
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

const NOON = new Date('2026-10-09T11:00:00Z');
// 23:10 in Bucharest.
const NIGHT = new Date('2026-10-09T20:10:00Z');
const HOUR = 3_600_000;

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

async function start(now = NOON) {
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
  app.get(NotificationsService).now = () => now;
  return { fanOut: app.get(BookingMoveFanOut) };
}

// Andrei's confirmed booking at Atelier Dinamo with a move he asked; the
// garage has an owner, a receptionist and a mechanic.
async function asked() {
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
    data: { accountId: fixer, garageId: garage.id, name: 'Fixer' },
  });
  const { booking } = await world.chain(driverId, garage.id, {
    booking: 'confirmed',
  });
  const move = await prisma.bookingMove.create({
    data: {
      bookingId: booking.id,
      idempotencyKey: 'k-1',
      lapsesAt: new Date(booking.startsAt.getTime() - 2 * HOUR),
      newStartsAt: new Date(booking.startsAt.getTime() + 72 * HOUR),
      proposedBy: driverId,
      proposedBySide: 'driver',
    },
  });
  const job = async (kind: 'booking.move_proposed' | 'booking.move_lapsed') => {
    const payload =
      kind === 'booking.move_proposed'
        ? {
            bookingId: booking.id,
            by: 'driver',
            moveId: move.id,
            newStartsAt: move.newStartsAt.toISOString(),
          }
        : { bookingId: booking.id, moveId: move.id };
    const event = await prisma.outboxEvent.create({
      data: {
        audience: [`account:${driverId}`, `garage:${garage.id}`],
        kind,
        payload,
        subjectId: move.id,
      },
    });
    return {
      data: { id: String(event.id), kind, payload, subjectId: move.id },
    };
  };
  return { booking, desk, driverId, fixer, job, move, owner };
}

const bells = (accountId: string, kind: string) =>
  prisma.notification.findMany({
    where: { accountId, channel: 'in_app', fallbackOf: null, kind },
  });

describe('the consumer of the move events', () => {
  it('listens to the asked and the lapsed move on its own queue', () => {
    expect([...BOOKING_MOVE_CONSUMER.kinds].sort()).toEqual([
      'booking.move_lapsed',
      'booking.move_proposed',
    ]);
    expect(BOOKING_MOVE_CONSUMER.queue).toBe('booking-move');
  });
});

// @traces 184-FR-005
describe('telling the garage a driver asks to move', () => {
  it('tells each owner and receptionist once, naming the driver, car and both times', async () => {
    const { booking, desk, fixer, job, move, owner } = await asked();
    const { fanOut } = await start();
    const event = await job('booking.move_proposed');

    await fanOut.handle(event);
    await fanOut.handle(event);

    for (const person of [owner, desk]) {
      const sent = await bells(person, 'BOOKING_MOVE_REQUESTED');
      expect(sent).toHaveLength(1);
      expect(sent[0].params).toMatchObject({
        car: 'Mini Cooper S',
        driver: 'Andrei M.',
        slot: booking.startsAt.toISOString(),
        to: move.newStartsAt.toISOString(),
      });
    }
    expect(await bells(fixer, 'BOOKING_MOVE_REQUESTED')).toEqual([]);
  });
});

// @traces 184-FR-007
// @traces 184-FR-014
describe('telling the driver a move lapsed', () => {
  it('tells the driver once with the booking’s unchanged time', async () => {
    const { booking, driverId, job, owner } = await asked();
    const { fanOut } = await start();
    const event = await job('booking.move_lapsed');

    await fanOut.handle(event);
    await fanOut.handle(event);

    const sent = await bells(driverId, 'BOOKING_MOVE_LAPSED');
    expect(sent).toHaveLength(1);
    expect(sent[0].params).toMatchObject({
      garage: 'Atelier Dinamo',
      slot: booking.startsAt.toISOString(),
    });
    expect(await bells(owner, 'BOOKING_MOVE_LAPSED')).toEqual([]);
  });

  it('sends the e-mail at once in quiet hours', async () => {
    const { driverId, job } = await asked();
    const { fanOut } = await start(NIGHT);

    await fanOut.handle(await job('booking.move_lapsed'));

    const email = await prisma.notification.findFirst({
      where: {
        accountId: driverId,
        channel: 'email',
        kind: 'BOOKING_MOVE_LAPSED',
      },
    });
    expect(email).toMatchObject({ sendAfter: null });
  });

  it('tells nobody when the booking is no longer confirmed', async () => {
    const { booking, driverId, job } = await asked();
    await prisma.booking.update({
      data: {
        cancelledAt: new Date(),
        cancelledBySide: 'driver',
        cancelReason: 'plans_changed',
        status: 'cancelled',
      },
      where: { id: booking.id },
    });
    const { fanOut } = await start();

    await fanOut.handle(await job('booking.move_lapsed'));

    expect(await bells(driverId, 'BOOKING_MOVE_LAPSED')).toEqual([]);
  });

  it('tells nobody when the driver’s account is closed', async () => {
    const { driverId, job } = await asked();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: driverId },
    });
    const { fanOut } = await start();

    await fanOut.handle(await job('booking.move_lapsed'));

    expect(
      await prisma.notification.count({
        where: { accountId: driverId, kind: 'BOOKING_MOVE_LAPSED' },
      }),
    ).toBe(0);
  });
});

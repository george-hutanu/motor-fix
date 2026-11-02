import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { BookingCancelledFanOut } from './booking-cancelled.fan-out';
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
import { bellText } from '../templates';

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

const rows = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'BOOKING_CANCELLED' },
  });

// @traces 1258-driver-cancel-FR-005
// @traces 1258-driver-cancel-FR-006
describe('telling the garage of a booking the driver cancelled', () => {
  it('tells owner, receptionist and mechanic once each, never the driver, and builds nothing twice', async () => {
    const { desk, driverId, fixer, job, owner } = await cancelled({
      late: false,
      reason: 'plans_changed',
      side: 'driver',
    });
    const fanOut = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    for (const person of [owner, desk, fixer]) {
      const mine = await rows(person);
      expect(mine.length).toBeGreaterThan(0);
      expect(new Set(mine.map((n) => n.channel)).size).toBe(mine.length);
    }
    expect(await rows(driverId)).toEqual([]);
  });

  it('tells the owner and receptionist but no mechanic when the mechanic has no account', async () => {
    const { desk, fixer, job, owner } = await cancelled({
      mechanicAccount: false,
      reason: 'other',
      side: 'driver',
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect((await rows(owner)).length).toBeGreaterThan(0);
    expect((await rows(desk)).length).toBeGreaterThan(0);
    expect(await rows(fixer)).toEqual([]);
  });

  it('picks the late variant only for a late cancel', async () => {
    const late = await cancelled({
      late: true,
      reason: 'other',
      side: 'driver',
    });
    const fanOut = await start();
    await fanOut.handle(late.job);
    const lateRows = await rows(late.owner);
    expect(lateRows.length).toBeGreaterThan(0);
    for (const row of lateRows) {
      expect(JSON.stringify(row.params)).toContain('driver_late');
    }
  });

  it('carries the note whole, as text, in the bell text it builds', async () => {
    const note = 'SECRET-NOTE-<b>x</b>';
    const { job, owner } = await cancelled({
      note,
      reason: 'other',
      side: 'driver',
    });
    const fanOut = await start();

    await fanOut.handle(job);

    const mine = await rows(owner);
    expect(mine.length).toBeGreaterThan(0);
    const bell = mine.filter((n) => n.channel === 'in_app');
    expect(bell.length).toBeGreaterThan(0);
    for (const row of bell) {
      const params = row.params as Record<string, unknown>;
      for (const lang of ['ro', 'en']) {
        const text = bellText('BOOKING_CANCELLED', lang, params);
        expect(text).toContain('Andrei M.');
        expect(text).toContain(note);
      }
    }
  });

  it('builds the messages for a cancel without a note and for an unknown reason read as other', async () => {
    const { job, owner } = await cancelled({
      reason: 'garage_suspended',
      side: 'driver',
    });
    const fanOut = await start();

    await expect(fanOut.handle(job)).resolves.toBeUndefined();

    expect((await rows(owner)).length).toBeGreaterThan(0);
  });

  it('ends normally and tells nobody when the booking row is gone', async () => {
    const { job } = await cancelled({ reason: 'other', side: 'driver' });
    await prisma.$executeRawUnsafe('SET session_replication_role = replica');
    await prisma.booking.deleteMany();
    await prisma.$executeRawUnsafe('SET session_replication_role = DEFAULT');
    const fanOut = await start();

    await expect(fanOut.handle(job)).resolves.toBeUndefined();

    expect(
      await prisma.notification.count({ where: { kind: 'BOOKING_CANCELLED' } }),
    ).toBe(0);
  });

  it('leaves a garage-side cancel with a driver reason to its own story', async () => {
    const { job } = await cancelled({ reason: 'plans_changed' });
    const fanOut = await start();

    await fanOut.handle({
      data: { ...job.data, payload: { ...job.data.payload, side: 'garage' } },
    });

    expect(
      await prisma.notification.count({ where: { kind: 'BOOKING_CANCELLED' } }),
    ).toBe(0);
  });
});

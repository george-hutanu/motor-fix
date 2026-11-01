import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  BOOKING_CONFIRMED_CONSUMER,
  BookingConfirmedFanOut,
} from './booking-confirmed.fan-out';
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

const redisUrl = redisUrlFor(4);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

// Noon in Bucharest, so nothing waits for the morning.
const NOON = new Date('2026-10-09T09:00:00Z');

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
  app.get(NotificationsService).now = () => NOON;
  const notifications = app.get(NotificationsService);
  return {
    fanOut: app.get(BookingConfirmedFanOut),
    notify: vi.spyOn(notifications, 'notify'),
  };
}

// Andrei's booking at Atelier Dinamo, confirmed, and the event the confirm
// wrote.
async function confirmed() {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  const owner = await account('Dinamo Owner', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const request = await world.request(driverId, { status: 'booked' });
  const quote = await world.quote(request.id, garage.id, 'accepted');
  const booking = await world.booking(quote.id, 'confirmed');
  await prisma.booking.update({
    data: { startsAt: new Date('2026-10-16T06:00:00Z') },
    where: { id: booking.id },
  });
  const payload = {
    bookingId: booking.id,
    durationMinutes: 90,
    lift: null,
    mechanicId: null,
    quoteId: quote.id,
    requestId: request.id,
    startsAt: '2026-10-16T06:00:00.000Z',
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, `garage:${garage.id}`],
      kind: 'booking.confirmed',
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
  return { booking, driverId, job, owner, request };
}

const built = () =>
  prisma.notification.findMany({
    where: { fallbackOf: null, kind: 'BOOKING_CONFIRMED' },
  });

// @traces 389-FR-013
describe('telling the driver the garage confirmed the booking', () => {
  it('listens to booking.confirmed on its own queue', () => {
    expect(BOOKING_CONFIRMED_CONSUMER.kinds).toEqual(['booking.confirmed']);
    expect(BOOKING_CONFIRMED_CONSUMER.queue).toBe('booking-confirmed');
  });

  it('builds BOOKING_CONFIRMED for the driver only, naming the garage and the slot', async () => {
    const { booking, driverId, job, request } = await confirmed();
    const { fanOut, notify } = await start();

    await fanOut.handle(job);

    const messages = await built();
    expect(messages.length).toBeGreaterThan(0);
    expect(new Set(messages.map((m) => m.accountId))).toEqual(
      new Set([driverId]),
    );
    const bell = messages.find((m) => m.channel === 'in_app');
    expect(bell?.subjectId).toBe(booking.id);
    expect(bell?.params).toMatchObject({
      garage: 'Atelier Dinamo',
      slot: '2026-10-16T06:00:00.000Z',
    });
    // The bell keeps no link; the message in flight opens the driver's request.
    expect(notify.mock.calls[0][0].params).toMatchObject({
      link: `https://motorfix.test/app/driver/requests/${request.id}`,
    });
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await confirmed();
    const { fanOut } = await start();

    await fanOut.handle(job);
    const once = (await built()).length;
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect(await built()).toHaveLength(once);
  });

  it('tells nobody once the booking is cancelled', async () => {
    const { booking, job } = await confirmed();
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

    await fanOut.handle(job);

    expect(await built()).toEqual([]);
  });
});

// @traces 277-FR-006
describe('the booking confirmed message among the stage messages', () => {
  it('is sent outside although the driver turned every channel off', async () => {
    const { driverId, job } = await confirmed();
    for (const channel of ['email', 'push', 'whatsapp'] as const) {
      await prisma.notificationPreference.create({
        data: {
          accountId: driverId,
          channel,
          enabled: false,
          type: 'BOOKING_CONFIRMED',
        },
      });
    }
    const { fanOut } = await start();

    await fanOut.handle(job);

    const messages = await built();
    expect(
      messages.filter((m) => m.channel !== 'in_app').length,
    ).toBeGreaterThan(0);
    expect(messages.map((m) => m.channel)).not.toContain('sms');
  });
});

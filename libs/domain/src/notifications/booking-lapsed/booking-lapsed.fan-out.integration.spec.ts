import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  BOOKING_LAPSED_CONSUMER,
  BookingLapsedFanOut,
} from './booking-lapsed.fan-out';
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
    fanOut: app.get(BookingLapsedFanOut),
    notify: vi.spyOn(notifications, 'notify'),
  };
}

// Andrei's booking at Atelier Dinamo, lapsed unconfirmed, and its event. The
// garage has an owner, a receptionist and a mechanic.
async function lapsed() {
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
  const request = await world.request(driverId, { status: 'quoted' });
  const quote = await world.quote(request.id, garage.id, 'expired');
  const booking = await world.booking(quote.id, 'lapsed');
  const payload = {
    bookingId: booking.id,
    quoteId: quote.id,
    requestId: request.id,
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, `garage:${garage.id}`],
      kind: 'booking.lapsed',
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
  return { booking, desk, driverId, fixer, job, owner, request };
}

const bells = async (accountId: string) =>
  prisma.notification.findMany({
    where: {
      accountId,
      channel: 'in_app',
      fallbackOf: null,
      kind: 'BOOKING_LAPSED',
    },
  });

// @traces 389-FR-013
describe('telling both sides a booking lapsed unconfirmed', () => {
  it('listens to booking.lapsed on its own queue', () => {
    expect(BOOKING_LAPSED_CONSUMER.kinds).toEqual(['booking.lapsed']);
    expect(BOOKING_LAPSED_CONSUMER.queue).toBe('booking-lapsed');
  });

  it('tells the driver to choose again and each owner and receptionist whose booking it was', async () => {
    const { desk, driverId, job, owner, request } = await lapsed();
    const { fanOut, notify } = await start();

    await fanOut.handle(job);

    const [driver] = await bells(driverId);
    expect(driver.params).toMatchObject({
      garage: 'Atelier Dinamo',
      side: 'driver',
    });
    // The bell keeps no link; the message in flight opens each side's list.
    const links = Object.fromEntries(
      notify.mock.calls.map(([input]) => [
        input.params?.['side'],
        input.params?.['link'],
      ]),
    );
    expect(links).toEqual({
      driver: `https://motorfix.test/app/driver/requests/${request.id}`,
      garage: 'https://motorfix.test/app/garage/requests',
    });
    for (const person of [owner, desk]) {
      const [bell] = await bells(person);
      expect(bell.params).toMatchObject({
        car: 'Mini Cooper S',
        driver: 'Andrei M.',
        side: 'garage',
      });
    }
  });

  it('tells no mechanic', async () => {
    const { fixer, job } = await lapsed();
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await bells(fixer)).toEqual([]);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await lapsed();
    const { fanOut } = await start();

    await fanOut.handle(job);
    const count = () =>
      prisma.notification.count({ where: { kind: 'BOOKING_LAPSED' } });
    const once = await count();
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect(await count()).toBe(once);
  });
});

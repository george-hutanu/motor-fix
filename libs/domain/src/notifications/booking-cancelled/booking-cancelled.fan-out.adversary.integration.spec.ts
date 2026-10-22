import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { BookingCancelledFanOut } from './booking-cancelled.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { NotificationsModule } from '../notifications.module';
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

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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
  return app.get(BookingCancelledFanOut);
}

async function owned(name: string) {
  const garage = await world.garage(name);
  const owner = await account(`${name} Owner`, ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  return { garage, owner };
}

async function cancelledAt(reason: unknown) {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const dinamo = await owned('Atelier Dinamo');
  const nord = await owned('Service Nord');
  const { booking, request } = await world.chain(driverId, dinamo.garage.id, {
    booking: 'cancelled',
    request: 'closed',
  });
  const payload = {
    bookingId: booking.id,
    garageId: dinamo.garage.id,
    reason,
    requestId: request.id,
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`],
      kind: 'booking.cancelled',
      payload: payload as object,
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
  return { dinamo, driverId, job, nord };
}

const told = (where: object = {}) =>
  prisma.notification.count({ where: { kind: 'BOOKING_CANCELLED', ...where } });

// @traces 428-FR-010
describe('who hears about a booking cancelled with the account', () => {
  it('tells the booking’s garage and not another garage', async () => {
    const { dinamo, job, nord } = await cancelledAt('driver_account_closed');
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await told({ accountId: dinamo.owner })).toBeGreaterThan(0);
    expect(await told({ accountId: nord.owner })).toBe(0);
  });

  it.each([null, undefined, '', 'DRIVER_ACCOUNT_CLOSED'])(
    'sends nothing when the reason is %p',
    async (reason) => {
      const { job } = await cancelledAt(reason);
      const fanOut = await start();

      await fanOut.handle(job);

      expect(await told()).toBe(0);
    },
  );

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await cancelledAt('driver_account_closed');
    const fanOut = await start();
    await fanOut.handle(job);
    const once = await told();

    await fanOut.handle(job);

    expect(await told()).toBe(once);
  });
});

// @traces 428-FR-010
describe('a cancelled booking that changed meanwhile', () => {
  it('ends normally and never tells the driver when the booking row is gone', async () => {
    const { driverId, job } = await cancelledAt('driver_account_closed');
    await prisma.booking.delete({ where: { id: job.data.subjectId } });
    const fanOut = await start();

    await expect(fanOut.handle(job)).resolves.toBeUndefined();

    expect(await told({ accountId: driverId })).toBe(0);
  });

  it('tells a mechanic who is also the garage owner once', async () => {
    const { dinamo, job } = await cancelledAt('driver_account_closed');
    const mechanic = await prisma.mechanic.create({
      data: {
        accountId: dinamo.owner,
        canAnswerQuotes: false,
        garageId: dinamo.garage.id,
        name: 'Fixer',
      },
    });
    await prisma.booking.update({
      data: { mechanicId: mechanic.id },
      where: { id: job.data.subjectId },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(
      await told({
        accountId: dinamo.owner,
        channel: 'in_app',
        fallbackOf: null,
      }),
    ).toBe(1);
  });
});

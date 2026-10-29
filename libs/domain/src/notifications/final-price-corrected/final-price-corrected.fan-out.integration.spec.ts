import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  FINAL_PRICE_CORRECTED_CONSUMER,
  FinalPriceCorrectedFanOut,
} from './final-price-corrected.fan-out';
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
  app.get(NotificationsService).now = () => NOON;
  const notifications = app.get(NotificationsService);
  return {
    fanOut: app.get(FinalPriceCorrectedFanOut),
    notify: jest.spyOn(notifications, 'notify'),
  };
}

// Andrei's job at Garaj Nordic, handed over at 1.250 lei and corrected to
// 1.150 lei, and the event the correction wrote.
async function corrected() {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Garaj Nordic');
  const owner = await account('Nordic Owner', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const { booking, request } = await world.chain(driverId, garage.id, {
    booking: 'completed',
    request: 'done',
  });
  const created = await world.job(booking.id, 'done');
  // The row holds a later price, so the message must take the event's.
  const job = await prisma.job.update({
    data: { finalPriceBani: 118_000, handedOverAt: new Date() },
    where: { id: created.id },
  });
  const payload = { by: owner, newBani: 115_000, oldBani: 125_000 };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, `garage:${garage.id}`],
      kind: 'job.final_price_corrected',
      payload,
      subjectId: job.id,
    },
  });
  const queued = {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload,
      subjectId: job.id,
    },
  };
  return { driverId, event, job, owner, queued, request };
}

const built = () =>
  prisma.notification.findMany({
    where: { fallbackOf: null, kind: 'FINAL_PRICE_CORRECTED' },
  });

// @traces 406-FR-007 406-FR-011
describe('telling the driver the garage corrected the final price', () => {
  it('listens to job.final_price_corrected on its own queue', () => {
    expect(FINAL_PRICE_CORRECTED_CONSUMER.kinds).toEqual([
      'job.final_price_corrected',
    ]);
    expect(FINAL_PRICE_CORRECTED_CONSUMER.queue).toBe('final-price-corrected');
  });

  it('builds FINAL_PRICE_CORRECTED for the driver only, with the garage and the event’s price', async () => {
    const { driverId, job, queued, request } = await corrected();
    const { fanOut, notify } = await start();

    await fanOut.handle(queued);

    const messages = await built();
    expect(messages.length).toBeGreaterThan(0);
    expect(new Set(messages.map((m) => m.accountId))).toEqual(
      new Set([driverId]),
    );
    const bell = messages.find((m) => m.channel === 'in_app');
    expect(bell?.subjectId).toBe(job.id);
    expect(bell?.params).toMatchObject({
      garage: 'Garaj Nordic',
      price: 115_000,
    });
    expect(notify.mock.calls[0][0]).toMatchObject({
      eventId: queued.data.id,
      kind: 'FINAL_PRICE_CORRECTED',
      params: {
        link: `https://motorfix.test/app/driver/requests/${request.id}`,
      },
    });
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { queued } = await corrected();
    const { fanOut } = await start();

    await fanOut.handle(queued);
    const once = (await built()).length;
    await fanOut.handle(queued);

    expect(once).toBeGreaterThan(0);
    expect(await built()).toHaveLength(once);
  });

  it('builds nothing, and does not throw, for a job that is gone', async () => {
    const { queued } = await corrected();
    const { fanOut, notify } = await start();
    const gone = {
      data: {
        ...queued.data,
        subjectId: '00000000-0000-4000-8000-000000000000',
      },
    };

    await expect(fanOut.handle(gone)).resolves.toBeUndefined();

    expect(notify).not.toHaveBeenCalled();
    expect(await built()).toHaveLength(0);
  });

  it('keeps the bell for a driver who turned the e-mail off', async () => {
    const { driverId, job, queued } = await corrected();
    await prisma.notificationPreference.create({
      data: {
        accountId: driverId,
        channel: 'email',
        enabled: false,
        type: 'FINAL_PRICE_CORRECTED',
      },
    });
    const { fanOut } = await start();

    await fanOut.handle(queued);

    const channels = (await built()).map((m) => m.channel);
    expect(channels).toContain('in_app');
    expect(channels).not.toContain('email');
    expect(
      await prisma.job.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ finalPriceBani: 118_000 });
  });
});

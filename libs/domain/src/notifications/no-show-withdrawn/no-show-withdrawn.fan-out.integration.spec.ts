import type { OutsideChannel } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  NO_SHOW_WITHDRAWN_CONSUMER,
  NoShowWithdrawnFanOut,
} from './no-show-withdrawn.fan-out';
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

// 23:30 in Bucharest, inside quiet hours.
const NIGHT = new Date('2026-10-09T20:30:00Z');

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
  const notifications = app.get(NotificationsService);
  notifications.now = () => NIGHT;
  return {
    fanOut: app.get(NoShowWithdrawnFanOut),
    notify: jest.spyOn(notifications, 'notify'),
  };
}

// Andrei's booking at Volt Auto, whose no-show the owner withdrew, and its
// event. The garage's owner must hear nothing back.
async function withdrawn() {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const owner = await account('Volt Owner', ['garage']);
  const garage = await world.garage('Volt Auto');
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const request = await world.request(driverId, { status: 'booked' });
  const quote = await world.quote(request.id, garage.id, 'accepted');
  const booking = await world.booking(quote.id, 'confirmed');
  const payload = {
    bookingId: booking.id,
    garageId: garage.id,
    requestId: request.id,
    withdrawnBy: owner,
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, `garage:${garage.id}`],
      kind: 'booking.no_show_withdrawn',
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

const built = (accountId?: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'NO_SHOW_WITHDRAWN' },
  });

// @traces 1259-FR-008
describe('telling the driver a no-show was withdrawn', () => {
  it('listens to booking.no_show_withdrawn on its own queue', () => {
    expect(NO_SHOW_WITHDRAWN_CONSUMER.kinds).toEqual([
      'booking.no_show_withdrawn',
    ]);
    expect(NO_SHOW_WITHDRAWN_CONSUMER.queue).toBe('no-show-withdrawn');
  });

  it('tells the driver alone, naming the garage and the slot, opening the request', async () => {
    const { booking, driverId, job, owner, request } = await withdrawn();
    const { fanOut, notify } = await start();

    await fanOut.handle(job);

    const bell = (await built(driverId)).find((m) => m.channel === 'in_app');
    expect(bell?.params).toMatchObject({
      garage: 'Volt Auto',
      slot: booking.startsAt.toISOString(),
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].params?.['link']).toBe(
      `https://motorfix.test/app/driver/requests/${request.id}`,
    );
    expect(await built(owner)).toEqual([]);
  });

  it('goes at once at night, never held for the morning', async () => {
    const { driverId, job } = await withdrawn();
    const { fanOut } = await start();

    await fanOut.handle(job);

    const rows = (await built(driverId)).filter((m) => m.channel !== 'in_app');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).not.toBe('held');
      expect(row.sendAfter).toBeNull();
    }
  });

  it('keeps only the bell when the driver muted every outside channel', async () => {
    const { driverId, job } = await withdrawn();
    for (const channel of ['email', 'push', 'whatsapp'] as OutsideChannel[]) {
      await prisma.notificationPreference.create({
        data: {
          accountId: driverId,
          channel,
          enabled: false,
          type: 'NO_SHOW_WITHDRAWN',
        },
      });
    }
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect((await built(driverId)).map((m) => m.channel)).toEqual(['in_app']);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await withdrawn();
    const { fanOut } = await start();

    await fanOut.handle(job);
    const once = (await built()).length;
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect((await built()).length).toBe(once);
  });
});

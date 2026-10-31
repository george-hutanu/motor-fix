import type { OutsideChannel } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  NO_SHOW_CONSUMER,
  type NoShowEvent,
  NoShowFanOut,
} from './no-show.fan-out';
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
    fanOut: app.get(NoShowFanOut),
    notify: jest.spyOn(notifications, 'notify'),
  };
}

// Andrei's booking at Volt Auto, recorded as a no-show by the owner, and its
// event. The garage's owner must hear nothing back.
async function recorded() {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const owner = await account('Volt Owner', ['garage']);
  const garage = await world.garage('Volt Auto');
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const request = await world.request(driverId, { status: 'closed' });
  const quote = await world.quote(request.id, garage.id, 'accepted');
  const booking = await world.booking(quote.id, 'no_show');
  const payload = {
    bookingId: booking.id,
    garageId: garage.id,
    recordedBy: owner,
    requestId: request.id,
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, `garage:${garage.id}`],
      kind: 'booking.no_show_recorded',
      payload,
      subjectId: booking.id,
    },
  });
  const job = {
    data: {
      id: String(event.id),
      kind: event.kind as NoShowEvent['kind'],
      payload,
      subjectId: booking.id,
    },
  };
  return { booking, driverId, job, owner, request };
}

const builtRecorded = (accountId?: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'NO_SHOW_RECORDED' },
  });

// @traces 1259-FR-007
describe('telling the driver a no-show was recorded', () => {
  it('listens to both no-show kinds on one queue', () => {
    expect(NO_SHOW_CONSUMER.kinds).toEqual([
      'booking.no_show_recorded',
      'booking.no_show_withdrawn',
    ]);
    expect(NO_SHOW_CONSUMER.queue).toBe('no-show');
  });

  it('tells the driver alone, naming the garage and the slot, opening the request', async () => {
    const { booking, driverId, job, owner, request } = await recorded();
    const { fanOut, notify } = await start();

    await fanOut.handle(job);

    const bell = (await builtRecorded(driverId)).find(
      (m) => m.channel === 'in_app',
    );
    expect(bell?.params).toMatchObject({
      garage: 'Volt Auto',
      slot: booking.startsAt.toISOString(),
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].params?.['link']).toBe(
      `https://motorfix.test/app/driver/requests/${request.id}`,
    );
    expect(await builtRecorded(owner)).toEqual([]);
  });

  it('goes at once at night, never held for the morning', async () => {
    const { driverId, job } = await recorded();
    const { fanOut } = await start();

    await fanOut.handle(job);

    const rows = (await builtRecorded(driverId)).filter(
      (m) => m.channel !== 'in_app',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).not.toBe('held');
      expect(row.sendAfter).toBeNull();
    }
  });

  it('keeps only the bell when the driver muted every outside channel', async () => {
    const { driverId, job } = await recorded();
    for (const channel of ['email', 'push', 'whatsapp'] as OutsideChannel[]) {
      await prisma.notificationPreference.create({
        data: {
          accountId: driverId,
          channel,
          enabled: false,
          type: 'NO_SHOW_RECORDED',
        },
      });
    }
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect((await builtRecorded(driverId)).map((m) => m.channel)).toEqual([
      'in_app',
    ]);
  });

  it('builds nothing for a driver whose account is closed', async () => {
    const { driverId, job } = await recorded();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: driverId },
    });
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await builtRecorded(driverId)).toEqual([]);
  });

  it('tells nothing once the no-show was withdrawn before the event came', async () => {
    const { booking, job } = await recorded();
    await prisma.booking.update({
      data: { noShowAt: null, status: 'confirmed' },
      where: { id: booking.id },
    });
    const { fanOut, notify } = await start();

    await fanOut.handle(job);

    expect(notify).not.toHaveBeenCalled();
    expect(await builtRecorded()).toEqual([]);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await recorded();
    const { fanOut } = await start();

    await fanOut.handle(job);
    const once = (await builtRecorded()).length;
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect((await builtRecorded()).length).toBe(once);
  });
});

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
      kind: event.kind as NoShowEvent['kind'],
      payload,
      subjectId: booking.id,
    },
  };
  return { booking, driverId, job, owner, request };
}

const builtWithdrawn = (accountId?: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'NO_SHOW_WITHDRAWN' },
  });

// @traces 1259-FR-008
describe('telling the driver a no-show was withdrawn', () => {
  it('tells the driver alone, naming the garage and the slot, opening the request', async () => {
    const { booking, driverId, job, owner, request } = await withdrawn();
    const { fanOut, notify } = await start();

    await fanOut.handle(job);

    const bell = (await builtWithdrawn(driverId)).find(
      (m) => m.channel === 'in_app',
    );
    expect(bell?.params).toMatchObject({
      garage: 'Volt Auto',
      slot: booking.startsAt.toISOString(),
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].params?.['link']).toBe(
      `https://motorfix.test/app/driver/requests/${request.id}`,
    );
    expect(await builtWithdrawn(owner)).toEqual([]);
  });

  it('goes at once at night, never held for the morning', async () => {
    const { driverId, job } = await withdrawn();
    const { fanOut } = await start();

    await fanOut.handle(job);

    const rows = (await builtWithdrawn(driverId)).filter(
      (m) => m.channel !== 'in_app',
    );
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

    expect((await builtWithdrawn(driverId)).map((m) => m.channel)).toEqual([
      'in_app',
    ]);
  });

  it('tells nothing once the booking was recorded a no-show again before the event came', async () => {
    const { booking, job } = await withdrawn();
    await prisma.booking.update({
      data: { noShowAt: new Date(), status: 'no_show' },
      where: { id: booking.id },
    });
    const { fanOut, notify } = await start();

    await fanOut.handle(job);

    expect(notify).not.toHaveBeenCalled();
    expect(await builtWithdrawn()).toEqual([]);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await withdrawn();
    const { fanOut } = await start();

    await fanOut.handle(job);
    const once = (await builtWithdrawn()).length;
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect((await builtWithdrawn()).length).toBe(once);
  });
});

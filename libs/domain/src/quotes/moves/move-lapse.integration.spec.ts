import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import { MoveLapse } from './move-lapse';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { BookingMoveStatus } from '../../generated/prisma/enums';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import {
  DECLINE_WINDOW_CONSUMER,
  DECLINE_WINDOW_QUEUE,
  DeclineWindow,
} from '../decline-window/decline-window';
import { DeclineWindowModule } from '../decline-window/decline-window.module';
import { quotesWorld } from '../quotes.testing';

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const jobs = new Queue(DECLINE_WINDOW_QUEUE, {
  connection: { url: redisUrl },
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await jobs.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
  await jobs.obliterate({ force: true });
});

// Compiled, never started: no worker takes the queue's jobs and no sweep
// is scheduled, so each case runs the lapse itself.
async function start() {
  app = await Test.createTestingModule({
    imports: [
      DeclineWindowModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
        redisUrl,
        webUrl: 'https://motorfix.test',
      }),
    ],
  }).compile();
  return { lapse: app.get(MoveLapse), window: app.get(DeclineWindow) };
}

// A driver's confirmed booking at Atelier Dinamo and a move he asked that
// lapses at `lapsesAt`.
async function asked(
  lapsesAt = new Date(Date.now() - MINUTE),
  status: BookingMoveStatus = 'proposed',
  driver = 'Andrei Ion Marin',
) {
  const driverId = await account(driver, ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  const { booking } = await world.chain(driverId, garage.id, {
    booking: 'confirmed',
  });
  const move = await prisma.bookingMove.create({
    data: {
      bookingId: booking.id,
      decidedAt: status === 'proposed' ? null : new Date(),
      idempotencyKey: 'k-1',
      lapsesAt,
      newStartsAt: new Date(booking.startsAt.getTime() + 72 * HOUR),
      proposedBy: driverId,
      proposedBySide: 'driver',
      refuseReason: status === 'refused' ? 'other' : null,
      status,
    },
  });
  return { booking, driverId, garageId: garage.id, move };
}

const moveRow = (id: string) =>
  prisma.bookingMove.findUniqueOrThrow({ where: { id } });

// @traces 184-FR-007
describe('a move nobody decided in time', () => {
  it('lapses in one go, the booking untouched', async () => {
    const { booking, driverId, garageId, move } = await asked();
    const { lapse } = await start();

    await lapse.fire(move.id, false);

    expect(await moveRow(move.id)).toMatchObject({
      decidedAt: expect.any(Date),
      decidedBy: null,
      status: 'lapsed',
    });
    expect(
      await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }),
    ).toMatchObject({
      moveCount: booking.moveCount,
      startsAt: booking.startsAt,
      status: 'confirmed',
    });
    const [entry] = await prisma.activityLog.findMany({
      where: { field: 'move', subjectId: booking.id },
    });
    expect(entry).toMatchObject({
      actorId: null,
      actorRole: 'system',
      isKeyChange: true,
      newValue: booking.startsAt.toISOString(),
      oldValue: move.newStartsAt.toISOString(),
    });
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'booking.move_lapsed' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      bookingId: booking.id,
      moveId: move.id,
    });
    expect([...events[0].audience].sort()).toEqual(
      [`account:${driverId}`, `garage:${garageId}`].sort(),
    );
  });

  it.each(['accepted', 'refused', 'lapsed', 'cancelled'] as const)(
    'does nothing to a %s move',
    async (status) => {
      const { move } = await asked(undefined, status);
      const { lapse } = await start();

      await lapse.fire(move.id, false);

      expect((await moveRow(move.id)).status).toBe(status);
      expect(await prisma.outboxEvent.count()).toBe(0);
    },
  );

  it('does nothing for a move that no longer exists', async () => {
    const { lapse } = await start();

    await expect(
      lapse.fire('00000000-0000-4000-8000-000000000000', false),
    ).resolves.toBeUndefined();
  });

  it('lapses through the sweep a move whose timer was lost, and only once', async () => {
    const { move } = await asked();
    const later = await asked(
      new Date(Date.now() + HOUR),
      'proposed',
      'Maria Pop',
    );
    const { lapse, window } = await start();

    expect(await lapse.overdue(new Date())).toEqual([move.id]);
    await window.timers.sweep(new Date());
    await window.timers.sweep(new Date());

    expect((await moveRow(move.id)).status).toBe('lapsed');
    expect((await moveRow(later.move.id)).status).toBe('proposed');
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'booking.move_lapsed' },
      }),
    ).toBe(1);
  });
});

// @traces 184-FR-004
// @traces 184-FR-005
describe('the move’s timer', () => {
  it('is set by the asked move’s event, for when it lapses', async () => {
    const lapsesAt = new Date(Date.now() + 5 * HOUR);
    const { booking, move } = await asked(lapsesAt);
    const { lapse } = await start();
    expect(DECLINE_WINDOW_CONSUMER.kinds).toContain('booking.move_proposed');

    await lapse.onProposed({
      data: {
        id: '1',
        kind: 'booking.move_proposed',
        payload: {
          bookingId: booking.id,
          by: 'driver',
          moveId: move.id,
          newStartsAt: move.newStartsAt.toISOString(),
        },
      },
    });

    const timer = await jobs.getJob(`move-lapse-${move.id}`);
    expect(timer?.name).toBe('move-lapse');
    expect(timer?.data).toEqual({ id: move.id });
    const delay = timer?.opts.delay ?? 0;
    expect(Math.abs(delay - 5 * HOUR)).toBeLessThan(MINUTE);
  });
});

import { HttpException } from '@nestjs/common';

import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import type {
  BookingMoveStatus,
  BookingStatus,
} from '../../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../quotes.testing';
import {
  BOOKING_MOVE_MOVES,
  moveBooking,
  moveBookingMove,
} from '../transitions';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const ports = { audit: new AuditService(), events: outbox };
const HOUR = 3_600_000;

let driver: string;
let owner: string;
let garageId: string;
let key = 0;

beforeAll(async () => {
  await world.reset();
  driver = await world.account('Andrei Marin', ['driver']);
  owner = await world.account('Ion Popescu', ['garage']);
  garageId = (await world.garage('Atelier Dinamo')).id;
  await prisma.garageMember.create({
    data: { accountId: owner, garageId, role: 'owner' },
  });
});

async function proposed(status: BookingMoveStatus = 'proposed') {
  const { booking } = await world.chain(driver, garageId, {
    booking: 'confirmed',
  });
  const move = await prisma.bookingMove.create({
    data: {
      bookingId: booking.id,
      decidedAt: status === 'proposed' ? null : new Date(),
      idempotencyKey: `key-${++key}`,
      lapsesAt: new Date(Date.now() + 24 * HOUR),
      newStartsAt: new Date(booking.startsAt.getTime() + 48 * HOUR),
      proposedBy: driver,
      proposedBySide: 'driver',
      refuseReason: status === 'refused' ? 'other' : null,
      status,
    },
  });
  return { booking, move };
}

const system = { accountId: null, role: 'system' as const };

const lapse = (id: string) =>
  prisma.$transaction((tx) =>
    moveBookingMove(tx, ports, {
      actor: system,
      event: {
        audience: {
          driverAccountId: driver,
          garageId,
          mechanicId: null,
          type: 'booking',
        },
        kind: 'booking.move_lapsed',
      },
      id,
      to: 'lapsed',
    }),
  );

async function refusal(attempt: Promise<unknown>) {
  const error = await attempt.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  return {
    body: (error as HttpException).getResponse(),
    status: (error as HttpException).getStatus(),
  };
}

// @traces 184-FR-001
describe('the moves of a booking move', () => {
  it('leave proposed for any final status and nothing leaves a final one', () => {
    expect(BOOKING_MOVE_MOVES).toEqual({
      accepted: [],
      cancelled: [],
      lapsed: [],
      proposed: ['accepted', 'refused', 'lapsed', 'cancelled'],
      refused: [],
    });
  });

  it('lapses a proposed move with its decision time', async () => {
    const { move } = await proposed();

    await lapse(move.id);

    expect(
      await prisma.bookingMove.findUniqueOrThrow({ where: { id: move.id } }),
    ).toMatchObject({ decidedAt: expect.any(Date), status: 'lapsed' });
  });

  it.each(['accepted', 'refused', 'lapsed', 'cancelled'] as const)(
    'refuses to move a %s one, naming its status',
    async (status) => {
      const { move } = await proposed(status);

      const { body, status: http } = await refusal(lapse(move.id));

      expect(http).toBe(409);
      expect(body).toMatchObject({
        code: 'invalid_transition',
        currentStatus: status,
      });
    },
  );

  it('keeps one proposed move per booking', async () => {
    const { booking } = await proposed();

    await expect(
      prisma.bookingMove.create({
        data: {
          bookingId: booking.id,
          idempotencyKey: `key-${++key}`,
          lapsesAt: new Date(Date.now() + HOUR),
          newStartsAt: new Date(booking.startsAt.getTime() + HOUR),
          proposedBy: owner,
          proposedBySide: 'garage',
        },
      }),
    ).rejects.toThrow(/booking_move_one_proposed/);
  });

  it('needs a reason exactly when refused', async () => {
    const { move } = await proposed();

    await expect(
      prisma.$executeRaw`UPDATE booking_move SET status = 'refused' WHERE id = ${move.id}::uuid`,
    ).rejects.toThrow(/booking_move_refuse_reason_check/);
    await expect(
      prisma.$executeRaw`UPDATE booking_move SET refuse_reason = 'other' WHERE id = ${move.id}::uuid`,
    ).rejects.toThrow(/booking_move_refuse_reason_check/);
  });
});

// @traces 184-FR-001
describe('a booking leaving confirmed with a move waiting', () => {
  const leave = (id: string, to: BookingStatus) =>
    prisma.$transaction((tx) =>
      moveBooking(tx, ports, {
        actor: { accountId: owner, role: 'garage' as const },
        cancellation: { reason: 'parts_not_available', side: 'garage' },
        event: {
          audience: {
            driverAccountId: driver,
            garageId,
            mechanicId: null,
            type: 'booking',
          },
          kind: 'booking.cancelled',
        },
        id,
        to,
      }),
    );

  it.each(['cancelled', 'no_show', 'completed'] as const)(
    'cancels the move silently when the booking is %s',
    async (to) => {
      const { booking, move } = await proposed();

      await leave(booking.id, to);

      expect(
        await prisma.bookingMove.findUniqueOrThrow({ where: { id: move.id } }),
      ).toMatchObject({ decidedAt: expect.any(Date), status: 'cancelled' });
      expect(
        await prisma.activityLog.findMany({ where: { subjectId: move.id } }),
      ).toEqual([
        expect.objectContaining({
          newValue: 'cancelled',
          subjectType: 'booking_move',
        }),
      ]);
      expect(
        await prisma.outboxEvent.count({ where: { subjectId: move.id } }),
      ).toBe(0);
    },
  );

  it('leaves a decided move as it was', async () => {
    const { booking, move } = await proposed('refused');

    await leave(booking.id, 'cancelled');

    expect(
      await prisma.bookingMove.findUniqueOrThrow({ where: { id: move.id } }),
    ).toMatchObject({ status: 'refused' });
  });
});

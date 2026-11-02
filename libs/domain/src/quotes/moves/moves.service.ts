import type { AskBookingMoveDto, BookingMoveDto } from '@motor-fix/contracts';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';

import { lapsesAt, moveState } from './move-state';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { notFound } from '../../auth/http-refusal';
import { type Actor, requireCapability } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import {
  type BookingMove,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma/client';
import type { BookingStatus } from '../../generated/prisma/enums';
import { freeSlots } from '../../workshop/free-slots/free-slots';
import { question } from '../../workshop/free-slots/free-slots.service';
import { recordBookingMove } from '../quotes/quotes.metrics';
import { MOVE_REACH_DAYS } from '../quotes-config';
import { type MoveRefusal, moveRefused, moveTooLate } from '../refusals';

type Tx = Prisma.TransactionClient;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// The free slots never offer a start sooner than this.
const LEAD_HOURS = 2;

interface Locked {
  driverId: string;
  durationMinutes: number;
  garageId: string;
  moveCount: number;
  startsAt: Date;
  status: BookingStatus;
}

export interface MovePreview {
  garageName: string;
  newStartsAt: Date;
  startsAt: Date;
}

const REFUSAL: Record<'cutoff' | 'limit' | 'pending', MoveRefusal> = {
  cutoff: 'move_cutoff',
  limit: 'move_limit',
  pending: 'move_pending',
};

const moveOf = (move: BookingMove): BookingMoveDto => ({
  bookingId: move.bookingId,
  decidedAt: move.decidedAt?.toISOString() ?? null,
  id: move.id,
  lapsesAt: move.lapsesAt.toISOString(),
  newStartsAt: move.newStartsAt.toISOString(),
  proposedBySide: move.proposedBySide,
  refuseReason: move.refuseReason,
  status: move.status,
});

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

// The driver asks the garage to move a confirmed booking to a free start.
// The booking stays as it is until the garage answers; the asked start is
// held meanwhile, so no one else is offered it.
@Injectable()
export class MovesService {
  private readonly logger = new Logger('BookingMove');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async submit(
    actor: Actor,
    bookingId: string,
    body: AskBookingMoveDto,
    key: string,
  ): Promise<{ move: BookingMoveDto; created: boolean }> {
    try {
      return await this.prisma.$transaction((tx) =>
        this.store(tx, actor, bookingId, body, key),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The same key on another booking at once: the other call's move is
      // the answer.
      const move = await this.replayOf(this.prisma, actor.accountId, key);
      if (!move) throw error;
      return { created: false, move: moveOf(move) };
    }
  }

  // Runs in the caller's transaction: the assistant's move, once the driver
  // approves it, keyed by the approval.
  async ask(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    body: AskBookingMoveDto,
    key: string,
  ): Promise<BookingMoveDto> {
    return (await this.store(tx, actor, bookingId, body, key)).move;
  }

  // The same checks as the ask, writing nothing.
  preview(
    actor: Actor,
    bookingId: string,
    body: AskBookingMoveDto,
  ): Promise<MovePreview> {
    return this.prisma.$transaction(async (tx) => {
      const newStartsAt = new Date(body.startsAt);
      const booking = await this.judge(tx, actor, bookingId, newStartsAt);
      const garage = await tx.garage.findUniqueOrThrow({
        select: { name: true },
        where: { id: booking.garageId },
      });
      return {
        garageName: garage.name,
        newStartsAt,
        startsAt: booking.startsAt,
      };
    });
  }

  private replayOf(client: Tx, proposedBy: string, key: string) {
    return client.bookingMove.findUnique({
      where: {
        proposedBy_idempotencyKey: { idempotencyKey: key, proposedBy },
      },
    });
  }

  private async store(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    body: AskBookingMoveDto,
    key: string,
  ): Promise<{ move: BookingMoveDto; created: boolean }> {
    const replay = await this.replayOf(tx, actor.accountId, key);
    if (replay) return { created: false, move: moveOf(replay) };
    const newStartsAt = new Date(body.startsAt);
    let booking: Locked;
    try {
      booking = await this.judge(tx, actor, bookingId, newStartsAt);
    } catch (error) {
      // The same key's first call held the booking while this one waited.
      const raced = await this.replayOf(tx, actor.accountId, key);
      if (raced) return { created: false, move: moveOf(raced) };
      this.refused(error, bookingId);
      throw error;
    }
    const now = new Date();
    const move = await tx.bookingMove.create({
      data: {
        bookingId,
        idempotencyKey: key,
        lapsesAt: lapsesAt(now, booking.startsAt),
        newStartsAt,
        proposedBy: actor.accountId,
        proposedBySide: 'driver',
      },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'move',
      garageId: booking.garageId,
      newValue: newStartsAt.toISOString(),
      oldValue: booking.startsAt.toISOString(),
      subjectId: bookingId,
      subjectType: 'booking',
      ...(actor.via === 'assistant' && {
        assistantGrantId: actor.assistantGrantId,
        requestId: actor.requestId,
      }),
    });
    await this.events.record(tx, {
      audience: {
        driverAccountId: actor.accountId,
        garageId: booking.garageId,
        mechanicId: null,
        type: 'booking',
      },
      kind: 'booking.move_proposed',
      payload: {
        bookingId,
        by: 'driver',
        moveId: move.id,
        newStartsAt: newStartsAt.toISOString(),
      },
      subjectId: move.id,
    });
    recordBookingMove('asked', 'driver');
    this.logger.log(
      `booking ${bookingId} (garage ${booking.garageId}): move ${move.id} asked`,
    );
    return { created: true, move: moveOf(move) };
  }

  // Locks the booking, refuses it by the first rule it breaks, then holds
  // the garage's schedule and checks the start is still free.
  private async judge(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    newStartsAt: Date,
  ): Promise<Locked> {
    const [booking] = await tx.$queryRaw<Locked[]>`
      SELECT driver_id AS "driverId", duration_minutes AS "durationMinutes",
        garage_id AS "garageId", move_count AS "moveCount",
        starts_at AS "startsAt", status::text AS status
      FROM booking WHERE id = ${bookingId}::uuid FOR UPDATE`;
    if (booking?.driverId !== actor.accountId) throw notFound();
    requireCapability(actor, 'driver.requests');
    const [job, latest] = await Promise.all([
      tx.job.findUnique({
        select: { receivedAt: true, status: true },
        where: { bookingId },
      }),
      tx.bookingMove.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { proposedBySide: true, status: true },
        where: { bookingId },
      }),
    ]);
    const now = new Date();
    const { moveBlockedReason } = moveState(booking, job, latest, now);
    if (moveBlockedReason === 'status') {
      throw moveTooLate(actor, booking.status);
    }
    if (moveBlockedReason) {
      throw moveRefused(actor, REFUSAL[moveBlockedReason]);
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${booking.garageId}))`;
    if (!(await this.isFree(tx, bookingId, booking, newStartsAt, now))) {
      throw moveRefused(actor, 'slot_taken');
    }
    return booking;
  }

  // Whether the engine's first free start from the asked one is that start.
  private async isFree(
    tx: Tx,
    bookingId: string,
    booking: Locked,
    startsAt: Date,
    now: Date,
  ) {
    const from = now.getTime() + LEAD_HOURS * HOUR;
    const to = now.getTime() + MOVE_REACH_DAYS * DAY;
    if (startsAt.getTime() < from || startsAt.getTime() > to) return false;
    const lifting = await tx.requestJob.count({
      where: {
        jobType: { needsLift: true },
        request: { bookings: { some: { id: bookingId } } },
      },
    });
    const input = await question(tx, {
      count: 1,
      duration: booking.durationMinutes,
      earliest: startsAt,
      excludeBookingId: bookingId,
      garageId: booking.garageId,
      horizonDays: 1,
      needsLift: lifting > 0,
    });
    const [first] = freeSlots(input).slots;
    return first?.startsAt.getTime() === startsAt.getTime();
  }

  private refused(error: unknown, bookingId: string) {
    if (error instanceof HttpException && error.getStatus() === 409) {
      const { code } = error.getResponse() as { code: string };
      this.logger.warn(`booking ${bookingId}: move refused (${code})`);
    }
  }
}

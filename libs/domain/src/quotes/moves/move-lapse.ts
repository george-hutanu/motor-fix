import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { noEvents, outbox } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { NOTIFICATIONS_PRISMA } from '../../notifications/notifications.service';
import { ObjectTimers, type TimerKind } from '../../scheduler/timers';
import type { TransitionActor } from '../../transitions';
import { DECLINE_WINDOW_JOBS } from '../decline-window/decline-window';
import { recordBookingMove } from '../quotes/quotes.metrics';
import { moveBookingMove } from '../transitions';

const KIND = 'move-lapse';
const SYSTEM: TransitionActor = { accountId: null, role: 'system' };

// A job as the relay queues it: `id` is the outbox event's.
export interface MoveProposedEvent {
  id: string;
  kind: string;
  payload: { bookingId: string; moveId: string } & Record<string, unknown>;
}

interface Lapsing {
  bookingId: string;
  driverId: string;
  garageId: string;
  newStartsAt: Date;
  startsAt: Date;
}

// A move the garage did not decide by its lapse time lapses: the booking
// keeps its time and the driver is told. The asked move's event sets the
// timer; the quote-timers sweep runs one whose timer was lost. Each run
// re-reads the move under its lock, so a late or repeated timer does nothing
// once the move was decided.
@Injectable()
export class MoveLapse implements TimerKind {
  readonly name = KIND;
  private readonly logger = new Logger('MoveLapse');
  private readonly timers: ObjectTimers;
  now = () => new Date();

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(DECLINE_WINDOW_JOBS) queue: Queue,
  ) {
    this.timers = new ObjectTimers(queue, [this]);
  }

  async onProposed(job: Pick<Job<MoveProposedEvent>, 'data'>): Promise<void> {
    const move = await this.prisma.bookingMove.findUnique({
      select: { lapsesAt: true, status: true },
      where: { id: job.data.payload.moveId },
    });
    if (move?.status !== 'proposed') return;
    await this.timers.set(
      KIND,
      job.data.payload.moveId,
      move.lapsesAt,
      this.now(),
    );
  }

  async overdue(now: Date): Promise<string[]> {
    const rows = await this.prisma.bookingMove.findMany({
      orderBy: [{ lapsesAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      where: { lapsesAt: { lte: now }, status: 'proposed' },
    });
    return rows.map((row) => row.id);
  }

  async fire(id: string, sweep: boolean): Promise<void> {
    const lapsed = await this.prisma.$transaction((tx) => this.lapse(tx, id));
    if (lapsed) recordBookingMove('lapsed', 'driver');
    this.logger.log(
      `move ${id} lapse${sweep ? ' (sweep)' : ''}: ${lapsed ? 'lapsed' : 'nothing to do'}`,
    );
  }

  private async lapse(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<boolean> {
    const [move] = await tx.$queryRaw<Lapsing[]>`
      SELECT m.booking_id AS "bookingId", b.driver_id AS "driverId",
        b.garage_id AS "garageId", m.new_starts_at AS "newStartsAt",
        b.starts_at AS "startsAt"
      FROM booking_move m JOIN booking b ON b.id = m.booking_id
      WHERE m.id = ${id}::uuid AND m.status = 'proposed'
        AND m.lapses_at <= ${this.now()}
      FOR UPDATE OF m`;
    if (!move) return false;
    const audience = {
      driverAccountId: move.driverId,
      garageId: move.garageId,
      mechanicId: null,
      type: 'booking' as const,
    };
    await moveBookingMove(
      tx,
      { audit: this.audit, events: noEvents },
      {
        actor: SYSTEM,
        event: { audience, kind: 'booking.move_lapsed' },
        id,
        to: 'lapsed',
      },
    );
    await this.audit.record(tx, {
      action: 'update',
      actorId: null,
      actorRole: 'system',
      field: 'move',
      garageId: move.garageId,
      newValue: move.startsAt.toISOString(),
      oldValue: move.newStartsAt.toISOString(),
      subjectId: move.bookingId,
      subjectType: 'booking',
    });
    await outbox.record(tx, {
      audience,
      kind: 'booking.move_lapsed',
      payload: { bookingId: move.bookingId, moveId: id },
      subjectId: id,
    });
    return true;
  }
}

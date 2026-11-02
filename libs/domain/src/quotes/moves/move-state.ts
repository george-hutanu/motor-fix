import type {
  BookingMoveRefuseReason,
  BookingMoveSide,
  BookingMoveStatus,
  BookingStatus,
  JobStatus,
} from '../../generated/prisma/enums';
import { BOOKING_MAX_MOVES, MOVE_CUTOFF_HOURS } from '../quotes-config';

const HOUR = 3_600_000;
const ANSWER_WINDOW_HOURS = 24;

export type MoveBlockedReason = 'status' | 'cutoff' | 'limit' | 'pending';

interface MovingBooking {
  moveCount: number;
  startsAt: Date;
  status: BookingStatus;
}

interface MovingJob {
  receivedAt: Date | null;
  status: JobStatus;
}

interface LatestMove {
  proposedBySide: BookingMoveSide;
  status: BookingMoveStatus;
}

interface ReadMove extends LatestMove {
  decidedAt: Date | null;
  id: string;
  lapsesAt: Date;
  newStartsAt: Date;
  refuseReason: BookingMoveRefuseReason | null;
}

const latestOf = (move: ReadMove) => ({
  decidedAt: move.decidedAt?.toISOString() ?? null,
  id: move.id,
  lapsesAt: move.lapsesAt.toISOString(),
  newStartsAt: move.newStartsAt.toISOString(),
  proposedBySide: move.proposedBySide,
  refuseReason: move.refuseReason,
  status: move.status,
});

export const moveOf = (move: ReadMove & { bookingId: string }) => ({
  bookingId: move.bookingId,
  ...latestOf(move),
});

// The garage answers within a day, and never later than the cutoff before
// the booking it would move.
export const lapsesAt = (askedAt: Date, startsAt: Date) =>
  new Date(
    Math.min(
      askedAt.getTime() + ANSWER_WINDOW_HOURS * HOUR,
      startsAt.getTime() - MOVE_CUTOFF_HOURS * HOUR,
    ),
  );

function blockedBy(
  booking: MovingBooking,
  job: MovingJob | null,
  latest: LatestMove | null,
  now: Date,
): MoveBlockedReason | null {
  if (
    booking.status !== 'confirmed' ||
    (job && (job.status !== 'to_do' || job.receivedAt))
  )
    return 'status';
  if (now.getTime() >= booking.startsAt.getTime() - MOVE_CUTOFF_HOURS * HOUR)
    return 'cutoff';
  if (booking.moveCount >= BOOKING_MAX_MOVES) return 'limit';
  if (latest?.status === 'proposed') return 'pending';
  return null;
}

export function moveState(
  booking: MovingBooking,
  job: MovingJob | null,
  latest: LatestMove | null,
  now: Date,
) {
  const moveBlockedReason = blockedBy(booking, job, latest, now);
  return { canMove: moveBlockedReason === null, moveBlockedReason };
}

export function moveFieldsOf(
  booking: MovingBooking,
  job: MovingJob | null,
  latest: ReadMove | null,
  now: Date,
) {
  return {
    ...moveState(booking, job, latest, now),
    move: latest && latestOf(latest),
    moveCount: booking.moveCount,
  };
}

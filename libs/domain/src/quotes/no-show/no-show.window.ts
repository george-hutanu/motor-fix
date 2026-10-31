import type { Actor } from '../../auth/policy';
import { localDay } from '../../bucharest';

// A no-show may be withdrawn until midnight in Bucharest on the day it was
// recorded: civil days, so a daylight-saving day is no shorter or longer.
export const noShowUndoOpen = (noShowAt: Date, now: Date): boolean =>
  localDay(now) === localDay(noShowAt);

interface NoShowBooking {
  status: string;
  startsAt: Date;
  noShowAt: Date | null;
  // The booking's own mechanic's account; a mechanic may act on no other.
  mechanicAccountId: string | null;
  jobStatus: string | null;
}

// What the screens may offer a reader of the garage on this booking; the
// service decides again on the call.
export function noShowFlags(
  booking: NoShowBooking,
  actor: Pick<Actor, 'accountId' | 'role'>,
  now: Date,
) {
  const allowed =
    actor.role !== 'mechanic' || booking.mechanicAccountId === actor.accountId;
  return {
    canRecordNoShow:
      allowed &&
      booking.status === 'confirmed' &&
      booking.startsAt.getTime() <= now.getTime() &&
      (booking.jobStatus === null || booking.jobStatus === 'to_do'),
    canWithdrawNoShow:
      allowed &&
      booking.status === 'no_show' &&
      booking.noShowAt !== null &&
      noShowUndoOpen(booking.noShowAt, now),
  };
}

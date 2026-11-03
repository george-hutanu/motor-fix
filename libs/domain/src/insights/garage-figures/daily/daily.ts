import type { NextFreeSlotsDto } from '@motor-fix/contracts';

import {
  addDays,
  addMonths,
  atLocal,
  daysBetween,
  localDay,
  monthStart,
  weekStart,
} from '../../../bucharest';
import type { FreeSlotsKey } from '../../../workshop/free-slots/free-slots.cache';

// The four numbers of the day, worked out from what the reads return: pure,
// so the Bucharest edges, the rounding and the week's free-slot question are
// tested alone.

const MINUTE = 60_000;
const STEP = 30 * MINUTE;
const LEAD = 60 * MINUTE;
const SLOTS = 10;

// Bookings in these states will not bring the garage any work.
const LOST = new Set(['lapsed', 'cancelled', 'no_show']);

const span = (from: string, days: number) => ({
  gte: atLocal(from, 0),
  lt: atLocal(addDays(from, days), 0),
});

export function dailyPeriods(now: Date) {
  const today = localDay(now);
  const monday = weekStart(today);
  const monthDay = monthStart(today);
  return {
    month: {
      gte: atLocal(monthDay, 0),
      lt: atLocal(addMonths(monthDay, 1), 0),
    },
    monthDay,
    sunday: addDays(monday, 6),
    today: span(today, 1),
    week: span(monday, 7),
    yesterday: span(addDays(today, -1), 1),
  };
}

export interface WonQuote {
  fromBani: number;
  toBani: number;
  booking: {
    status: string;
    job: { finalPriceBani: number | null } | null;
  } | null;
}

// The final price where one is recorded, else the middle of the accepted
// range rounded half up.
export function estimatedWork(quotes: WonQuote[]): number {
  return quotes
    .filter((q) => !(q.booking && LOST.has(q.booking.status)))
    .reduce(
      (sum, q) =>
        sum +
        (q.booking?.job?.finalPriceBani ??
          Math.round((q.fromBani + q.toBani) / 2)),
      0,
    );
}

// Starts an hour from now at the earliest, on the half hour, through Sunday;
// none once that start falls in the next week.
export function freeSlotsKey(
  garageId: string,
  now: Date,
  sunday: string,
): FreeSlotsKey | undefined {
  const earliest = new Date(Math.ceil((now.getTime() + LEAD) / STEP) * STEP);
  const first = localDay(earliest);
  if (first > sunday) return undefined;
  return {
    count: SLOTS,
    duration: 60,
    earliest,
    garageId,
    horizonDays: daysBetween(first, sunday) + 1,
    needsLift: false,
  };
}

export function nextFreeSlots(
  slots: { startsAt: string }[],
  sunday: string,
): NextFreeSlotsDto | null {
  const days = slots
    .map((s) => s.startsAt.slice(0, 10))
    .filter((d) => d <= sunday);
  if (days.length === 0) return null;
  const day = days[0];
  return { count: days.filter((d) => d === day).length, day };
}

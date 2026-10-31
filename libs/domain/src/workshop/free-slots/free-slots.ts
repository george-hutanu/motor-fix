import { localDay } from '../../bucharest';
import {
  type GarageCalendar,
  type MechanicSchedule,
  workingStretches,
} from '../../garages/mechanic-hours';
import { placeSegments } from '../schedule/schedule.service';

const MINUTE = 60_000;
// Starts are offered on the half hours of the Bucharest clock. Its offset is
// a whole number of hours, so the UTC half hours are the same instants.
const STEP = 30 * MINUTE;

// A span a booking or a time block holds a mechanic, a lift or both for.
interface HeldSegment {
  bookingId: string | null;
  mechanicId: string | null;
  lift: number | null;
  startsAt: Date;
  endsAt: Date;
}

// A booking the garage has not confirmed yet: it holds no mechanic or lift,
// but takes one of each it will need from what is free over its time.
interface AwaitingBooking {
  bookingId: string;
  startsAt: Date;
  endsAt: Date;
  needsLift: boolean;
}

export interface FreeSlotsInput {
  calendar: GarageCalendar;
  switches: { team: boolean; lifts: boolean };
  liftCount: number;
  // The garage's current cards; ignored while the team is off.
  mechanics: { id: string; schedule: MechanicSchedule }[];
  segments: HeldSegment[];
  awaiting: AwaitingBooking[];
  earliest: Date;
  horizonDays: number;
  durationMinutes: number;
  needsLift: boolean;
  mechanicId?: string;
  excludeBookingId?: string;
  count: number;
}

interface FreeSlot {
  startsAt: Date;
  endsAt: Date;
}

type Span = [Date, Date];

const overlaps = (chain: readonly Span[], from: Date, to: Date) =>
  chain.some(([start, end]) => from < end && to > start);

// The starts on the step grid inside the stretches, from the earliest one on.
function candidates(stretches: readonly Span[][], earliest: number): number[] {
  const starts = new Set<number>();
  for (const [from, to] of stretches.flat()) {
    const first = Math.max(from.getTime(), earliest);
    for (let at = Math.ceil(first / STEP) * STEP; at < to.getTime(); at += STEP)
      starts.add(at);
  }
  return [...starts].sort((a, b) => a - b);
}

const endOf = (chain: readonly Span[]) => chain[chain.length - 1][1];

// The rows a question reads once, with the excluded booking's own left out.
function prepare(input: FreeSlotsInput) {
  const { excludeBookingId } = input;
  const firstDay = localDay(input.earliest);
  const segments = input.segments.filter(
    (s) => s.bookingId === null || s.bookingId !== excludeBookingId,
  );
  const awaiting = input.awaiting.filter(
    (a) => a.bookingId !== excludeBookingId,
  );
  const liftsCount =
    input.switches.lifts && input.liftCount > 0 && input.needsLift;
  return {
    awaiting,
    earliest: Math.ceil(input.earliest.getTime() / STEP) * STEP,
    // The lifts free over the chain less those the awaiting bookings need.
    liftUnitsLeft: (chain: readonly Span[]) => {
      if (!liftsCount) return 1;
      let free = 0;
      for (let lift = 1; lift <= input.liftCount; lift++) {
        const held = segments.some(
          (s) => s.lift === lift && overlaps(chain, s.startsAt, s.endsAt),
        );
        if (!held) free++;
      }
      const taken = awaiting.filter(
        (a) => a.needsLift && overlaps(chain, a.startsAt, a.endsAt),
      ).length;
      return free - taken;
    },
    place: (stretches: readonly Span[], at: number) =>
      placeSegments(stretches, new Date(at), input.durationMinutes),
    segments,
    stretchesOf: (schedule: MechanicSchedule | null) =>
      workingStretches(schedule, input.calendar, firstDay, input.horizonDays),
  };
}

type Question = ReturnType<typeof prepare>;

// Without the team only the garage's hours and its lifts count.
function soloSlots(input: FreeSlotsInput, q: Question): FreeSlot[] {
  const stretches = q.stretchesOf(null);
  const slots: FreeSlot[] = [];
  for (const at of candidates([stretches], q.earliest)) {
    if (slots.length >= input.count) break;
    const chain = q.place(stretches, at);
    if (chain && q.liftUnitsLeft(chain) >= 1) {
      slots.push({ endsAt: endOf(chain), startsAt: new Date(at) });
    }
  }
  return slots;
}

// The chain of the mechanic free at `at`, earliest end first, that the
// awaiting bookings and the lifts still leave room for.
function teamChain(
  input: FreeSlotsInput,
  q: Question,
  team: { id: string; stretches: Span[] }[],
  at: number,
): Span[] | undefined {
  const free = team.flatMap((m) => {
    const chain = q.place(m.stretches, at);
    const held =
      !chain ||
      q.segments.some(
        (s) => s.mechanicId === m.id && overlaps(chain, s.startsAt, s.endsAt),
      );
    return held ? [] : [{ chain, id: m.id }];
  });
  return free
    .filter((m) => !input.mechanicId || m.id === input.mechanicId)
    .map((m) => m.chain)
    .sort((a, b) => endOf(a).getTime() - endOf(b).getTime())
    .find((chain) => {
      const taken = q.awaiting.filter((a) =>
        overlaps(chain, a.startsAt, a.endsAt),
      ).length;
      return free.length - taken >= 1 && q.liftUnitsLeft(chain) >= 1;
    });
}

function teamSlots(input: FreeSlotsInput, q: Question): FreeSlot[] {
  const team = input.mechanics.map((m) => ({
    id: m.id,
    stretches: q.stretchesOf(m.schedule),
  }));
  const asked = team.filter(
    (m) => !input.mechanicId || m.id === input.mechanicId,
  );
  const slots: FreeSlot[] = [];
  for (const at of candidates(
    asked.map((m) => m.stretches),
    q.earliest,
  )) {
    if (slots.length >= input.count) break;
    const chain = teamChain(input, q, team, at);
    if (chain) slots.push({ endsAt: endOf(chain), startsAt: new Date(at) });
  }
  return slots;
}

// The first starts a job of the asked length can be booked at, each with the
// end of its chain over the working stretches, as the confirm would place it:
// one mechanic free over the whole chain (the named one when asked), one lift
// free over it when the job needs one, after the awaiting bookings overlapping
// it have taken their mechanic and lift. Pure: the caller reads the rows.
export function freeSlots(input: FreeSlotsInput): { slots: FreeSlot[] } {
  const q = prepare(input);
  return {
    slots: input.switches.team ? teamSlots(input, q) : soloSlots(input, q),
  };
}

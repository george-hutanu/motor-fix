import { type Interval, storedWeek, type Weekday } from '@motor-fix/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';

import { refusal } from '../../auth/http-refusal';
import { addDays, localDay } from '../../bucharest';
import { minuteOf, wall } from '../../garages/garage-hours';
import {
  type GarageCalendar,
  isDayOff,
  type MechanicSchedule,
  stretchOn,
  unset,
  workingStretches,
} from '../../garages/mechanic-hours';
import type { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;
type Language = 'ro' | 'en';

const MINUTE = 60_000;
// How far a long job may run on over the working stretches after its start day.
const HORIZON_DAYS = 30;

// One span a booking holds a mechanic and a lift for.
export interface Segment {
  startsAt: Date;
  endsAt: Date;
  mechanicId: string | null;
  lift: number | null;
}

// Who holds a stored segment: a booking, with the car it is for, or a time
// block, with its whole range.
type Holder =
  | { kind: 'booking'; car: { brand: string; model: string } }
  | { kind: 'time_block'; startsAt: Date; endsAt: Date };

// A stored segment another booking or a time block holds.
export interface TakenSegment {
  startsAt: Date;
  endsAt: Date;
  mechanicId: string | null;
  lift: number | null;
  holder: Holder;
}

export interface PlacementInput {
  calendar: GarageCalendar;
  mechanic: { id: string; name: string; schedule: MechanicSchedule } | null;
  startsAt: Date;
  durationMinutes: number;
  lift: number | null;
  language: Language;
}

const RO_MONTHS = [
  'ianuarie',
  'februarie',
  'martie',
  'aprilie',
  'mai',
  'iunie',
  'iulie',
  'august',
  'septembrie',
  'octombrie',
  'noiembrie',
  'decembrie',
];
const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAY_NAMES: Record<Weekday, [string, string]> = {
  fri: ['vineri', 'Friday'],
  mon: ['luni', 'Monday'],
  sat: ['sâmbătă', 'Saturday'],
  sun: ['duminică', 'Sunday'],
  thu: ['joi', 'Thursday'],
  tue: ['marți', 'Tuesday'],
  wed: ['miercuri', 'Wednesday'],
};

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (at: Date) => {
  const { minute } = wall(at);
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
};
const dayName = (day: string, months: readonly string[]) =>
  `${Number(day.slice(8, 10))} ${months[Number(day.slice(5, 7)) - 1]}`;
const inside = ([from, to]: Interval, minute: number) =>
  minuteOf(from) <= minute && minute < minuteOf(to);
const listed = (intervals: readonly Interval[]) =>
  intervals.map(([from, to]) => `${from}–${to}`).join(', ');
const inParens = (detail: string) => (detail ? ` (${detail})` : '');

// Why a booking cannot go where it was asked, beyond its code. The garage's
// causes answer outside_hours, the mechanic's mechanic_unavailable.
type Cause =
  | 'public_holiday'
  | 'closed_day'
  | 'outside_opening'
  | 'day_off'
  | 'saturday_off'
  | 'not_working'
  | 'ends_early';
type Said = [Cause, string];

// Each cause's message in Romanian and English, from the mechanic's name and
// the cause's detail: the day, the opening intervals or her end.
const TEXTS: Record<Cause, (name: string, detail: string) => [string, string]> =
  {
    closed_day: () => [
      'Service-ul e închis în ziua aceea',
      'The garage is closed that day',
    ],
    day_off: (name) => [
      `${name} e liberă în ziua aceea`,
      `${name} is off that day`,
    ],
    ends_early: (name, end) => [
      `${name} lucrează până la ${end} în ziua aceea`,
      `${name} works until ${end} that day`,
    ],
    not_working: (name) => [
      `${name} nu lucrează în ziua aceea`,
      `${name} does not work that day`,
    ],
    outside_opening: (_, hours) => [
      `În afara programului${inParens(hours)}`,
      `Outside opening hours${inParens(hours)}`,
    ],
    public_holiday: (_, day) => [
      `${dayName(day, RO_MONTHS)} e sărbătoare legală`,
      `${dayName(day, EN_MONTHS)} is a legal holiday`,
    ],
    saturday_off: (name) => [
      `${name} nu lucrează sâmbăta`,
      `${name} does not work on Saturdays`,
    ],
  };
const GARAGE_CAUSES = new Set<Cause>([
  'public_holiday',
  'closed_day',
  'outside_opening',
]);

function refused([cause, detail]: Said, language: Language, name: string) {
  const message = TEXTS[cause](name, detail)[language === 'en' ? 1 : 0];
  const code = GARAGE_CAUSES.has(cause)
    ? 'outside_hours'
    : 'mechanic_unavailable';
  return refusal(HttpStatus.CONFLICT, code, message, undefined, cause);
}

// The rest of a job longer than the stretch it starts in, from its start on
// through each next stretch until its minutes are spent.
function filled(
  stretches: readonly [Date, Date][],
  first: number,
  start: number,
  minutes: number,
): [Date, Date][] | null {
  let left = minutes * MINUTE;
  const placed: [Date, Date][] = [];
  for (const [index, [from, to]] of stretches.entries()) {
    if (index < first) continue;
    const begin = Math.max(start, from.getTime());
    const take = Math.min(left, to.getTime() - begin);
    placed.push([new Date(begin), new Date(begin + take)]);
    left -= take;
    if (left === 0) return placed;
  }
  return null;
}

// The segments a job of `durationMinutes` from `startsAt` fills on the
// working stretches, or null when it cannot be placed. A job no longer than
// the stretch it starts in must end inside it; a longer one fills it and goes
// on at the start of each next stretch until its minutes are spent.
export function placeSegments(
  stretches: readonly [Date, Date][],
  startsAt: Date,
  durationMinutes: number,
): [Date, Date][] | null {
  const start = startsAt.getTime();
  const first = stretches.findIndex(
    ([from, to]) => from.getTime() <= start && start < to.getTime(),
  );
  if (first < 0) return null;
  const end = start + durationMinutes * MINUTE;
  const [from, to] = stretches[first];
  if (end - start > to.getTime() - from.getTime()) {
    return filled(stretches, first, start, durationMinutes);
  }
  return end <= to.getTime() ? [[startsAt, new Date(end)]] : null;
}

type Wall = ReturnType<typeof wall>;

// The garage's cause on the start's day: a holiday, a closed day, or a start
// outside its opening intervals. A garage with no hours set opens any time.
function garageCause(
  calendar: GarageCalendar,
  start: Wall,
  opening: readonly Interval[],
): Said | null {
  if (calendar.holidays.has(start.day)) return ['public_holiday', start.day];
  if (calendar.closedDays.has(start.day)) return ['closed_day', ''];
  if (unset(calendar.hours)) return null;
  if (opening.length === 0) return ['closed_day', ''];
  return opening.some((each) => inside(each, start.minute))
    ? null
    : ['outside_opening', listed(opening)];
}

// The mechanic's cause on the start's day. With neither her hours nor the
// garage's set only her days off count.
function mechanicCause(
  schedule: MechanicSchedule | null,
  hours: unknown,
  start: Wall,
  anyTime: boolean,
): Said | null {
  if (!schedule) return null;
  if (isDayOff(schedule.daysOff, start.day)) return ['day_off', ''];
  if (anyTime) return null;
  if (start.weekday === 'sat' && !schedule.worksSaturdays) {
    return ['saturday_off', ''];
  }
  const own = stretchOn(schedule, hours, start.weekday);
  if (!own) return ['not_working', ''];
  return inside(own, start.minute) ? null : ['ends_early', own[1]];
}

// Why a job that starts inside a stretch could not be placed: a short one ran
// into the end of her day before the garage's interval, or else it ran out of
// opening hours.
function overrunCause(
  input: PlacementInput,
  stretches: readonly [Date, Date][],
  start: Wall,
  opening: readonly Interval[],
): Said {
  const first = stretches.find(
    ([from, to]) => from <= input.startsAt && input.startsAt < to,
  );
  const short =
    first !== undefined &&
    input.durationMinutes * MINUTE <= first[1].getTime() - first[0].getTime();
  const own =
    input.mechanic &&
    stretchOn(input.mechanic.schedule, input.calendar.hours, start.weekday);
  const interval = opening.find((each) => inside(each, start.minute));
  if (short && own && (!interval || minuteOf(own[1]) < minuteOf(interval[1]))) {
    return ['ends_early', own[1]];
  }
  return ['outside_opening', listed(opening)];
}

// Where a booking goes on the garage's and the mechanic's time, or the one
// refusal that names why it cannot: the garage's calendar first, then its
// opening hours, then the mechanic's own days and hours.
export function placementOf(input: PlacementInput): Segment[] {
  const { calendar, durationMinutes, mechanic, startsAt } = input;
  const start = wall(startsAt);
  const schedule = mechanic?.schedule ?? null;
  const opening = storedWeek(calendar.hours)[start.weekday] ?? [];
  const anyTime = unset(calendar.hours) && schedule?.workingHours == null;
  const segments = (spans: [Date, Date][]): Segment[] =>
    spans.map(([from, to]) => ({
      endsAt: to,
      lift: input.lift,
      mechanicId: mechanic?.id ?? null,
      startsAt: from,
    }));
  const fail = (said: Said) =>
    refused(said, input.language, mechanic?.name ?? '');
  const cause =
    garageCause(calendar, start, opening) ??
    mechanicCause(schedule, calendar.hours, start, anyTime);
  if (cause) throw fail(cause);
  if (anyTime) {
    const end = new Date(startsAt.getTime() + durationMinutes * MINUTE);
    return segments([[startsAt, end]]);
  }
  const stretches = workingStretches(
    schedule,
    calendar,
    start.day,
    HORIZON_DAYS,
  );
  const placed = placeSegments(stretches, startsAt, durationMinutes);
  if (placed) return segments(placed);
  throw fail(overrunCause(input, stretches, start, opening));
}

type Asked = { language: Language; mechanicName: string; startsAt: Date };

// The refusal naming the row that holds the mechanic or the lift: a booking
// by its segment and car, a block by its whole range, each end with its
// weekday when on another day than the start asked for.
function busy(row: TakenSegment, on: 'mechanicId' | 'lift', asked: Asked) {
  const en = asked.language === 'en';
  const end = (at: Date) =>
    localDay(at) === localDay(asked.startsAt)
      ? clock(at)
      : `${WEEKDAY_NAMES[wall(at).weekday][en ? 1 : 0]} ${clock(at)}`;
  const { holder } = row;
  const block = holder.kind === 'time_block';
  const span = block
    ? `${end(holder.startsAt)}–${end(holder.endsAt)}`
    : `${end(row.startsAt)}–${clock(row.endsAt)}`;
  const name = asked.mechanicName;
  const lift = row.lift;
  const car = block ? '' : ` (${holder.car.brand} ${holder.car.model})`;
  const said: [string, string] =
    on === 'mechanicId'
      ? block
        ? [`${name} e blocat ${span}`, `${name} is blocked ${span}`]
        : [`${name} are o programare ${span}`, `${name} has a booking ${span}`]
      : block
        ? [
            `Elevatorul ${lift} e blocat ${span}`,
            `Lift ${lift} is blocked ${span}`,
          ]
        : [
            `Elevatorul ${lift} e ocupat ${span}${car}`,
            `Lift ${lift} is busy ${span}${car}`,
          ];
  return refusal(
    HttpStatus.CONFLICT,
    on === 'mechanicId' ? 'mechanic_busy' : 'lift_busy',
    said[en ? 1 : 0],
    [{ code: 'busy', field: on }],
    block ? 'time_block' : undefined,
  );
}

// The refusal for the first row overlapping one segment: its mechanic's row
// before its lift's.
function busyOn(
  segment: Segment,
  taken: readonly TakenSegment[],
  asked: Asked,
) {
  const over = taken
    .filter(
      (row) => row.startsAt < segment.endsAt && row.endsAt > segment.startsAt,
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const mechanic = over.find(
    (row) =>
      segment.mechanicId !== null && row.mechanicId === segment.mechanicId,
  );
  if (mechanic) return busy(mechanic, 'mechanicId', asked);
  const lift = over.find(
    (row) => segment.lift !== null && row.lift === segment.lift,
  );
  return lift ? busy(lift, 'lift', asked) : null;
}

// The first of the asked segments, in time order, that a booking or a block
// already holds: its mechanic before its lift.
export function judgeOverlaps(
  segments: readonly Segment[],
  taken: readonly TakenSegment[],
  booking: Asked,
) {
  const ordered = [...segments].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  for (const segment of ordered) {
    const clash = busyOn(segment, taken, booking);
    if (clash) throw clash;
  }
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

// The overlap the database refused although the read before it found none:
// a confirm or a block committed in between.
export function isSlotTaken(error: unknown) {
  if (!(error instanceof Error)) return false;
  const said = `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
  return (
    said.includes('booking_segment_mechanic_excl') ||
    said.includes('booking_segment_lift_excl')
  );
}

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

// Places a booking for a confirm: reads the calendar, the mechanic's days and
// the segments already held, and returns the segments to write or throws the
// refusal that names the cause. It writes nothing; the exclusion constraints
// on booking_segment still catch a confirm that commits in between.
function takenOf(row: {
  startsAt: Date;
  endsAt: Date;
  mechanicId: string | null;
  lift: number | null;
  booking: { request: { carBrand: string; carModel: string } } | null;
  timeBlock: { startsAt: Date; endsAt: Date } | null;
}): TakenSegment {
  const holder: Holder = row.timeBlock
    ? { kind: 'time_block', ...row.timeBlock }
    : {
        car: {
          brand: row.booking?.request.carBrand ?? '',
          model: row.booking?.request.carModel ?? '',
        },
        kind: 'booking',
      };
  return {
    endsAt: row.endsAt,
    holder,
    lift: row.lift,
    mechanicId: row.mechanicId,
    startsAt: row.startsAt,
  };
}

@Injectable()
export class ScheduleService {
  async assertPlaceable(
    tx: Tx,
    booking: {
      garageId: string;
      mechanicId: string | null;
      lift: number | null;
      startsAt: Date;
      durationMinutes: number;
      language: Language;
    },
  ): Promise<Segment[]> {
    const { garageId, mechanicId } = booking;
    const first = localDay(booking.startsAt);
    const window = {
      gte: asDate(first),
      lte: asDate(addDays(first, HORIZON_DAYS)),
    };
    const mechanic = mechanicId
      ? await this.mechanicOf(tx, mechanicId, window)
      : null;
    const [garage, closed, holidays] = await Promise.all([
      tx.garage.findUniqueOrThrow({
        select: { hours: true },
        where: { id: garageId },
      }),
      tx.garageClosedDay.findMany({ where: { day: window, garageId } }),
      tx.publicHoliday.findMany({ where: { day: window } }),
    ]);
    const segments = placementOf({
      calendar: {
        closedDays: new Set(closed.map((c) => dayOf(c.day))),
        holidays: new Set(holidays.map((h) => dayOf(h.day))),
        hours: (garage.hours ?? {}) as GarageCalendar['hours'],
      },
      durationMinutes: booking.durationMinutes,
      language: booking.language,
      lift: booking.lift,
      mechanic,
      startsAt: booking.startsAt,
    });
    await this.assertFree(tx, {
      garageId,
      language: booking.language,
      lift: booking.lift,
      mechanicId,
      mechanicName: mechanic?.name ?? '',
      segments,
      startsAt: booking.startsAt,
    });
    return segments;
  }

  // Throws the refusal naming the first booking or block that holds the
  // segments' mechanic or lift; a block's change leaves out its own rows.
  async assertFree(
    tx: Tx,
    asked: Asked & {
      garageId: string;
      mechanicId: string | null;
      lift: number | null;
      segments: readonly Segment[];
      exceptTimeBlockId?: string;
    },
  ): Promise<void> {
    const { garageId, mechanicId, lift, segments } = asked;
    const holders: Prisma.BookingSegmentWhereInput[] = [];
    if (mechanicId) holders.push({ mechanicId });
    if (lift !== null) holders.push({ garageId, lift });
    if (holders.length === 0 || segments.length === 0) return;
    const first = segments.reduce((a, b) => (a.startsAt < b.startsAt ? a : b));
    const last = segments.reduce((a, b) => (a.endsAt > b.endsAt ? a : b));
    const rows = await tx.bookingSegment.findMany({
      include: {
        booking: {
          select: { request: { select: { carBrand: true, carModel: true } } },
        },
        timeBlock: { select: { endsAt: true, startsAt: true } },
      },
      where: {
        endsAt: { gt: first.startsAt },
        OR: holders,
        startsAt: { lt: last.endsAt },
        ...(asked.exceptTimeBlockId && {
          NOT: { timeBlockId: asked.exceptTimeBlockId },
        }),
      },
    });
    judgeOverlaps(segments, rows.map(takenOf), asked);
  }

  // Waits out a day off being added, which holds this row: the read below
  // then sees it, and the add sees this booking.
  private async mechanicOf(
    tx: Tx,
    id: string,
    window: { gte: Date; lte: Date },
  ) {
    await tx.$queryRaw`SELECT id FROM mechanic WHERE id = ${id}::uuid FOR SHARE`;
    const mechanic = await tx.mechanic.findUniqueOrThrow({ where: { id } });
    const daysOff = await tx.mechanicDayOff.findMany({
      select: { firstDay: true, lastDay: true },
      where: {
        firstDay: { lte: window.lte },
        lastDay: { gte: window.gte },
        mechanicId: id,
      },
    });
    return {
      id,
      name: mechanic.name,
      schedule: {
        daysOff: daysOff.map((d) => ({
          firstDay: dayOf(d.firstDay),
          lastDay: dayOf(d.lastDay),
        })),
        workingHours: mechanic.workingHours,
        worksSaturdays: mechanic.worksSaturdays,
      },
    };
  }
}

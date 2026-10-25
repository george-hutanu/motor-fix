import {
  type Interval,
  isDay,
  storedWeek,
  stretchOf,
  WEEKDAYS,
  type Weekday,
  type WeeklyHours,
} from '@motor-fix/contracts';

import { minuteOf, spanInsideHours, wall } from './garage-hours';

type Hours = Partial<Record<string, Interval[]>>;

interface DayOff {
  firstDay: string;
  lastDay: string;
}

export interface MechanicSchedule {
  // The stored `working_hours`: null keeps the garage's weekdays.
  workingHours: unknown;
  worksSaturdays: boolean;
  daysOff: readonly DayOff[];
}

interface GarageCalendar {
  hours: Hours;
  closedDays: ReadonlySet<string>;
  holidays: ReadonlySet<string>;
}

const WORKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

const listOf = (hours: unknown, day: Weekday): Interval[] =>
  storedWeek(hours)[day] ?? [];

// The stretch a mechanic works each weekday, as a week of zero or one interval
// a day. With no hours of her own: the garage's weekdays, each from its first
// opening to its last closing, and no weekend.
export function effectiveHours(
  workingHours: unknown,
  garageHours: unknown,
): WeeklyHours {
  const own = workingHours !== null && workingHours !== undefined;
  return Object.fromEntries(
    WEEKDAYS.map((day) => {
      const source =
        own || WORKDAYS.includes(day)
          ? listOf(own ? workingHours : garageHours, day)
          : [];
      const stretch = stretchOf(source);
      return [day, stretch ? [stretch] : []];
    }),
  ) as WeeklyHours;
}

export const isDayOff = (daysOff: readonly DayOff[], day: string): boolean =>
  daysOff.some((d) => d.firstDay <= day && day <= d.lastDay);

// The stretch that counts on a weekday: Saturday only with the switch on.
function stretchOn(
  schedule: MechanicSchedule,
  garageHours: unknown,
  weekday: Weekday,
): Interval | null {
  if (weekday === 'sat' && !schedule.worksSaturdays) return null;
  return effectiveHours(schedule.workingHours, garageHours)[weekday][0] ?? null;
}

const unset = (hours: unknown) =>
  !hours || Object.keys(hours as object).length === 0;

// Whether [start, start + duration) lies inside the mechanic's own stretch of
// its Bucharest day, on none of her days off. The garage's closed days and
// holidays are the garage's: mechanicAtWork adds them. With neither her hours
// nor the garage's set, any span counts, as spanInsideHours takes it.
export function mechanicOwnAtWork(
  schedule: MechanicSchedule,
  garageHours: unknown,
  startsAt: Date,
  durationMinutes: number,
): boolean {
  if (Number.isNaN(startsAt.getTime()) || !(durationMinutes >= 0)) return false;
  const start = wall(startsAt);
  if (isDayOff(schedule.daysOff, start.day)) return false;
  if (schedule.workingHours == null && unset(garageHours)) return true;
  const end = wall(new Date(startsAt.getTime() + durationMinutes * 60_000));
  if (end.day !== start.day) return false;
  const stretch = stretchOn(schedule, garageHours, start.weekday);
  return (
    stretch !== null &&
    minuteOf(stretch[0]) <= start.minute &&
    end.minute <= minuteOf(stretch[1])
  );
}

// Whether the mechanic is at work over a span: inside the garage's hours on
// neither a closed day nor a holiday, and inside her own schedule.
export const mechanicAtWork = (
  schedule: MechanicSchedule,
  garage: GarageCalendar,
  startsAt: Date,
  durationMinutes: number,
): boolean =>
  spanInsideHours(
    garage.hours,
    garage.closedDays,
    garage.holidays,
    startsAt,
    durationMinutes,
  ) && mechanicOwnAtWork(schedule, garage.hours, startsAt, durationMinutes);

// The minutes the mechanic is planned to work on a Bucharest day.
export function plannedMinutes(
  schedule: MechanicSchedule,
  garage: GarageCalendar,
  day: string,
): number {
  if (
    !isDay(day) ||
    isDayOff(schedule.daysOff, day) ||
    garage.closedDays.has(day) ||
    garage.holidays.has(day)
  ) {
    return 0;
  }
  const weekday = WEEKDAYS[(new Date(day).getUTCDay() + 6) % 7];
  const stretch = stretchOn(schedule, garage.hours, weekday);
  return stretch ? minuteOf(stretch[1]) - minuteOf(stretch[0]) : 0;
}

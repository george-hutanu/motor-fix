import {
  CLOSED_NOTE_MAX,
  type ClosedDay,
  type ClosedDayError,
  closedDayError,
  closedDaysError,
  FACILITIES,
  type Facility,
  type HoursSection,
  type Interval,
  isHoursSection,
  isWeeklyHours,
  type Weekday,
  type WeeklyHours,
} from '@motor-fix/contracts/garage-hours';

import { letters } from './brands-section';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stepFive = (data: unknown) => {
  if (!isRecord(data)) return undefined;
  const { steps } = data;
  return isRecord(steps) ? steps['5'] : undefined;
};

// Step 5's three keys as the listing draft holds them (`steps['5']`); a key
// not in shape opens as never filled in, and the others are kept.
export function hoursOf(data: unknown): HoursSection {
  const section = stepFive(data);
  if (!isRecord(section)) return {};
  const { closedDays, facilities, hours } = section;
  const read: HoursSection = {};
  if (isWeeklyHours(hours)) read.hours = hours;
  if (closedDaysError(closedDays) === null)
    read.closedDays = closedDays as ClosedDay[];
  if (facilities !== undefined && isHoursSection({ facilities }))
    read.facilities = facilities as Facility[];
  return read;
}

// The step's value put back into the section, which other stories share:
// their keys stay, and an absent key or an empty list is left out.
export function mergeHours(
  section: Record<string, unknown> | undefined,
  value: HoursSection,
): Record<string, unknown> {
  const { closedDays: _c, facilities: _f, hours: _h, ...rest } = section ?? {};
  const merged: Record<string, unknown> = { ...rest };
  if (value.hours) merged['hours'] = value.hours;
  if (value.closedDays?.length) merged['closedDays'] = value.closedDays;
  if (value.facilities?.length) merged['facilities'] = value.facilities;
  return merged;
}

const WORKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

const same = (a: Interval, b: Interval) => a[0] === b[0] && a[1] === b[1];

export type Row = Interval | 'differs';

// What the two simple rows can show: one interval for Monday to Friday and
// Saturday's, or 'differs' when the days cannot be told in one row.
export function simpleRows(hours: WeeklyHours): {
  weekdays: Row;
  saturday: Row | null;
} {
  const [first] = hours.mon;
  const weekdays: Row =
    first &&
    WORKDAYS.every(
      (day) => hours[day].length === 1 && same(hours[day][0], first),
    )
      ? first
      : 'differs';
  const saturday: Row | null =
    hours.sat.length === 0
      ? null
      : hours.sat.length === 1
        ? hours.sat[0]
        : 'differs';
  return { saturday, weekdays };
}

export function setWeekdays(
  hours: WeeklyHours,
  interval: Interval,
): WeeklyHours {
  const next = { ...hours };
  for (const day of WORKDAYS) next[day] = [interval];
  return next;
}

export const setDay = (
  hours: WeeklyHours,
  day: Weekday,
  intervals: Interval[],
): WeeklyHours => ({ ...hours, [day]: intervals });

const OPEN_DAY: Interval = ['08:00', '17:00'];

export const toggleClosed = (hours: WeeklyHours, day: Weekday) =>
  setDay(hours, day, hours[day].length ? [] : [OPEN_DAY]);

// The day split around a break that sits strictly inside it.
export function addBreak(
  [open, close]: Interval,
  from: string,
  to: string,
): Interval[] | 'breakOutside' {
  if (!(open < from && from < to && to < close)) return 'breakOutside';
  return [
    [open, from],
    [to, close],
  ];
}

export const removeBreak = (intervals: Interval[]): Interval[] => [
  [intervals[0][0], intervals[intervals.length - 1][1]],
];

// The list with the day added in day order, or why it cannot be.
export function addClosedDay(
  list: ClosedDay[],
  day: string,
  note: string,
  today: string,
  holidays: readonly string[],
): ClosedDay[] | ClosedDayError | 'note' {
  const refused = closedDayError(day, list, today, holidays);
  if (refused) return refused;
  const trimmed = note.trim();
  if (letters(trimmed) > CLOSED_NOTE_MAX) return 'note';
  const entry: ClosedDay = trimmed ? { day, note: trimmed } : { day };
  return [...list, entry].sort((a, b) => a.day.localeCompare(b.day));
}

export const removeClosedDay = (list: ClosedDay[], day: string) =>
  list.filter((entry) => entry.day !== day);

export function toggleFacility(list: Facility[], facility: Facility) {
  const ticked = list.includes(facility);
  return FACILITIES.filter((f) =>
    f === facility ? !ticked : list.includes(f),
  );
}

// Whether a garage is open at an instant, from its weekly hours and the closed
// days ahead, on the Europe/Bucharest wall clock. Browser-safe: the profile
// page and the server render run the same rule.
import {
  isWeeklyHours,
  todayInBucharest,
  WEEKDAYS,
  type WeeklyHours,
} from './garage-hours';

export interface ClosedDayAhead {
  // "YYYY-MM-DD", a Bucharest calendar day.
  day: string;
  reason: 'holiday' | 'closed';
}

export type OpenStatus =
  | { kind: 'none' }
  | { kind: 'open'; until: string }
  | { kind: 'break'; until: string }
  | {
      kind: 'closed';
      reason: 'hours' | 'holiday' | 'closed';
      next: { inDays: number; at: string };
    };

// The closed days a profile carries reach today + 14, so no opening is looked
// for past them.
const SEARCH_DAYS = 14;
const DAY_MS = 86_400_000;

const BUCHAREST_TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  timeZone: 'Europe/Bucharest',
});

const plusDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

const weekdayOf = (day: string) =>
  WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];

const closedOn = (closedDays: readonly ClosedDayAhead[]) => {
  const shut = new Map<string, ClosedDayAhead['reason']>();
  for (const { day, reason } of closedDays)
    if (shut.get(day) !== 'holiday') shut.set(day, reason);
  return shut;
};

function nextOpening(
  hours: WeeklyHours,
  shut: Map<string, ClosedDayAhead['reason']>,
  today: string,
) {
  for (let inDays = 1; inDays <= SEARCH_DAYS; inDays++) {
    const day = plusDays(today, inDays);
    const first = shut.has(day) ? undefined : hours[weekdayOf(day)][0];
    if (first) return { at: first[0], inDays };
  }
  return undefined;
}

export function openStatus(
  hours: unknown,
  closedDays: readonly ClosedDayAhead[],
  now: Date,
): OpenStatus {
  if (!isWeeklyHours(hours)) return { kind: 'none' };
  const shut = closedOn(closedDays);
  const today = todayInBucharest(now);
  const time = BUCHAREST_TIME.format(now);
  const intervals = shut.has(today) ? [] : hours[weekdayOf(today)];

  const current = intervals.find(([start, end]) => start <= time && time < end);
  if (current) return { kind: 'open', until: current[1] };
  const later = intervals.find(([start]) => start > time);
  if (later && intervals[0] !== later)
    return { kind: 'break', until: later[0] };

  const next = later
    ? { at: later[0], inDays: 0 }
    : nextOpening(hours, shut, today);
  if (!next) return { kind: 'none' };
  return { kind: 'closed', next, reason: shut.get(today) ?? 'hours' };
}

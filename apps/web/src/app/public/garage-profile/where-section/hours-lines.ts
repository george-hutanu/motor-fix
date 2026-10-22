import { isWeeklyHours, WEEKDAYS } from '@motor-fix/contracts/garage-hours';
import type { Language } from '@motor-fix/i18n';

interface HoursLine {
  days: string;
  times: string;
  closed: boolean;
}

const DASH = ' – ';

// The week from Monday, each run of days with the same intervals on one line:
// "Luni – vineri  08:00 – 19:00". A table the listing editor would refuse
// gives no line at all.
export function hoursLines(
  hours: unknown,
  language: Language,
  t: (key: string) => string,
): HoursLine[] {
  if (!isWeeklyHours(hours)) return [];
  const runs: {
    first: string;
    last: string;
    times: string;
    closed: boolean;
  }[] = [];
  for (const day of WEEKDAYS) {
    const closed = hours[day].length === 0;
    const times = !closed
      ? hours[day].map((interval) => interval.join(DASH)).join(', ')
      : t('public.listing.hours.closed');
    const run = runs.at(-1);
    if (run?.times === times) run.last = day;
    else runs.push({ closed, first: day, last: day, times });
  }
  const name = (day: string) => t(`public.listing.hours.days.${day}`);
  // Romanian writes the second day of a run in lower case; English keeps it.
  const second = (day: string) =>
    language === 'ro' ? name(day).toLocaleLowerCase('ro') : name(day);
  return runs.map(({ first, last, times, closed }) => ({
    closed,
    days: first === last ? name(first) : name(first) + DASH + second(last),
    times,
  }));
}

import { addDays } from '../../bucharest';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const STANDARD = {
  en: 'We answer within one working day.',
  ro: 'Îți răspundem în cel mult o zi lucrătoare.',
};

const AWAY = {
  en: (date: string) => `We will answer by ${date}.`,
  ro: (date: string) => `Îți răspundem până pe ${date}.`,
};

const LOCALE = { en: 'en-GB', ro: 'ro-RO' };

// A calendar day that exists: 2026-02-30 does not.
const realDay = (value: string) => {
  if (!DAY.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
};

const working = (day: string, holidays: ReadonlySet<string>) => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(day);
};

// The first Bucharest working day on or after `day`; a year of days off
// in a row is not a calendar this has to answer.
function firstWorkingDay(day: string, holidays: ReadonlySet<string>): string {
  let next = day;
  for (let n = 0; n < 366 && !working(next, holidays); n++) {
    next = addDays(next, 1);
  }
  return next;
}

// Whether the owner's away day is still ahead of `today`, both Bucharest
// days: an unset, malformed, past or today's day reads as not away.
export const awayAhead = (awayUntil: string | undefined, today: string) =>
  awayUntil !== undefined && realDay(awayUntil) && awayUntil > today;

// The acknowledgement's answer time: one working day, or while the owner is
// away, the first working day on or after their return, as a long date.
export function promiseLine(
  languageCode: string,
  awayUntil: string | undefined,
  today: string,
  holidays: ReadonlySet<string>,
): string {
  const language = languageCode === 'en' ? 'en' : 'ro';
  if (!awayAhead(awayUntil, today)) return STANDARD[language];
  const day = firstWorkingDay(awayUntil as string, holidays);
  const date = new Intl.DateTimeFormat(LOCALE[language], {
    dateStyle: 'long',
    timeZone: 'Europe/Bucharest',
  }).format(new Date(`${day}T12:00:00Z`));
  return AWAY[language](date);
}

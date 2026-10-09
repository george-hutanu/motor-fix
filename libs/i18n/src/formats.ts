import type { Language } from './languages';

const LOCALES: Record<Language, string> = { en: 'en-GB', ro: 'ro-RO' };
const ZONE = 'Europe/Bucharest';
const MISSING = '—';

// Fixed rather than taken from Intl, whose data writes "mar." and "Sept":
// the product writes "mart." and "Sep", and server and browser must agree.
const MONTHS_SHORT: Record<Language, readonly string[]> = {
  en: [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ],
  ro: [
    'ian.',
    'feb.',
    'mart.',
    'apr.',
    'mai',
    'iun.',
    'iul.',
    'aug.',
    'sept.',
    'oct.',
    'nov.',
    'dec.',
  ],
};

const numberFormats = new Map<string, Intl.NumberFormat>();

function digits(
  value: number,
  language: Language,
  min: number,
  max: number,
): string {
  const id = `${language}/${min}/${max}`;
  let format = numberFormats.get(id);
  if (!format) {
    format = new Intl.NumberFormat(LOCALES[language], {
      maximumFractionDigits: max,
      minimumFractionDigits: min,
    });
    numberFormats.set(id, format);
  }
  // `|| 0` turns a rounded -0 into 0, which Intl would print as "-0".
  return format.format(value || 0);
}

// Templates may pass anything: whatever is not a finite number (or, for
// dates, a valid instant) shows the missing-value dash.
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function lei(bani: number[], language: Language): string {
  const decimals = bani.some((b) => b % 100 !== 0) ? 2 : 0;
  const amounts = bani.map((b) =>
    digits(b / 100, language, decimals, decimals),
  );
  return `${amounts.join('–')} lei`;
}

export function formatLei(bani: unknown, language: Language): string {
  return isNumber(bani) ? lei([Math.round(bani)], language) : MISSING;
}

export function formatLeiRange(
  from: unknown,
  to: unknown,
  language: Language,
): string {
  if (!isNumber(from) || !isNumber(to)) return MISSING;
  const ends = [Math.round(from), Math.round(to)];
  return lei(ends[0] === ends[1] ? [ends[0]] : ends, language);
}

export function formatRating(value: unknown, language: Language): string {
  return isNumber(value) ? digits(value, language, 1, 1) : MISSING;
}

export function formatNum(value: unknown, language: Language): string {
  return isNumber(value) ? digits(value, language, 0, 3) : MISSING;
}

export function formatKm(value: unknown, language: Language): string {
  return isNumber(value) ? `${digits(value, language, 0, 1)} km` : MISSING;
}

export function formatPct(value: unknown, language: Language): string {
  return isNumber(value) ? `${digits(value, language, 0, 0)}%` : MISSING;
}

const dayParts = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'numeric',
  timeZone: ZONE,
  year: 'numeric',
});
const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  timeZone: ZONE,
});

// A date, or a date and time with its offset: other strings are parsed by
// each engine its own way, and a time without an offset in the device zone.
const ISO =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

function instant(value: unknown): Date | undefined {
  const date =
    value instanceof Date
      ? value
      : (typeof value === 'string' && ISO.test(value)) || isNumber(value)
        ? new Date(value)
        : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

export function formatDay(value: unknown, language: Language): string {
  const date = instant(value);
  if (!date) return MISSING;
  const { day, month, year } = Object.fromEntries(
    dayParts.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${Number(day)} ${MONTHS_SHORT[language][Number(month) - 1]} ${year}`;
}

// Fixed like the short names, so server and browser write the same month;
// date pickers read the same list through calendarNames.
const MONTHS_LONG: Record<Language, readonly string[]> = {
  en: [
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
  ],
  ro: [
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
  ],
};

function bucharestDay(date: Date) {
  const { day, month, year } = Object.fromEntries(
    dayParts.formatToParts(date).map((p) => [p.type, Number(p.value)]),
  );
  return { day, month, year };
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

// A calendar day as UTC midnight, or undefined: Date rolls 30 February into
// March, and an expiry that does not exist must not become one that does.
function calendarDay(value: unknown): Date | undefined {
  const parts = typeof value === 'string' && CALENDAR_DAY.exec(value);
  if (!parts) return undefined;
  const [year, month, day] = parts.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : undefined;
}

export function formatMonthYear(value: unknown, language: Language): string {
  const date = calendarDay(value);
  if (!date) return MISSING;
  return `${MONTHS_LONG[language][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// Whole calendar days from today in Bucharest to an expiry day: 0 on the
// day itself, negative once it has passed, null for anything but a real day.
export function daysUntil(expiry: unknown, now: Date): number | null {
  const target = calendarDay(expiry);
  if (!target || Number.isNaN(now.getTime())) return null;
  const today = bucharestDay(now);
  return Math.round(
    (target.getTime() - Date.UTC(today.year, today.month - 1, today.day)) /
      DAY_MS,
  );
}

// One 24-hour clock in both languages.
export function formatClock(value: unknown): string {
  const date = instant(value);
  return date ? clock.format(date) : MISSING;
}

// For date pickers and other standard controls: days run from Monday.
export function calendarNames(language: Language) {
  const names = (options: Intl.DateTimeFormatOptions, dates: Date[]) => {
    const format = new Intl.DateTimeFormat(LOCALES[language], {
      ...options,
      timeZone: 'UTC',
    });
    return dates.map((d) => format.format(d));
  };
  // 5 January 2026 is a Monday.
  const week = [...Array(7).keys()].map(
    (d) => new Date(Date.UTC(2026, 0, 5 + d)),
  );
  return {
    days: names({ weekday: 'long' }, week),
    daysShort: names({ weekday: 'short' }, week),
    firstDay: 1 as const,
    months: [...MONTHS_LONG[language]],
    monthsShort: [...MONTHS_SHORT[language]],
  };
}

const JUST_NOW: Record<Language, string> = {
  en: 'a few seconds ago',
  ro: 'acum câteva secunde',
};
const RELATIVE: Record<Language, Intl.RelativeTimeFormat> = {
  en: new Intl.RelativeTimeFormat(LOCALES.en, { numeric: 'always' }),
  ro: new Intl.RelativeTimeFormat(LOCALES.ro, { numeric: 'always' }),
};
const MINUTE = 60_000;
const STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 24 * 60 * MINUTE],
  ['hour', 60 * MINUTE],
  ['minute', MINUTE],
];

// How long ago a moment was: "acum 5 minute", "3 hours ago"; under a minute
// (or a little ahead of the clock) a few seconds, and from a week on the day
// itself.
export function relativeTime(
  value: unknown,
  language: Language,
  now: Date,
): string {
  const date = instant(value);
  if (!date) return MISSING;
  const elapsed = now.getTime() - date.getTime();
  if (elapsed >= 7 * 24 * 60 * MINUTE) return formatDay(date, language);
  for (const [unit, size] of STEPS) {
    if (elapsed >= size) {
      return RELATIVE[language].format(-Math.floor(elapsed / size), unit);
    }
  }
  return JUST_NOW[language];
}

// Fixed for the same reason as the months: "joi" takes no stop.
const WEEKDAYS_SHORT: Record<Language, readonly string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ro: ['dum.', 'lun.', 'mar.', 'mie.', 'joi', 'vin.', 'sâm.'],
};
const YESTERDAY: Record<Language, string> = { en: 'yesterday', ro: 'ieri' };

// Romanian puts "de" between a number from 20 on and its noun.
const de = (count: number) => (count >= 20 ? 'de ' : '');

const AGO: Record<
  Language,
  { minutes(count: number): string; hours(count: number): string }
> = {
  en: {
    hours: (n) => `${n} ${n === 1 ? 'hour' : 'hours'} ago`,
    minutes: (n) => `${n} min ago`,
  },
  ro: {
    hours: (n) => `acum ${n} ${de(n)}${n === 1 ? 'oră' : 'ore'}`,
    minutes: (n) => `acum ${n} ${de(n)}min`,
  },
};

// A request's age on a garage's list: seconds, minutes and hours under a day;
// then yesterday or the day itself, with the Bucharest time.
export function requestAge(
  value: unknown,
  language: Language,
  now: Date,
): string {
  const date = instant(value);
  if (!date) return MISSING;
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return JUST_NOW[language];
  if (elapsed < 60 * MINUTE) {
    return AGO[language].minutes(Math.floor(elapsed / MINUTE));
  }
  if (elapsed < 24 * 60 * MINUTE) {
    return AGO[language].hours(Math.floor(elapsed / (60 * MINUTE)));
  }
  const day = bucharestDay(date);
  const today = bucharestDay(now);
  const start = Date.UTC(day.year, day.month - 1, day.day);
  const time = clock.format(date);
  if (Date.UTC(today.year, today.month - 1, today.day) - start === DAY_MS) {
    return `${YESTERDAY[language]}, ${time}`;
  }
  const weekday = WEEKDAYS_SHORT[language][new Date(start).getUTCDay()];
  return `${weekday}, ${day.day} ${MONTHS_SHORT[language][day.month - 1]}, ${time}`;
}

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

function instant(value: unknown): Date | undefined {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || isNumber(value)
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

// One 24-hour clock in both languages.
export function formatClock(value: unknown): string {
  const date = instant(value);
  return date ? clock.format(date) : MISSING;
}

export interface CalendarNames {
  firstDay: 1;
  months: string[];
  monthsShort: string[];
  days: string[];
  daysShort: string[];
}

// For date pickers and other standard controls: days run from Monday.
export function calendarNames(language: Language): CalendarNames {
  const names = (options: Intl.DateTimeFormatOptions, dates: Date[]) => {
    const format = new Intl.DateTimeFormat(LOCALES[language], {
      ...options,
      timeZone: 'UTC',
    });
    return dates.map((d) => format.format(d));
  };
  const months = [...Array(12).keys()].map(
    (m) => new Date(Date.UTC(2026, m, 15)),
  );
  // 5 January 2026 is a Monday.
  const week = [...Array(7).keys()].map(
    (d) => new Date(Date.UTC(2026, 0, 5 + d)),
  );
  return {
    days: names({ weekday: 'long' }, week),
    daysShort: names({ weekday: 'short' }, week),
    firstDay: 1,
    months: names({ month: 'long' }, months),
    monthsShort: [...MONTHS_SHORT[language]],
  };
}

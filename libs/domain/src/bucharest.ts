// Local time in Europe/Bucharest, where every MotorFix day and hour is
// counted. A day is written "2026-11-10".

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const parts = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  month: '2-digit',
  timeZone: 'Europe/Bucharest',
  timeZoneName: 'longOffset',
  year: 'numeric',
});

export function local(at: Date) {
  const read = Object.fromEntries(
    parts.formatToParts(at).map((p) => [p.type, p.value]),
  );
  // "GMT+03:00", or "GMT" at a zero offset.
  const [, sign, h, m] =
    /GMT(?:([+-])(\d\d):(\d\d))?/.exec(read['timeZoneName']) ?? [];
  const offsetMinutes = sign
    ? (sign === '-' ? -1 : 1) * (Number(h) * 60 + Number(m))
    : 0;
  return {
    day: Number(read['day']),
    hour: Number(read['hour']),
    month: Number(read['month']),
    offsetMinutes,
    year: Number(read['year']),
  };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function localDay(at: Date): string {
  const { year, month, day } = local(at);
  return iso(Date.UTC(year, month - 1, day));
}

export const addDays = (day: string, n: number) =>
  iso(Date.parse(day) + n * DAY);

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY);

// The instant the clock in Bucharest reads `hour`:00 on `day`. The offset is
// read at that hour, as it differs from the day's start across a clock change.
export function atLocal(day: string, hour: number): Date {
  const wall = Date.parse(day) + hour * HOUR;
  const guess = wall - local(new Date(wall)).offsetMinutes * 60_000;
  return new Date(wall - local(new Date(guess)).offsetMinutes * 60_000);
}

export const monthStart = (day: string) => `${day.slice(0, 8)}01`;

// The Monday of the week holding `day`.
export const weekStart = (day: string) =>
  addDays(day, -((new Date(day).getUTCDay() + 6) % 7));

// `at` plus `n` calendar days at the same Bucharest wall-clock time, so a
// week that spans a clock change is 167 or 169 hours long.
export function addLocalDays(at: Date, n: number): Date {
  const offset = (ms: number) => local(new Date(ms)).offsetMinutes * 60_000;
  const wall = at.getTime() + offset(at.getTime()) + n * DAY;
  return new Date(wall - offset(wall - offset(wall)));
}

// The ISO week holding `day`, "2026-W41": weeks start on Monday and belong to
// the year that holds their Thursday.
export function isoWeek(day: string): string {
  const thursday = addDays(weekStart(day), 3);
  const year = thursday.slice(0, 4);
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

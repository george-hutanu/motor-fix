const ZONE = 'Europe/Bucharest';
const QUIET_FROM = 22;
const QUIET_UNTIL = 8;

const parts = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  month: '2-digit',
  timeZone: ZONE,
  timeZoneName: 'longOffset',
  year: 'numeric',
});

function local(at: Date) {
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

export function isQuiet(at: Date): boolean {
  const { hour } = local(at);
  return hour >= QUIET_FROM || hour < QUIET_UNTIL;
}

export function nextMorning(at: Date): Date {
  const today = local(at);
  const dayOffset = today.hour >= QUIET_UNTIL ? 1 : 0;
  const date = new Date(
    Date.UTC(today.year, today.month - 1, today.day + dayOffset),
  );
  // The offset at 08:00 that day, which differs from now's across a clock change.
  const guess = new Date(
    date.getTime() + QUIET_UNTIL * 3_600_000 - today.offsetMinutes * 60_000,
  );
  const offset = local(guess).offsetMinutes;
  return new Date(date.getTime() + QUIET_UNTIL * 3_600_000 - offset * 60_000);
}

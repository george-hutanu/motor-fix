// The Bucharest wall clock, whatever the browser's own zone: the garages'
// days and times are told on it, and an instant sent to the API carries the
// offset Europe/Bucharest has on that date.

const QUARTER = 15;
const ZONE = 'Europe/Bucharest';

const WALL = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: ZONE,
  year: 'numeric',
});

// Bucharest's offset from UTC at an instant, in minutes.
function offsetAt(at: number): number {
  const name =
    new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(at))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const [, sign, hh, mm] = /GMT([+-])(\d{2}):(\d{2})/.exec(name) ?? [];
  if (!sign) return 0;
  return (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
}

// A Bucharest wall-clock day and time as ISO 8601 with its offset.
export function bucharestInstant(day: string, time: string): string {
  const wall = Date.parse(`${day}T${time}:00Z`);
  const offset = offsetAt(wall - offsetAt(wall) * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${day}T${time}:00${sign}${hh}:${mm}`;
}

// An instant as the day ("YYYY-MM-DD") and time ("HH:MM") on Bucharest's clock.
export function bucharestWall(instant: string): { day: string; time: string } {
  const part = (
    type: Intl.DateTimeFormatPartTypes,
    parts: Intl.DateTimeFormatPart[],
  ) => parts.find((p) => p.type === type)?.value ?? '';
  const parts = WALL.formatToParts(new Date(instant));
  return {
    day: `${part('year', parts)}-${part('month', parts)}-${part('day', parts)}`,
    time: `${part('hour', parts)}:${part('minute', parts)}`,
  };
}

// The next quarter hour on Bucharest's clock, "HH:MM", at the latest 23:45.
export function nextQuarter(): string {
  const [hh, mm] = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: ZONE,
  })
    .format(new Date())
    .split(':')
    .map(Number);
  const next = Math.min(
    Math.ceil((hh * 60 + mm + 1) / QUARTER) * QUARTER,
    24 * 60 - QUARTER,
  );
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}

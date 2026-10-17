import { bucharestDayStart } from './formats';

const parts = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: 'Europe/Bucharest',
  year: 'numeric',
});

const wall = (date: Date) =>
  Object.fromEntries(
    parts.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<'day' | 'hour' | 'minute' | 'month', string>;

const iso = (now: string) => bucharestDayStart(new Date(now)).toISOString();

// @traces 298-FR-003 298-FR-010
describe('bucharestDayStart across the clock changes', () => {
  it('is itself at exactly Bucharest midnight', () => {
    expect(iso('2026-10-16T21:00:00.000Z')).toBe('2026-10-16T21:00:00.000Z');
  });

  it('is the day before one millisecond earlier', () => {
    expect(iso('2026-10-16T20:59:59.999Z')).toBe('2026-10-15T21:00:00.000Z');
  });

  it('keeps the first instant of the day the clocks go forward', () => {
    expect(iso('2027-03-28T00:00:00.000Z')).toBe('2027-03-27T22:00:00.000Z');
    expect(iso('2027-03-28T00:59:59.999Z')).toBe('2027-03-27T22:00:00.000Z');
    expect(iso('2027-03-28T01:00:00.000Z')).toBe('2027-03-27T22:00:00.000Z');
    expect(iso('2027-03-28T20:59:59.999Z')).toBe('2027-03-27T22:00:00.000Z');
  });

  it('starts the day after the short day at the summer offset', () => {
    expect(iso('2027-03-28T21:00:00.000Z')).toBe('2027-03-28T21:00:00.000Z');
    expect(iso('2027-03-29T10:00:00.000Z')).toBe('2027-03-28T21:00:00.000Z');
  });

  it('keeps the first instant of the day the clocks go back', () => {
    expect(iso('2026-10-25T00:30:00.000Z')).toBe('2026-10-24T21:00:00.000Z');
    expect(iso('2026-10-25T01:00:00.000Z')).toBe('2026-10-24T21:00:00.000Z');
    expect(iso('2026-10-25T21:59:59.999Z')).toBe('2026-10-24T21:00:00.000Z');
  });

  it('starts the day after the long day at the winter offset', () => {
    expect(iso('2026-10-25T22:00:00.000Z')).toBe('2026-10-25T22:00:00.000Z');
    expect(iso('2026-10-26T10:00:00.000Z')).toBe('2026-10-25T22:00:00.000Z');
  });

  it('is the same as itself when applied twice', () => {
    const once = bucharestDayStart(new Date('2026-06-01T13:13:13Z'));

    expect(bucharestDayStart(once).getTime()).toBe(once.getTime());
  });

  it('is midnight on the Bucharest wall clock for every half hour of two years', () => {
    const bad: string[] = [];
    const from = Date.UTC(2026, 0, 1);
    for (let t = from; t < from + 730 * 86_400_000; t += 1_800_000) {
      const now = new Date(t);
      const start = bucharestDayStart(now);
      const w = wall(start);
      const before = wall(new Date(start.getTime() - 1));
      const sameDay = w.day === wall(now).day && w.month === wall(now).month;
      const ok =
        `${w.hour}:${w.minute}` === '00:00' &&
        sameDay &&
        before.day !== w.day &&
        start.getTime() <= t;
      if (!ok) bad.push(now.toISOString());
    }
    expect(bad).toEqual([]);
  });

  it('does not invent a valid day for an invalid date', () => {
    let result: Date | undefined;
    try {
      result = bucharestDayStart(new Date(Number.NaN));
    } catch {
      return;
    }
    expect(Number.isNaN(result.getTime())).toBe(true);
  });

  it.each([
    '1970-01-01T00:00:00Z',
    '2100-07-01T12:00:00Z',
    '2038-01-19T03:14:08Z',
  ])('is midnight on the Bucharest wall clock for %s', (now) => {
    const w = wall(bucharestDayStart(new Date(now)));

    expect(`${w.hour}:${w.minute}`).toBe('00:00');
  });
});

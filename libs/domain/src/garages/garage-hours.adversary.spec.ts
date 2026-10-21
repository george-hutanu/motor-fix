import type { Interval } from '@motor-fix/contracts';

import { spanInsideHours } from './garage-hours';
import { addDays, atLocal } from '../bucharest';

const every = (spans: Interval[]) =>
  Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, spans]),
  );

const THU = '2026-11-12';
const MINUTE = 60_000;
const at = (day: string, hour: number, minute = 0) =>
  new Date(atLocal(day, hour).getTime() + minute * MINUTE);

const inside = (
  hours: Record<string, Interval[]>,
  start: Date,
  minutes: number,
  closed: { closedDays?: string[]; holidays?: string[] } = {},
) =>
  spanInsideHours(
    hours,
    new Set(closed.closedDays ?? []),
    new Set(closed.holidays ?? []),
    start,
    minutes,
  );

// @traces 389-FR-008
describe('whether a span fits the hours, at the edges', () => {
  it('refuses a span of two adjacent intervals, since it must lie inside one', () => {
    const hours = every([
      ['08:00', '12:00'],
      ['12:00', '18:00'],
    ]);

    expect(inside(hours, at(THU, 11), 120)).toBe(false);
    expect(inside(hours, at(THU, 11), 60)).toBe(true);
    expect(inside(hours, at(THU, 12), 60)).toBe(true);
  });

  it('takes a span in an interval listed out of order', () => {
    const hours = every([
      ['13:00', '18:00'],
      ['08:00', '12:00'],
    ]);

    expect(inside(hours, at(THU, 9), 60)).toBe(true);
    expect(inside(hours, at(THU, 14), 60)).toBe(true);
    expect(inside(hours, at(THU, 12), 30)).toBe(false);
  });

  it('refuses a day whose list of intervals is empty', () => {
    expect(inside({ thu: [] }, at(THU, 9), 60)).toBe(false);
  });

  it('takes a span that starts exactly as the garage opens', () => {
    expect(inside(every([['08:00', '18:00']]), at(THU, 8), 60)).toBe(true);
  });

  it('refuses a span that starts a minute before opening and ends inside', () => {
    expect(inside(every([['08:00', '18:00']]), at(THU, 7, 59), 60)).toBe(false);
  });

  it('refuses a span that crosses midnight even when both days are open all day', () => {
    const hours = every([['00:00', '23:59']]);

    expect(inside(hours, at(THU, 23, 30), 60)).toBe(false);
  });

  it('refuses a span that starts in the evening and ends the next morning inside the next day’s hours', () => {
    const hours = every([
      ['00:00', '06:00'],
      ['20:00', '23:59'],
    ]);

    expect(inside(hours, at(THU, 23), 180)).toBe(false);
  });

  it('refuses a span that ends the day after a closed day began', () => {
    const next = addDays(THU, 1);

    expect(
      inside(every([['00:00', '23:59']]), at(THU, 23, 30), 60, {
        closedDays: [next],
      }),
    ).toBe(false);
  });

  it('judges a closed day by the Bucharest day of the start, not the UTC date', () => {
    const start = new Date('2026-11-11T22:30:00Z');
    const hours = every([['00:00', '06:00']]);

    expect(inside(hours, start, 60, { closedDays: ['2026-11-11'] })).toBe(true);
    expect(inside(hours, start, 60, { closedDays: [THU] })).toBe(false);
    expect(inside(hours, start, 60, { holidays: [THU] })).toBe(false);
  });

  it('ignores closed days and holidays that fall on other dates', () => {
    const hours = every([['08:00', '18:00']]);

    expect(
      inside(hours, at(THU, 9), 60, {
        closedDays: [addDays(THU, -1), addDays(THU, 1)],
        holidays: [addDays(THU, 7)],
      }),
    ).toBe(true);
  });

  it('refuses a holiday even for a garage with open hours all day and a closed-day set that is empty', () => {
    expect(
      inside(every([['00:00', '23:59']]), at(THU, 12), 30, {
        holidays: [THU],
      }),
    ).toBe(false);
  });

  it('refuses a garage without hours on one of its own closed days', () => {
    expect(inside({}, at(THU, 12), 30, { closedDays: [THU] })).toBe(false);
  });

  it('is the same answer asked twice', () => {
    const hours = every([['08:00', '18:00']]);

    expect(inside(hours, at(THU, 9), 60)).toBe(inside(hours, at(THU, 9), 60));
  });

  it('does not change the sets or the hours it was given', () => {
    const hours = every([['08:00', '18:00']]);
    const snapshot = JSON.stringify(hours);
    const closed = new Set([THU]);
    const holidays = new Set<string>();

    spanInsideHours(hours, closed, holidays, at(THU, 9), 60);

    expect(JSON.stringify(hours)).toBe(snapshot);
    expect([...closed]).toEqual([THU]);
    expect(holidays.size).toBe(0);
  });

  it('refuses a span of one hundred hours', () => {
    expect(inside(every([['00:00', '23:59']]), at(THU, 0), 6000)).toBe(false);
  });

  it('refuses a span starting at an invalid date', () => {
    expect(inside(every([['08:00', '18:00']]), new Date(Number.NaN), 60)).toBe(
      false,
    );
  });
});

// @traces 389-FR-008
describe('whether a span fits the hours, around the clock changes', () => {
  it('measures a span across the spring change in elapsed time', () => {
    const start = new Date('2026-03-29T00:30:00Z');

    expect(inside(every([['00:00', '05:00']]), start, 90)).toBe(true);
    expect(inside(every([['00:00', '04:30']]), start, 90)).toBe(false);
  });

  it('takes a span just before the spring change', () => {
    const start = new Date('2026-03-29T00:00:00Z');

    expect(inside(every([['02:00', '03:00']]), start, 30)).toBe(true);
  });

  it('takes a span just after the spring change on the new offset', () => {
    const start = new Date('2026-03-29T01:00:00Z');

    expect(inside(every([['04:00', '05:00']]), start, 60)).toBe(true);
    expect(inside(every([['03:00', '04:00']]), start, 60)).toBe(false);
  });

  it('measures a span across the autumn change in elapsed time', () => {
    const start = new Date('2026-10-25T00:00:00Z');

    expect(inside(every([['00:00', '04:00']]), start, 120)).toBe(true);
    expect(inside(every([['00:00', '03:30']]), start, 120)).toBe(false);
  });

  it('takes the repeated hour of the autumn change in the interval that holds it', () => {
    const second = new Date('2026-10-25T01:30:00Z');

    expect(inside(every([['03:00', '04:00']]), second, 30)).toBe(true);
  });

  it('reads the weekday of the Sunday the clocks go forward in Bucharest', () => {
    const sunday = new Date('2026-03-28T22:30:00Z');

    expect(inside({ sun: [['00:00', '06:00']] }, sunday, 60)).toBe(true);
    expect(inside({ sat: [['00:00', '06:00']] }, sunday, 60)).toBe(false);
  });
});

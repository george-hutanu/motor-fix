import type { Interval } from '@motor-fix/contracts';

import { spanInsideHours } from './garage-hours';
import { atLocal } from '../bucharest';

const every = (spans: Interval[]) =>
  Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, spans]),
  );

// A Thursday.
const THU = '2026-11-12';
const at = (hour: number, minute = 0) =>
  new Date(atLocal(THU, hour).getTime() + minute * 60_000);

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
describe('whether a booking fits the garage’s hours', () => {
  it('takes a span inside one interval of the slot’s Bucharest weekday', () => {
    expect(inside(every([['08:00', '18:00']]), at(9), 90)).toBe(true);
  });

  it('takes a span that ends as the garage closes, and refuses one a minute longer', () => {
    const hours = every([['08:00', '18:00']]);

    expect(inside(hours, at(16, 30), 90)).toBe(true);
    expect(inside(hours, at(16, 31), 90)).toBe(false);
  });

  it('refuses a span that starts before opening', () => {
    expect(inside(every([['08:00', '18:00']]), at(7, 30), 60)).toBe(false);
  });

  it('refuses a span across the lunch break of a split day, taking one in either half', () => {
    const hours = every([
      ['08:00', '12:00'],
      ['13:00', '18:00'],
    ]);

    expect(inside(hours, at(11), 90)).toBe(false);
    expect(inside(hours, at(10, 30), 90)).toBe(true);
    expect(inside(hours, at(13), 90)).toBe(true);
  });

  it('reads the weekday in Bucharest, not in UTC', () => {
    const thursdayOnly = { thu: [['00:00', '23:45']] as Interval[] };

    expect(inside(thursdayOnly, at(0, 30), 60)).toBe(true);
  });

  it('refuses a span that runs past midnight', () => {
    expect(inside(every([['00:00', '23:45']]), at(23), 90)).toBe(false);
  });

  it('refuses a day the garage has no hours for', () => {
    expect(inside({ mon: [['08:00', '18:00']] }, at(9), 60)).toBe(false);
  });

  it('reads the hours by the local clock on the day the clocks go back', () => {
    const sunday = atLocal('2026-10-25', 9);

    expect(inside(every([['08:00', '18:00']]), sunday, 90)).toBe(true);
    expect(inside(every([['10:00', '18:00']]), sunday, 90)).toBe(false);
  });

  it('refuses one of the garage’s closed days and a public holiday', () => {
    const hours = every([['08:00', '18:00']]);

    expect(inside(hours, at(9), 60, { closedDays: [THU] })).toBe(false);
    expect(inside(hours, at(9), 60, { holidays: [THU] })).toBe(false);
  });

  it('takes any span of a garage that has not set its hours, but not on a holiday', () => {
    expect(inside({}, at(23), 90)).toBe(true);
    expect(inside({}, at(9), 60, { holidays: [THU] })).toBe(false);
  });
});

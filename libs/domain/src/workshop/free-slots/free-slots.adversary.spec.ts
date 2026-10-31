import type { Interval, WeeklyHours } from '@motor-fix/contracts';

import { type FreeSlotsInput, freeSlots } from './free-slots';
import { atLocal } from '../../bucharest';

const MON = '2026-11-09';
const MINUTE = 60_000;
const at = (day: string, hour: number, minute = 0) =>
  new Date(atLocal(day, hour).getTime() + minute * MINUTE);

const week = (day: Interval[]): WeeklyHours => ({
  fri: day,
  mon: day,
  sat: [],
  sun: [],
  thu: day,
  tue: day,
  wed: day,
});
const schedule = () => ({
  daysOff: [],
  workingHours: week([['08:00', '16:30']]),
  worksSaturdays: false,
});
const input = (over: Partial<FreeSlotsInput> = {}): FreeSlotsInput => ({
  awaiting: [],
  calendar: {
    closedDays: new Set<string>(),
    holidays: new Set<string>(),
    hours: week([['08:00', '18:00']]),
  },
  count: 3,
  durationMinutes: 60,
  earliest: at(MON, 8),
  horizonDays: 1,
  liftCount: 1,
  mechanics: [{ id: 'elena', schedule: schedule() }],
  needsLift: false,
  segments: [],
  switches: { lifts: true, team: true },
  ...over,
});
const starts = (over: Partial<FreeSlotsInput> = {}) =>
  freeSlots(input(over)).slots.map((slot) => slot.startsAt);
const held = (
  startsAt: Date,
  endsAt: Date,
  over: {
    bookingId?: string | null;
    lift?: number | null;
    mechanicId?: string | null;
  } = {},
) => ({
  bookingId: null,
  endsAt,
  lift: null,
  mechanicId: null,
  startsAt,
  ...over,
});
const waiting = (bookingId: string, startsAt: Date, endsAt: Date) => ({
  bookingId,
  endsAt,
  needsLift: false,
  startsAt,
});

// @traces 154-FR-004
describe('the engine at its limits', () => {
  it('answers nothing for a count of zero', () => {
    expect(starts({ count: 0 })).toEqual([]);
  });

  it('answers nothing for a horizon of zero days', () => {
    expect(starts({ horizonDays: 0 })).toEqual([]);
  });

  it('answers nothing when the team is on and has no cards', () => {
    expect(starts({ mechanics: [] })).toEqual([]);
  });

  it('answers nothing for a named mechanic who is not on the team', () => {
    expect(starts({ mechanicId: 'ghost' })).toEqual([]);
  });

  it('offers a job that ends exactly at her closing and not one minute later', () => {
    expect(
      starts({ count: 10, durationMinutes: 60, earliest: at(MON, 15, 30) }),
    ).toEqual([at(MON, 15, 30)]);
    expect(
      starts({ count: 10, durationMinutes: 61, earliest: at(MON, 15, 30) }),
    ).toEqual([]);
  });

  it('rounds an earliest a second past the mark up to the next half hour', () => {
    const earliest = new Date(at(MON, 9).getTime() + 1_000);

    expect(starts({ count: 1, earliest })).toEqual([at(MON, 9, 30)]);
  });

  it('rounds an earliest a millisecond past the mark up to the next half hour', () => {
    const earliest = new Date(at(MON, 9).getTime() + 1);

    expect(starts({ count: 1, earliest })).toEqual([at(MON, 9, 30)]);
  });

  it('answers nothing when the earliest start is after the day ends', () => {
    expect(starts({ earliest: at(MON, 23) })).toEqual([]);
  });

  it('never repeats a start and stays on the grid for a count past the day', () => {
    const slots = starts({ count: 100, durationMinutes: 15 });

    expect(slots.length).toBeLessThanOrEqual(20);
    expect(new Set(slots.map((s) => s.getTime())).size).toBe(slots.length);
  });

  it('answers nothing for a 2400-minute job inside a one-day horizon', () => {
    expect(starts({ durationMinutes: 2400 })).toEqual([]);
  });

  it('offers a 2400-minute job across a 30-day horizon ending after it starts by at least the job', () => {
    const { slots } = freeSlots(
      input({ count: 1, durationMinutes: 2400, horizonDays: 30 }),
    );

    expect(slots).toHaveLength(1);
    expect(slots[0].endsAt.getTime()).toBeGreaterThanOrEqual(
      slots[0].startsAt.getTime() + 2400 * MINUTE,
    );
  });
});

// @traces 154-FR-008
describe('the engine against odd bookings', () => {
  it('lets a lift segment numbered past the lift count hold nothing', () => {
    const segments = [held(at(MON, 8), at(MON, 18), { lift: 9 })];

    expect(starts({ count: 1, needsLift: true, segments })).toEqual([
      at(MON, 8),
    ]);
  });

  it('answers as if nothing were excluded when the excluded booking matches nothing', () => {
    expect(starts({ excludeBookingId: 'nobody' })).toEqual(starts({}));
  });

  it('never lets an absent excluded id free a time block', () => {
    const segments = [held(at(MON, 8), at(MON, 18), { mechanicId: 'elena' })];

    expect(starts({ excludeBookingId: undefined, segments })).toEqual([]);
  });

  it('counts two awaiting bookings over the same hour as two mechanics taken', () => {
    const awaiting = [
      waiting('a', at(MON, 8), at(MON, 9)),
      waiting('b', at(MON, 8), at(MON, 9)),
    ];

    expect(starts({ awaiting, count: 1 })).toEqual([at(MON, 9)]);
  });

  it('ignores an awaiting booking that ends exactly at the start', () => {
    const awaiting = [waiting('a', at(MON, 7), at(MON, 8))];

    expect(starts({ awaiting, count: 1 })).toEqual([at(MON, 8)]);
  });

  it('answers the same for the segments in either order', () => {
    const one = held(at(MON, 9), at(MON, 10), {
      bookingId: 'x',
      lift: 1,
      mechanicId: 'elena',
    });
    const two = held(at(MON, 12), at(MON, 13), { mechanicId: 'elena' });

    expect(starts({ segments: [one, two] })).toEqual(
      starts({ segments: [two, one] }),
    );
  });

  it('copes with ten thousand segments before the day and keeps the answer', () => {
    const segments = Array.from({ length: 10_000 }, (_, i) =>
      held(at(MON, 7), at(MON, 7, 30), {
        bookingId: `b${i}`,
        mechanicId: 'elena',
      }),
    );

    expect(starts({ count: 1, segments })).toEqual([at(MON, 8)]);
  });

  it('ignores the segments of a mechanic who is not on the team', () => {
    const segments = [held(at(MON, 8), at(MON, 18), { mechanicId: 'removed' })];

    expect(starts({ count: 1, segments })).toEqual([at(MON, 8)]);
  });
});

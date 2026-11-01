import type { Interval, WeeklyHours } from '@motor-fix/contracts';

import { type FreeSlotsInput, freeSlots } from './free-slots';
import { atLocal } from '../../bucharest';
import type { MechanicSchedule } from '../../garages/mechanic-hours';

const MON = '2026-11-09';
const TUE = '2026-11-10';
const WED = '2026-11-11';
const THU = '2026-11-12';
const SAT = '2026-11-14';
const at = (day: string, hour: number, minute = 0) =>
  new Date(atLocal(day, hour).getTime() + minute * 60_000);
const MINUTE = 60_000;

const week = (
  day: Interval[],
  extra: Partial<WeeklyHours> = {},
): WeeklyHours => ({
  fri: day,
  mon: day,
  sat: [],
  sun: [],
  thu: day,
  tue: day,
  wed: day,
  ...extra,
});
const GARAGE = week([['08:00', '18:00']], { sat: [['09:00', '14:00']] });

const calendar = (
  extra: { closedDays?: string[]; holidays?: string[]; hours?: object } = {},
) => ({
  closedDays: new Set(extra.closedDays ?? []),
  holidays: new Set(extra.holidays ?? []),
  hours: (extra.hours ?? GARAGE) as WeeklyHours,
});
const mechanic = (id: string, extra: Partial<MechanicSchedule> = {}) => ({
  id,
  schedule: {
    daysOff: [],
    workingHours: week([['08:00', '16:30']]),
    worksSaturdays: false,
    ...extra,
  },
});
const segment = (
  startsAt: Date,
  endsAt: Date,
  hold: { mechanicId?: string; lift?: number; bookingId?: string } = {},
) => ({
  bookingId: hold.bookingId ?? null,
  endsAt,
  lift: hold.lift ?? null,
  mechanicId: hold.mechanicId ?? null,
  startsAt,
});
const awaiting = (
  bookingId: string,
  startsAt: Date,
  endsAt: Date,
  needsLift = false,
) => ({ bookingId, endsAt, needsLift, startsAt });

const input = (over: Partial<FreeSlotsInput> = {}): FreeSlotsInput => ({
  awaiting: [],
  calendar: calendar(),
  count: 1,
  durationMinutes: 60,
  earliest: at(MON, 8),
  horizonDays: 1,
  liftCount: 2,
  mechanics: [mechanic('elena')],
  needsLift: false,
  segments: [],
  switches: { lifts: true, team: true },
  ...over,
});
const starts = (over: Partial<FreeSlotsInput> = {}) =>
  freeSlots(input(over)).slots.map((slot) => slot.startsAt);

// @traces 154-FR-004
// @traces 154-FR-008
describe('free starts against mechanics and lifts', () => {
  it('gives the first starts in time order, each free for a mechanic and a lift over the whole job', () => {
    const { slots } = freeSlots(
      input({
        count: 3,
        durationMinutes: 120,
        earliest: at(TUE, 13, 40),
        horizonDays: 2,
        liftCount: 3,
        mechanics: [
          mechanic('elena'),
          mechanic('mihai', { workingHours: week([['08:00', '18:00']]) }),
        ],
        needsLift: true,
        segments: [
          segment(at(TUE, 13), at(TUE, 15), { lift: 1, mechanicId: 'mihai' }),
          segment(at(TUE, 17), at(TUE, 18), { lift: 2, mechanicId: 'mihai' }),
          segment(at(TUE, 13), at(TUE, 16, 30), {
            lift: 3,
            mechanicId: 'elena',
          }),
          segment(at(WED, 8), at(WED, 10, 30), {
            lift: 1,
            mechanicId: 'elena',
          }),
          segment(at(WED, 8), at(WED, 10, 30), {
            lift: 2,
            mechanicId: 'mihai',
          }),
        ],
      }),
    );

    expect(slots).toEqual([
      { endsAt: at(TUE, 17), startsAt: at(TUE, 15) },
      { endsAt: at(WED, 12, 30), startsAt: at(WED, 10, 30) },
      { endsAt: at(WED, 13), startsAt: at(WED, 11) },
    ]);
  });

  it('skips a start where every mechanic is busy, even with the lifts free', () => {
    expect(
      starts({
        segments: [segment(at(MON, 8), at(MON, 10), { mechanicId: 'elena' })],
      }),
    ).toEqual([at(MON, 10)]);
  });

  it('skips a start where every lift is busy when the job needs one, and keeps it when it does not', () => {
    const busyLift = {
      liftCount: 1,
      mechanics: [mechanic('elena'), mechanic('mihai')],
      segments: [
        segment(at(MON, 8), at(MON, 10), { lift: 1, mechanicId: 'mihai' }),
      ],
    };

    expect(starts({ ...busyLift, needsLift: true })).toEqual([at(MON, 10)]);
    expect(starts({ ...busyLift, needsLift: false })).toEqual([at(MON, 8)]);
  });

  it('ignores the lifts entirely with the lift schedule off', () => {
    expect(
      starts({
        liftCount: 1,
        needsLift: true,
        segments: [segment(at(MON, 8), at(MON, 10), { lift: 1 })],
        switches: { lifts: false, team: true },
      }),
    ).toEqual([at(MON, 8)]);
  });

  it('ignores the lifts entirely when the garage has none', () => {
    expect(starts({ liftCount: 0, needsLift: true })).toEqual([at(MON, 8)]);
  });

  it('counts only the lifts numbered up to the lift count', () => {
    expect(
      starts({
        liftCount: 1,
        needsLift: true,
        segments: [segment(at(MON, 8), at(MON, 10), { lift: 2 })],
      }),
    ).toEqual([at(MON, 8)]);
  });

  it('treats a segment ending at the start as no overlap', () => {
    expect(
      starts({
        earliest: at(MON, 10),
        segments: [segment(at(MON, 8), at(MON, 10), { mechanicId: 'elena' })],
      }),
    ).toEqual([at(MON, 10)]);
  });
});

// @traces 154-FR-005
// @traces 154-FR-006
describe('free starts against working hours and the calendar', () => {
  it('does not let a job that fits in one working day run past her end', () => {
    expect(
      starts({ count: 3, durationMinutes: 120, earliest: at(MON, 14) }),
    ).toEqual([at(MON, 14), at(MON, 14, 30)]);
  });

  it('offers nothing on her day off', () => {
    expect(
      starts({
        horizonDays: 2,
        mechanics: [
          mechanic('elena', { daysOff: [{ firstDay: MON, lastDay: MON }] }),
        ],
      }),
    ).toEqual([at(TUE, 8)]);
  });

  it('offers nothing on a garage closed day', () => {
    expect(
      starts({ calendar: calendar({ closedDays: [MON] }), horizonDays: 2 }),
    ).toEqual([at(TUE, 8)]);
  });

  it('offers nothing on a legal holiday such as 1 December', () => {
    expect(
      starts({
        calendar: calendar({ holidays: ['2026-12-01'] }),
        earliest: at('2026-12-01', 8),
        horizonDays: 2,
      }),
    ).toEqual([at('2026-12-02', 8)]);
  });

  it('still counts the other mechanic on one mechanic’s day off', () => {
    expect(
      starts({
        mechanics: [
          mechanic('elena', { daysOff: [{ firstDay: MON, lastDay: MON }] }),
          mechanic('mihai'),
        ],
      }),
    ).toEqual([at(MON, 8)]);
  });

  it('counts nobody on Saturday without works Saturdays', () => {
    expect(starts({ count: 10, earliest: at(SAT, 8) })).toEqual([]);
  });

  it('counts a mechanic who works Saturdays within her Saturday hours', () => {
    expect(
      starts({
        count: 10,
        earliest: at(SAT, 8),
        mechanics: [
          mechanic('elena', {
            workingHours: week([['08:00', '16:30']], {
              sat: [['10:00', '13:00']],
            }),
            worksSaturdays: true,
          }),
        ],
      }),
    ).toEqual([
      at(SAT, 10),
      at(SAT, 10, 30),
      at(SAT, 11),
      at(SAT, 11, 30),
      at(SAT, 12),
    ]);
  });

  it("follows the garage's weekdays for a mechanic with no hours of her own", () => {
    const own = { mechanics: [mechanic('elena', { workingHours: null })] };

    expect(starts({ ...own, count: 3, earliest: at(MON, 17) })).toEqual([
      at(MON, 17),
    ]);
  });

  it('never counts a mechanic with no hours of her own on Saturday, even when the garage opens', () => {
    expect(
      starts({
        count: 10,
        earliest: at(SAT, 8),
        mechanics: [
          mechanic('elena', { workingHours: null, worksSaturdays: true }),
        ],
      }),
    ).toEqual([]);
  });

  it('offers nothing when neither the garage nor the mechanic has hours stored', () => {
    expect(
      freeSlots(
        input({
          calendar: calendar({ hours: {} }),
          count: 10,
          horizonDays: 30,
          mechanics: [mechanic('elena', { workingHours: null })],
        }),
      ).slots,
    ).toEqual([]);
  });

  it('counts a mechanic with hours of her own while the garage has none', () => {
    expect(starts({ calendar: calendar({ hours: {} }) })).toEqual([at(MON, 8)]);
  });

  it('offers nothing when no start in the horizon is free', () => {
    expect(
      freeSlots(
        input({
          count: 3,
          horizonDays: 5,
          mechanics: [
            mechanic('elena', { daysOff: [{ firstDay: MON, lastDay: SAT }] }),
          ],
        }),
      ).slots,
    ).toEqual([]);
  });
});

// @traces 154-FR-006
describe('a job longer than a working day', () => {
  const long = { durationMinutes: 600, earliest: at(MON, 15) };

  it('continues in her next working stretches and ends at the last one', () => {
    expect(
      freeSlots(input({ ...long, count: 3, horizonDays: 2 })).slots,
    ).toEqual([{ endsAt: at(TUE, 16, 30), startsAt: at(MON, 15) }]);
  });

  it('is offered only when the chain ends inside the horizon', () => {
    const { slots } = freeSlots(input({ ...long, count: 2, horizonDays: 3 }));

    expect(slots).toEqual([
      { endsAt: at(TUE, 16, 30), startsAt: at(MON, 15) },
      { endsAt: at(WED, 8, 30), startsAt: at(MON, 15, 30) },
    ]);
  });

  it('is not offered when a segment takes any stretch of the chain', () => {
    expect(
      starts({
        ...long,
        horizonDays: 2,
        segments: [segment(at(TUE, 12), at(TUE, 13), { mechanicId: 'elena' })],
      }),
    ).toEqual([]);
  });

  it('is not offered when an awaiting booking takes the last mechanic in any stretch of the chain', () => {
    expect(
      starts({
        ...long,
        awaiting: [awaiting('b1', at(TUE, 12), at(TUE, 13))],
        horizonDays: 2,
      }),
    ).toEqual([]);
  });

  it('needs one lift free over the whole chain', () => {
    const lifts = { ...long, horizonDays: 2, needsLift: true };
    const liftOneTuesday = segment(at(TUE, 9), at(TUE, 10), { lift: 1 });

    expect(
      starts({
        ...lifts,
        segments: [
          liftOneTuesday,
          segment(at(MON, 15), at(MON, 16), { lift: 2 }),
        ],
      }),
    ).toEqual([]);
    expect(starts({ ...lifts, segments: [liftOneTuesday] })).toEqual([
      at(MON, 15),
    ]);
  });

  it('ends at the earliest chain end among the free mechanics, or the named one’s', () => {
    const team = {
      ...long,
      horizonDays: 3,
      mechanics: [
        mechanic('elena'),
        mechanic('mihai', { workingHours: week([['08:00', '17:00']]) }),
      ],
    };

    expect(freeSlots(input(team)).slots).toEqual([
      { endsAt: at(TUE, 16), startsAt: at(MON, 15) },
    ]);
    expect(freeSlots(input({ ...team, mechanicId: 'elena' })).slots).toEqual([
      { endsAt: at(TUE, 16, 30), startsAt: at(MON, 15) },
    ]);
  });
});

// @traces 154-FR-004
// @traces 154-FR-007
describe('awaiting bookings, the named mechanic and the excluded booking', () => {
  const pair = { mechanics: [mechanic('elena'), mechanic('mihai')] };

  it('takes one mechanic unit for an awaiting booking over the start', () => {
    expect(
      starts({ awaiting: [awaiting('b1', at(MON, 8), at(MON, 10))] }),
    ).toEqual([at(MON, 10)]);
    expect(
      starts({ ...pair, awaiting: [awaiting('b1', at(MON, 8), at(MON, 10))] }),
    ).toEqual([at(MON, 8)]);
  });

  it('counts an awaiting booking against the mechanics left free by the segments', () => {
    expect(
      starts({
        ...pair,
        awaiting: [awaiting('b1', at(MON, 8), at(MON, 10))],
        segments: [segment(at(MON, 8), at(MON, 10), { mechanicId: 'mihai' })],
      }),
    ).toEqual([at(MON, 10)]);
  });

  it('takes one lift unit only when the awaiting booking’s jobs need a lift', () => {
    const oneLift = { ...pair, liftCount: 1, needsLift: true };

    expect(
      starts({
        ...oneLift,
        awaiting: [awaiting('b1', at(MON, 8), at(MON, 10), true)],
      }),
    ).toEqual([at(MON, 10)]);
    expect(
      starts({
        ...oneLift,
        awaiting: [awaiting('b1', at(MON, 8), at(MON, 10), false)],
      }),
    ).toEqual([at(MON, 8)]);
    expect(
      starts({
        ...oneLift,
        awaiting: [awaiting('b1', at(MON, 8), at(MON, 10), true)],
        needsLift: false,
      }),
    ).toEqual([at(MON, 8)]);
  });

  it('returns only the starts at which the named mechanic is free', () => {
    const team = {
      mechanics: [mechanic('elena'), mechanic('costel')],
      segments: [segment(at(MON, 8), at(MON, 10), { mechanicId: 'costel' })],
    };

    expect(starts({ ...team, mechanicId: 'costel' })).toEqual([at(MON, 10)]);
    expect(starts(team)).toEqual([at(MON, 8)]);
  });

  it('lets the excluded booking’s own segments and awaiting row not block', () => {
    const own = segment(at(MON, 8), at(MON, 10), {
      bookingId: 'b1',
      lift: 1,
      mechanicId: 'elena',
    });
    const pending = awaiting('b2', at(MON, 8), at(MON, 10), true);

    expect(starts({ excludeBookingId: 'b1', segments: [own] })).toEqual([
      at(MON, 8),
    ]);
    expect(starts({ awaiting: [pending], excludeBookingId: 'b2' })).toEqual([
      at(MON, 8),
    ]);
    expect(starts({ excludeBookingId: 'b9', segments: [own] })).toEqual([
      at(MON, 10),
    ]);
  });

  it('keeps a time block blocking whatever booking is excluded', () => {
    expect(
      starts({
        excludeBookingId: 'b1',
        segments: [segment(at(MON, 8), at(MON, 10), { mechanicId: 'elena' })],
      }),
    ).toEqual([at(MON, 10)]);
  });
});

// @traces 154-FR-004
describe('time blocked for walk-ins', () => {
  const thursday = {
    earliest: at(THU, 10),
    mechanics: [mechanic('elena'), mechanic('mihai')],
    needsLift: true,
  };
  const mihaiAndLiftTwo = segment(at(THU, 10), at(THU, 11, 30), {
    lift: 2,
    mechanicId: 'mihai',
  });

  it('keeps the blocked mechanic and lift out and still offers the others', () => {
    expect(starts({ ...thursday, segments: [mihaiAndLiftTwo] })).toEqual([
      at(THU, 10),
    ]);
  });

  it('takes a lift with a block on that lift alone', () => {
    expect(
      starts({
        ...thursday,
        segments: [
          mihaiAndLiftTwo,
          segment(at(THU, 10), at(THU, 11, 30), { lift: 1 }),
        ],
      }),
    ).toEqual([at(THU, 11, 30)]);
  });

  it('takes a mechanic with a block on that mechanic alone', () => {
    expect(
      starts({
        earliest: at(THU, 10),
        segments: [
          segment(at(THU, 10), at(THU, 11, 30), { mechanicId: 'elena' }),
        ],
      }),
    ).toEqual([at(THU, 11, 30)]);
  });
});

// @traces 154-FR-009
describe('a garage without the team', () => {
  const solo = {
    earliest: at(MON, 10),
    mechanics: [],
    switches: { lifts: true, team: false },
  };

  it('offers a start while one lift is free, whatever the owner’s other bookings', () => {
    expect(
      starts({
        ...solo,
        needsLift: true,
        segments: [segment(at(MON, 10), at(MON, 11), { lift: 1 })],
      }),
    ).toEqual([at(MON, 10)]);
  });

  it('skips a start where every lift is busy when the job needs one', () => {
    const bothLifts = [
      segment(at(MON, 10), at(MON, 11), { lift: 1 }),
      segment(at(MON, 10), at(MON, 11), { lift: 2 }),
    ];

    expect(starts({ ...solo, needsLift: true, segments: bothLifts })).toEqual([
      at(MON, 11),
    ]);
    expect(starts({ ...solo, needsLift: false, segments: bothLifts })).toEqual([
      at(MON, 10),
    ]);
  });

  it('ignores the segments and the cards of mechanics', () => {
    expect(
      starts({
        ...solo,
        mechanics: [mechanic('elena')],
        segments: [segment(at(MON, 10), at(MON, 11), { mechanicId: 'elena' })],
      }),
    ).toEqual([at(MON, 10)]);
  });

  it("keeps the whole job inside the garage's opening hours", () => {
    expect(starts({ ...solo, count: 3, earliest: at(MON, 17) })).toEqual([
      at(MON, 17),
    ]);
  });

  it('lets an awaiting booking take a lift unit, never a mechanic unit', () => {
    const oneLift = { ...solo, liftCount: 1, needsLift: true };

    expect(
      starts({
        ...oneLift,
        awaiting: [awaiting('b1', at(MON, 10), at(MON, 11), true)],
      }),
    ).toEqual([at(MON, 11)]);
    expect(
      starts({
        ...oneLift,
        awaiting: [awaiting('b1', at(MON, 10), at(MON, 11), false)],
      }),
    ).toEqual([at(MON, 10)]);
  });

  it('offers nothing when the garage has no opening hours stored', () => {
    expect(
      starts({
        ...solo,
        calendar: calendar({ hours: {} }),
        count: 3,
        horizonDays: 30,
      }),
    ).toEqual([]);
  });

  it('offers nothing on a closed day or a holiday', () => {
    expect(
      starts({
        ...solo,
        calendar: calendar({ closedDays: [MON], holidays: [TUE] }),
        horizonDays: 3,
      }),
    ).toEqual([at(WED, 8)]);
  });
});

// @traces 154-FR-010
describe('the step grid and the horizon', () => {
  it('rounds the earliest start up to the next 30-minute step', () => {
    expect(starts({ earliest: at(MON, 8, 10) })).toEqual([at(MON, 8, 30)]);
    expect(starts({ earliest: at(MON, 8, 59) })).toEqual([at(MON, 9)]);
  });

  it('offers a start exactly at an earliest that is on the grid', () => {
    expect(starts({ earliest: at(MON, 9) })).toEqual([at(MON, 9)]);
  });

  it('puts every start on the wall-clock grid, even when her day starts off it', () => {
    expect(
      starts({
        count: 2,
        mechanics: [
          mechanic('elena', { workingHours: week([['08:15', '16:30']]) }),
        ],
      }),
    ).toEqual([at(MON, 8, 30), at(MON, 9)]);
  });

  it('stops at the count', () => {
    expect(starts({ count: 4 })).toEqual([
      at(MON, 8),
      at(MON, 8, 30),
      at(MON, 9),
      at(MON, 9, 30),
    ]);
  });

  it("counts the horizon from the earliest start's day, that day being the first", () => {
    expect(starts({ earliest: at(MON, 20), horizonDays: 1 })).toEqual([]);
    expect(starts({ earliest: at(MON, 20), horizonDays: 2 })).toEqual([
      at(TUE, 8),
    ]);
  });

  it('offers no start after the last day of the horizon', () => {
    expect(starts({ count: 10, earliest: at(TUE, 14) })).toEqual([
      at(TUE, 14),
      at(TUE, 14, 30),
      at(TUE, 15),
      at(TUE, 15, 30),
    ]);
  });

  it.each([
    ['gains two steps on the 25-hour day', '2026-10-25', 10],
    ['loses two steps on the 23-hour day', '2026-03-29', 6],
  ])('follows the wall clock and %s', (_, day, steps) => {
    const { slots } = freeSlots(
      input({
        calendar: calendar({
          hours: week([['08:00', '18:00']], { sun: [['02:00', '06:00']] }),
        }),
        count: 10,
        durationMinutes: 30,
        earliest: atLocal(day, 0),
        mechanics: [],
        switches: { lifts: false, team: false },
      }),
    );

    expect(slots).toHaveLength(steps);
    for (const [index, slot] of slots.entries()) {
      expect(slot.startsAt.getUTCMinutes() % 30).toBe(0);
      expect(slot.endsAt.getTime() - slot.startsAt.getTime()).toBe(30 * MINUTE);
      if (index > 0) {
        expect(
          slot.startsAt.getTime() - slots[index - 1].startsAt.getTime(),
        ).toBe(30 * MINUTE);
      }
    }
  });
});

// @traces 154-FR-018
describe('the engine as a pure function', () => {
  it('answers the same question twice the same way and leaves its input alone', () => {
    const question = input({
      awaiting: [awaiting('b1', at(MON, 8), at(MON, 9))],
      count: 5,
      segments: [segment(at(MON, 9), at(MON, 10), { mechanicId: 'elena' })],
    });
    const before = structuredClone(question);

    expect(freeSlots(question)).toEqual(freeSlots(question));
    expect(question).toEqual(before);
  });
});

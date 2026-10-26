import type { Interval, WeeklyHours } from '@motor-fix/contracts';

import {
  effectiveHours,
  isDayOff,
  type MechanicSchedule,
  mechanicAtWork,
  mechanicOwnAtWork,
  plannedMinutes,
  workingStretches,
} from './mechanic-hours';
import { atLocal } from '../bucharest';

const SPLIT: Interval[] = [
  ['08:00', '12:00'],
  ['13:00', '18:00'],
];
const GARAGE: WeeklyHours = {
  fri: SPLIT,
  mon: SPLIT,
  sat: [['09:00', '15:00']],
  sun: [['10:00', '14:00']],
  thu: SPLIT,
  tue: SPLIT,
  wed: SPLIT,
};
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

const MON = '2026-11-09';
const THU = '2026-11-12';
const SAT = '2026-11-14';
const at = (day: string, hour: number, minute = 0) =>
  new Date(atLocal(day, hour).getTime() + minute * 60_000);

const schedule = (extra: Partial<MechanicSchedule> = {}): MechanicSchedule => ({
  daysOff: [],
  workingHours: week([['08:00', '16:30']]),
  worksSaturdays: false,
  ...extra,
});
const calendar = (
  extra: { closedDays?: string[]; holidays?: string[] } = {},
) => ({
  closedDays: new Set(extra.closedDays ?? []),
  holidays: new Set(extra.holidays ?? []),
  hours: GARAGE,
});

// @traces 058-FR-002
describe("a mechanic's effective hours", () => {
  it("reads no hours as the garage's weekdays, each from first opening to last closing, and no weekend", () => {
    expect(effectiveHours(null, GARAGE)).toEqual(week([['08:00', '18:00']]));
  });

  it('reads garage hours that were never set as an empty week', () => {
    expect(effectiveHours(null, {})).toEqual(week([]));
  });

  it('reads a day stored with two intervals as one stretch', () => {
    expect(effectiveHours(week(SPLIT), GARAGE)).toEqual(
      week([['08:00', '18:00']]),
    );
  });

  it('reads set hours as they are', () => {
    const own = week([['09:00', '15:00']], { sat: [['09:00', '14:00']] });

    expect(effectiveHours(own, GARAGE)).toEqual(own);
  });
});

// @traces 058-FR-003 058-FR-011
describe('whether a mechanic is at work by her own schedule', () => {
  it('takes a span inside her stretch, up to its ends', () => {
    expect(mechanicOwnAtWork(schedule(), GARAGE, at(THU, 8), 60)).toBe(true);
    expect(mechanicOwnAtWork(schedule(), GARAGE, at(THU, 15, 30), 60)).toBe(
      true,
    );
  });

  it('refuses a span starting before her stretch or ending after it', () => {
    expect(mechanicOwnAtWork(schedule(), GARAGE, at(THU, 7, 45), 60)).toBe(
      false,
    );
    expect(mechanicOwnAtWork(schedule(), GARAGE, at(THU, 15, 45), 60)).toBe(
      false,
    );
  });

  it('refuses a day she does not work', () => {
    const offMonday = schedule({
      workingHours: week([['08:00', '16:30']], { mon: [] }),
    });

    expect(mechanicOwnAtWork(offMonday, GARAGE, at(MON, 9), 60)).toBe(false);
  });

  it('counts a Saturday stretch only while she works Saturdays', () => {
    const hours = week([['08:00', '16:30']], { sat: [['09:00', '14:00']] });

    expect(
      mechanicOwnAtWork(
        schedule({ workingHours: hours }),
        GARAGE,
        at(SAT, 10),
        60,
      ),
    ).toBe(false);
    expect(
      mechanicOwnAtWork(
        schedule({ workingHours: hours, worksSaturdays: true }),
        GARAGE,
        at(SAT, 10),
        60,
      ),
    ).toBe(true);
  });

  it('refuses a span on one of her days off, and takes the day after', () => {
    const away = schedule({
      daysOff: [{ firstDay: '2026-11-11', lastDay: THU }],
    });

    expect(mechanicOwnAtWork(away, GARAGE, at(THU, 9), 60)).toBe(false);
    expect(mechanicOwnAtWork(away, GARAGE, at('2026-11-13', 9), 60)).toBe(true);
  });

  it('refuses a span crossing midnight', () => {
    const late = schedule({ workingHours: week([['00:00', '23:45']]) });

    expect(mechanicOwnAtWork(late, GARAGE, at(THU, 23), 120)).toBe(false);
  });

  it("follows the garage's weekdays while she has no hours of her own", () => {
    const fallback = schedule({ workingHours: null });

    expect(mechanicOwnAtWork(fallback, GARAGE, at(THU, 17), 60)).toBe(true);
    expect(mechanicOwnAtWork(fallback, GARAGE, at(SAT, 10), 60)).toBe(false);
  });

  it('takes any span while neither she nor the garage has set hours', () => {
    expect(
      mechanicOwnAtWork(schedule({ workingHours: null }), {}, at(SAT, 22), 60),
    ).toBe(true);
  });

  it('keeps her stretch on the wall clock across the March and October clock changes', () => {
    const sundays = schedule({
      workingHours: week([], { sun: [['08:00', '12:00']] }),
    });

    for (const day of ['2026-03-29', '2026-10-25']) {
      expect(mechanicOwnAtWork(sundays, GARAGE, at(day, 9), 180)).toBe(true);
      expect(mechanicOwnAtWork(sundays, GARAGE, at(day, 9), 181)).toBe(false);
    }
  });
});

// @traces 058-FR-011
describe('whether a mechanic is at work', () => {
  it("needs both the garage's hours and her own", () => {
    const early = schedule({ workingHours: week([['07:00', '16:30']]) });

    expect(mechanicAtWork(schedule(), calendar(), at(THU, 9), 60)).toBe(true);
    expect(mechanicAtWork(early, calendar(), at(THU, 7), 60)).toBe(false);
    expect(mechanicAtWork(schedule(), calendar(), at(THU, 12), 60)).toBe(false);
  });

  it("refuses the garage's closed day and a legal holiday", () => {
    expect(
      mechanicAtWork(
        schedule(),
        calendar({ closedDays: [THU] }),
        at(THU, 9),
        60,
      ),
    ).toBe(false);
    expect(
      mechanicAtWork(schedule(), calendar({ holidays: [THU] }), at(THU, 9), 60),
    ).toBe(false);
  });
});

// @traces 058-FR-011
describe("a mechanic's planned minutes", () => {
  it('reads 08:00 to 16:30 as 510', () => {
    expect(plannedMinutes(schedule(), calendar(), THU)).toBe(510);
  });

  it('reads 0 on a day off, a closed day, a legal holiday and a day with no stretch', () => {
    const away = schedule({ daysOff: [{ firstDay: THU, lastDay: THU }] });

    expect(plannedMinutes(away, calendar(), THU)).toBe(0);
    expect(
      plannedMinutes(schedule(), calendar({ closedDays: [THU] }), THU),
    ).toBe(0);
    expect(plannedMinutes(schedule(), calendar({ holidays: [THU] }), THU)).toBe(
      0,
    );
    expect(plannedMinutes(schedule(), calendar(), '2026-11-15')).toBe(0);
  });

  it('reads a Saturday stretch only while she works Saturdays', () => {
    const hours = week([['08:00', '16:30']], { sat: [['09:00', '14:00']] });

    expect(
      plannedMinutes(schedule({ workingHours: hours }), calendar(), SAT),
    ).toBe(0);
    expect(
      plannedMinutes(
        schedule({ workingHours: hours, worksSaturdays: true }),
        calendar(),
        SAT,
      ),
    ).toBe(300);
  });

  it("reads the garage's span while she has no hours of her own", () => {
    expect(
      plannedMinutes(schedule({ workingHours: null }), calendar(), THU),
    ).toBe(600);
  });
});

// @traces 058-FR-011
describe('a day off', () => {
  const daysOff = [
    { firstDay: '2027-05-12', lastDay: '2027-05-16' },
    { firstDay: '2027-06-01', lastDay: '2027-06-01' },
  ];

  it.each(['2027-05-12', '2027-05-14', '2027-05-16', '2027-06-01'])(
    'covers %s',
    (day) => {
      expect(isDayOff(daysOff, day)).toBe(true);
    },
  );

  it.each(['2027-05-11', '2027-05-17', '2027-05-31', '2027-06-02'])(
    'leaves %s',
    (day) => {
      expect(isDayOff(daysOff, day)).toBe(false);
    },
  );
});

// @traces 150-FR-003
describe('the working stretches of a booking', () => {
  const FRI = '2026-11-13';
  const span = (day: string, from: string, to: string) => [
    at(day, Number(from.slice(0, 2)), Number(from.slice(3, 5))),
    at(day, Number(to.slice(0, 2)), Number(to.slice(3, 5))),
  ];
  const plain = (
    hours: WeeklyHours,
    extra: { closedDays?: string[]; holidays?: string[] } = {},
  ) => ({ ...calendar(extra), hours });

  it("clips the mechanic's stretch to a garage day of one interval", () => {
    const garage = plain(week([['08:00', '17:00']]));

    expect(workingStretches(schedule(), garage, MON, 1)).toEqual([
      span(MON, '08:00', '16:30'),
    ]);
  });

  it('gives two stretches on a garage day of two intervals', () => {
    expect(workingStretches(schedule(), calendar(), MON, 1)).toEqual([
      span(MON, '08:00', '12:00'),
      span(MON, '13:00', '16:30'),
    ]);
  });

  it('gives nothing on a day off, a closed day or a public holiday', () => {
    const off = schedule({ daysOff: [{ firstDay: MON, lastDay: MON }] });

    expect(workingStretches(off, calendar(), MON, 1)).toEqual([]);
    expect(
      workingStretches(schedule(), calendar({ closedDays: [MON] }), MON, 1),
    ).toEqual([]);
    expect(
      workingStretches(schedule(), calendar({ holidays: [MON] }), MON, 1),
    ).toEqual([]);
  });

  it('gives a Saturday only with the switch on', () => {
    const own = week([['08:00', '16:30']], { sat: [['10:00', '13:00']] });

    expect(
      workingStretches(schedule({ workingHours: own }), calendar(), SAT, 1),
    ).toEqual([]);
    expect(
      workingStretches(
        schedule({ workingHours: own, worksSaturdays: true }),
        calendar(),
        SAT,
        1,
      ),
    ).toEqual([span(SAT, '10:00', '13:00')]);
  });

  it('gives nothing on a weekday the mechanic has no stretch', () => {
    const own = week([['08:00', '16:30']], { thu: [] });

    expect(
      workingStretches(schedule({ workingHours: own }), calendar(), THU, 1),
    ).toEqual([]);
  });

  it("takes the garage's intervals alone with the team off", () => {
    expect(workingStretches(null, calendar(), MON, 1)).toEqual([
      span(MON, '08:00', '12:00'),
      span(MON, '13:00', '18:00'),
    ]);
  });

  it("takes the mechanic's stretch alone while the garage has set no hours", () => {
    expect(
      workingStretches(schedule(), plain({} as WeeklyHours), MON, 1),
    ).toEqual([span(MON, '08:00', '16:30')]);
  });

  it('runs over the days asked for, in time order, and stops there', () => {
    const garage = plain(week([['08:00', '17:00']]));
    const stretches = workingStretches(schedule(), garage, THU, 5);

    expect(stretches).toEqual([
      span(THU, '08:00', '16:30'),
      span(FRI, '08:00', '16:30'),
      span('2026-11-16', '08:00', '16:30'),
    ]);
    expect(workingStretches(schedule(), garage, THU, 0)).toEqual([]);
  });

  it('keeps the wall-clock hours on the March and October clock-change days', () => {
    const night = schedule({
      workingHours: week([], { sun: [['00:00', '08:00']] }),
    });
    const garage = plain(week([], { sun: [['00:00', '08:00']] }));
    const hours = (day: string) => {
      const [[start, end]] = workingStretches(night, garage, day, 1);
      return (end.getTime() - start.getTime()) / 3_600_000;
    };

    expect(hours('2026-03-29')).toBe(7);
    expect(hours('2026-10-25')).toBe(9);
    expect(hours('2026-11-01')).toBe(8);
  });
});

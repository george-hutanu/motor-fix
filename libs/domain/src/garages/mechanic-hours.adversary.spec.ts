import { clipStretch, stretchOf, type WeeklyHours } from '@motor-fix/contracts';

import {
  effectiveHours,
  isDayOff,
  mechanicAtWork,
  plannedMinutes,
} from './mechanic-hours';

const week = (over: Partial<WeeklyHours> = {}) =>
  ({
    fri: [['08:00', '18:00']],
    mon: [['08:00', '18:00']],
    sat: [['09:00', '14:00']],
    sun: [],
    thu: [['08:00', '18:00']],
    tue: [['08:00', '18:00']],
    wed: [['08:00', '18:00']],
    ...over,
  }) as WeeklyHours;

const none = new Set<string>();
const garage = (hours: unknown = week(), extra = {}) => ({
  closedDays: none,
  holidays: none,
  hours: hours as never,
  ...extra,
});
const sched = (over = {}) => ({
  daysOff: [] as { firstDay: string; lastDay: string }[],
  workingHours: null as unknown,
  worksSaturdays: false,
  ...over,
});

describe('stretchOf and clipStretch', () => {
  it('stretchOf of an empty list is null', () => {
    expect(stretchOf([])).toBeNull();
  });

  it('stretchOf spans an out-of-order list with a lunch break', () => {
    expect(
      stretchOf([
        ['13:00', '18:00'],
        ['08:00', '12:00'],
      ]),
    ).toEqual(['08:00', '18:00']);
  });

  it('clipStretch of touching ranges is empty, not a zero-length stretch', () => {
    expect(clipStretch(['08:00', '09:00'], ['09:00', '12:00'])).toBeNull();
  });

  it('clipStretch of identical ranges returns the range', () => {
    expect(clipStretch(['08:00', '09:00'], ['08:00', '09:00'])).toEqual([
      '08:00',
      '09:00',
    ]);
  });

  it('clipStretch with a null bound is empty', () => {
    expect(clipStretch(['08:00', '09:00'], null)).toBeNull();
  });
});

describe('effectiveHours', () => {
  // @traces 058-FR-002
  it('null hours default to the garage weekdays collapsed to one stretch, weekend empty', () => {
    const g = week({
      mon: [
        ['08:00', '12:00'],
        ['13:00', '18:00'],
      ],
      sun: [['10:00', '12:00']],
    });
    const out = effectiveHours(null, g);
    expect(out.mon).toEqual([['08:00', '18:00']]);
    expect(out.sat).toEqual([]);
    expect(out.sun).toEqual([]);
  });

  // @traces 058-FR-002
  it('a garage with empty hours gives an empty week', () => {
    const out = effectiveHours(null, {});
    expect(Object.values(out)).toEqual([[], [], [], [], [], [], []]);
  });

  // @traces 058-FR-002
  it('undefined garage hours give an empty week', () => {
    const out = effectiveHours(null, undefined);
    expect(out.mon).toEqual([]);
  });

  // @traces 058-FR-002
  it('stored hours with two intervals read as one stretch and the input is not mutated', () => {
    const stored = week({
      tue: [
        ['08:00', '12:00'],
        ['13:00', '17:00'],
      ],
    });
    const copy = JSON.stringify(stored);
    expect(effectiveHours(stored, week()).tue).toEqual([['08:00', '17:00']]);
    expect(JSON.stringify(stored)).toBe(copy);
  });

  // @traces 058-FR-002
  it('explicit empty-object hours mean no stretch anywhere, not the garage default', () => {
    expect(effectiveHours({}, week()).mon).toEqual([]);
  });

  // @traces 058-FR-002
  it('a stored value with a non-list day does not throw', () => {
    expect(effectiveHours({ mon: 'x', tue: null }, week()).mon).toEqual([]);
  });

  // @traces 058-FR-002
  it('explicit hours keep a stored Sunday stretch', () => {
    const out = effectiveHours(week({ sun: [['10:00', '12:00']] }), week());
    expect(out.sun).toEqual([['10:00', '12:00']]);
  });

  it('always returns all seven weekday keys', () => {
    expect(Object.keys(effectiveHours(null, week()))).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ]);
  });
});

describe('isDayOff', () => {
  // @traces 058-FR-004
  it('a single-day range matches only that day', () => {
    const d = [{ firstDay: '2027-05-14', lastDay: '2027-05-14' }];
    expect([
      isDayOff(d, '2027-05-13'),
      isDayOff(d, '2027-05-14'),
      isDayOff(d, '2027-05-15'),
    ]).toEqual([false, true, false]);
  });

  // @traces 058-FR-004
  it('both ends of a range are inclusive', () => {
    const d = [{ firstDay: '2027-05-12', lastDay: '2027-05-16' }];
    expect([
      isDayOff(d, '2027-05-12'),
      isDayOff(d, '2027-05-16'),
      isDayOff(d, '2027-05-17'),
    ]).toEqual([true, true, false]);
  });

  it('an empty list is never a day off', () => {
    expect(isDayOff([], '2027-05-12')).toBe(false);
  });

  // @traces 058-FR-004
  it('a reversed stored range matches nothing', () => {
    expect(
      isDayOff(
        [{ firstDay: '2027-05-16', lastDay: '2027-05-12' }],
        '2027-05-14',
      ),
    ).toBe(false);
  });

  // @traces 058-FR-004
  it('ten thousand single days off are searched correctly', () => {
    const base = Date.UTC(2027, 0, 1);
    const iso = (i: number) =>
      new Date(base + i * 86_400_000 * 2).toISOString().slice(0, 10);
    const d = Array.from({ length: 10000 }, (_, i) => ({
      firstDay: iso(i),
      lastDay: iso(i),
    }));
    expect([
      isDayOff(d, iso(9999)),
      isDayOff(d, iso(5000)),
      isDayOff(d, '2027-01-02'),
    ]).toEqual([true, true, false]);
  });
});

describe('mechanicAtWork', () => {
  // 2027-05-12 is a Wednesday, EEST (UTC+3): 08:00 local is 05:00Z
  const wed = (h: number, m = 0) => new Date(Date.UTC(2027, 4, 12, h - 3, m));

  // @traces 058-FR-011
  it('a span exactly filling the stretch is at work', () => {
    const s = sched({ workingHours: week({ wed: [['08:00', '16:30']] }) });
    expect(mechanicAtWork(s, garage(), wed(8), 510)).toBe(true);
  });

  // @traces 058-FR-011
  it('a span one minute past the stretch end is not at work', () => {
    const s = sched({ workingHours: week({ wed: [['08:00', '16:30']] }) });
    expect(mechanicAtWork(s, garage(), wed(8), 511)).toBe(false);
  });

  // @traces 058-FR-011
  it('a span starting one minute before the stretch is not at work', () => {
    const s = sched({ workingHours: week({ wed: [['08:00', '16:30']] }) });
    expect(mechanicAtWork(s, garage(), wed(7, 59), 30)).toBe(false);
  });

  // @traces 058-FR-002
  it('a confirm for 16:30-17:30 of a 08:00-16:30 mechanic is refused', () => {
    const s = sched({ workingHours: week({ mon: [['08:00', '16:30']] }) });
    const mon = new Date(Date.UTC(2027, 4, 10, 16 - 3 + 0, 30));
    expect(mechanicAtWork(s, garage(), mon, 60)).toBe(false);
  });

  // @traces 058-FR-011
  it('a zero-minute span at the stretch end is accepted and at the garage close too', () => {
    const s = sched();
    expect(mechanicAtWork(s, garage(), wed(18), 0)).toBe(true);
  });

  // @traces 058-FR-011
  it('a span crossing midnight is refused', () => {
    const s = sched({ workingHours: week({ wed: [['08:00', '18:00']] }) });
    expect(mechanicAtWork(s, garage(), wed(17), 24 * 60)).toBe(false);
  });

  // @traces 058-FR-011
  it('an invalid date is refused', () => {
    expect(mechanicAtWork(sched(), garage(), new Date('nope'), 30)).toBe(false);
  });

  // @traces 058-FR-011
  it('a negative duration does not report at work', () => {
    expect(mechanicAtWork(sched(), garage(), wed(10), -60)).toBe(false);
  });

  // @traces 058-FR-011
  it('a day off removes every span that day, one day either side is unaffected', () => {
    const s = sched({
      daysOff: [{ firstDay: '2027-05-12', lastDay: '2027-05-12' }],
    });
    expect(mechanicAtWork(s, garage(), wed(10), 30)).toBe(false);
    const tue = new Date(Date.UTC(2027, 4, 11, 7));
    const thu = new Date(Date.UTC(2027, 4, 13, 7));
    expect([
      mechanicAtWork(s, garage(), tue, 30),
      mechanicAtWork(s, garage(), thu, 30),
    ]).toEqual([true, true]);
  });

  // @traces 058-FR-011
  it('a day off near Bucharest midnight uses the Bucharest day, not the UTC day', () => {
    const s = sched({
      daysOff: [{ firstDay: '2027-05-13', lastDay: '2027-05-13' }],
      workingHours: week({ wed: [['00:00', '23:45']] }),
    });
    const g = garage(
      week({ thu: [['00:00', '23:45']], wed: [['00:00', '23:45']] }),
    );
    const lateWedBucharest = new Date(Date.UTC(2027, 4, 12, 20, 30)); // 23:30 local Wed
    expect(mechanicAtWork(s, g, lateWedBucharest, 15)).toBe(true);
    const earlyThuBucharest = new Date(Date.UTC(2027, 4, 12, 21, 30)); // 00:30 local Thu
    expect(mechanicAtWork(s, g, earlyThuBucharest, 15)).toBe(false);
  });

  // @traces 058-FR-011
  it('a holiday and a closed day refuse a mechanic who is otherwise at work', () => {
    const s = sched();
    expect(
      mechanicAtWork(
        s,
        garage(week(), { holidays: new Set(['2027-05-12']) }),
        wed(10),
        30,
      ),
    ).toBe(false);
    expect(
      mechanicAtWork(
        s,
        garage(week(), { closedDays: new Set(['2027-05-12']) }),
        wed(10),
        30,
      ),
    ).toBe(false);
  });

  // @traces 058-FR-003
  it('Saturday stretch counts only with the switch on', () => {
    const s = sched({ workingHours: week({ sat: [['09:00', '14:00']] }) });
    const sat = new Date(Date.UTC(2027, 4, 15, 7)); // 10:00 local
    expect(mechanicAtWork(s, garage(), sat, 60)).toBe(false);
    expect(
      mechanicAtWork({ ...s, worksSaturdays: true }, garage(), sat, 60),
    ).toBe(true);
  });

  // @traces 058-FR-003
  it('switch on with no Saturday stretch stored is not at work', () => {
    const s = sched({ workingHours: week({ sat: [] }), worksSaturdays: true });
    expect(
      mechanicAtWork(s, garage(), new Date(Date.UTC(2027, 4, 15, 7)), 60),
    ).toBe(false);
  });

  // @traces 058-FR-002
  it('default schedule (null hours) is not at work on Saturday even with the garage open', () => {
    expect(
      mechanicAtWork(sched(), garage(), new Date(Date.UTC(2027, 4, 15, 7)), 60),
    ).toBe(false);
  });

  // @traces 058-FR-002
  it('null hours with garage hours {} are at work whenever the garage is (D17)', () => {
    expect(mechanicAtWork(sched(), garage({}), wed(10), 30)).toBe(true);
  });

  // @traces 058-FR-011
  it('Wednesday unticked refuses every Wednesday span', () => {
    const s = sched({ workingHours: week({ wed: [] }) });
    expect(mechanicAtWork(s, garage(), wed(10), 30)).toBe(false);
  });

  // @traces 058-FR-011
  it('lunch break of the garage is not bridged by the mechanic stretch', () => {
    const g = garage(
      week({
        wed: [
          ['08:00', '12:00'],
          ['13:00', '18:00'],
        ],
      }),
    );
    const s = sched({ workingHours: week({ wed: [['08:00', '17:00']] }) });
    expect(mechanicAtWork(s, g, wed(9), 60)).toBe(true);
    expect(mechanicAtWork(s, g, wed(12), 60)).toBe(false);
    expect(mechanicAtWork(s, g, wed(11, 30), 60)).toBe(false);
  });

  describe('Europe/Bucharest clock changes', () => {
    const allDay = week({
      fri: [['00:00', '23:45']],
      mon: [['00:00', '23:45']],
      sun: [['00:00', '23:45']],
    });
    const g = garage(allDay);
    const s = sched({ workingHours: allDay });

    // @traces 058-FR-011
    it('08:00 local on the Monday after the spring change is 05:00Z and inside 08:00-09:00', () => {
      const s2 = sched({ workingHours: week({ mon: [['08:00', '09:00']] }) });
      const g2 = garage(week({ mon: [['08:00', '09:00']] }));
      expect(
        mechanicAtWork(s2, g2, new Date(Date.UTC(2027, 2, 29, 5)), 60),
      ).toBe(true);
      expect(
        mechanicAtWork(s2, g2, new Date(Date.UTC(2027, 2, 29, 6)), 60),
      ).toBe(false);
    });

    // @traces 058-FR-011
    it('a span across the spring change on Sunday 28 March 2027 stays on one day', () => {
      const start = new Date(Date.UTC(2027, 2, 28, 0, 30)); // 02:30 local
      expect(mechanicAtWork(s, g, start, 120)).toBe(true);
    });

    // @traces 058-FR-011
    it('a span across the autumn change on Sunday 31 October 2027 stays on one day', () => {
      const start = new Date(Date.UTC(2027, 9, 30, 21, 30)); // 00:30 local Sun
      expect(mechanicAtWork(s, g, start, 240)).toBe(true);
    });

    // @traces 058-FR-011
    it('a day off on the change day covers its late-evening Bucharest hours', () => {
      const off = sched({
        daysOff: [{ firstDay: '2027-03-28', lastDay: '2027-03-28' }],
        workingHours: allDay,
      });
      const lateSun = new Date(Date.UTC(2027, 2, 28, 20, 30)); // 23:30 local
      expect(mechanicAtWork(off, g, lateSun, 15)).toBe(false);
    });
  });
});

describe('plannedMinutes', () => {
  // @traces 058-FR-011
  it('08:00-16:30 reads 510', () => {
    const s = sched({ workingHours: week({ wed: [['08:00', '16:30']] }) });
    expect(plannedMinutes(s, garage(), '2027-05-12')).toBe(510);
  });

  // @traces 058-FR-011
  it('a day off, closed day and holiday read 0', () => {
    const s = sched({
      daysOff: [{ firstDay: '2027-05-12', lastDay: '2027-05-12' }],
    });
    expect(plannedMinutes(s, garage(), '2027-05-12')).toBe(0);
    expect(
      plannedMinutes(
        sched(),
        garage(week(), { closedDays: new Set(['2027-05-12']) }),
        '2027-05-12',
      ),
    ).toBe(0);
    expect(
      plannedMinutes(
        sched(),
        garage(week(), { holidays: new Set(['2027-05-12']) }),
        '2027-05-12',
      ),
    ).toBe(0);
  });

  // @traces 058-FR-003
  it('Saturday counts 300 only with the switch on; 0 with it off even with a stretch stored', () => {
    const wh = week({ sat: [['09:00', '14:00']] });
    expect(
      plannedMinutes(sched({ workingHours: wh }), garage(), '2027-05-15'),
    ).toBe(0);
    expect(
      plannedMinutes(
        sched({ workingHours: wh, worksSaturdays: true }),
        garage(),
        '2027-05-15',
      ),
    ).toBe(300);
  });

  // @traces 058-FR-011
  it('a Sunday stretch is counted on a Sunday date', () => {
    const wh = week({ sun: [['10:00', '12:00']] });
    expect(
      plannedMinutes(
        sched({ workingHours: wh }),
        garage(week({ sun: [['10:00', '12:00']] })),
        '2027-05-16',
      ),
    ).toBe(120);
  });

  // @traces 058-FR-011
  it('a null-hours mechanic plans the garage stretch on a weekday and 0 on Saturday', () => {
    expect(plannedMinutes(sched(), garage(), '2027-05-12')).toBe(600);
    expect(plannedMinutes(sched(), garage(), '2027-05-15')).toBe(0);
  });

  // @traces 058-FR-011
  it('weekday is read on the date itself on the DST change days', () => {
    const wh = week({ mon: [['08:00', '09:00']], sun: [['10:00', '12:00']] });
    const g = garage(wh);
    expect(plannedMinutes(sched({ workingHours: wh }), g, '2027-03-28')).toBe(
      120,
    );
    expect(plannedMinutes(sched({ workingHours: wh }), g, '2027-10-31')).toBe(
      120,
    );
  });

  // @traces 058-FR-011
  it('a garage with no hours gives 0', () => {
    expect(plannedMinutes(sched(), garage({}), '2027-05-12')).toBe(0);
  });

  // @traces 058-FR-011
  it('a malformed day string does not return NaN', () => {
    expect(Number.isNaN(plannedMinutes(sched(), garage(), 'not-a-day'))).toBe(
      false,
    );
  });
});

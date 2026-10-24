import type { WeeklyHours } from './garage-hours';
import { type ClosedDayAhead, openStatus } from './open-status';

const DAY: [string, string][] = [['08:00', '19:00']];
const WEEK: WeeklyHours = {
  fri: DAY,
  mon: DAY,
  sat: [['09:00', '14:00']],
  sun: [],
  thu: DAY,
  tue: DAY,
  wed: DAY,
};
const LUNCH: WeeklyHours = {
  ...WEEK,
  mon: [
    ['08:00', '12:00'],
    ['13:00', '19:00'],
  ],
};
const ALL_DAY: WeeklyHours = Object.fromEntries(
  Object.keys(WEEK).map((d) => [d, [['00:00', '23:45']]]),
) as unknown as WeeklyHours;
const NEVER: WeeklyHours = Object.fromEntries(
  Object.keys(WEEK).map((d) => [d, []]),
) as unknown as WeeklyHours;

const holiday = (day: string): ClosedDayAhead => ({ day, reason: 'holiday' });
const closed = (day: string): ClosedDayAhead => ({ day, reason: 'closed' });
const at = (iso: string) => new Date(iso);

// @traces 309-FR-003
describe('openStatus with hours that are not a week', () => {
  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'Mon-Fri 8-19'],
    ['a number', 7],
    ['an array', []],
    ['an empty object', {}],
    ['a week missing sunday', { ...WEEK, sun: undefined }],
    ['a week with an extra key', { ...WEEK, holiday: DAY }],
    ['a day holding null', { ...WEEK, mon: null }],
    [
      'an interval that ends before it starts',
      { ...WEEK, tue: [['19:00', '08:00']] },
    ],
    ['an empty interval', { ...WEEK, tue: [['08:00', '08:00']] }],
    ['an hour past 24', { ...WEEK, tue: [['08:00', '25:00']] }],
    ['unpadded times', { ...WEEK, tue: [['8:00', '19:00']] }],
    [
      'overlapping intervals',
      {
        ...WEEK,
        tue: [
          ['08:00', '12:00'],
          ['11:00', '19:00'],
        ],
      },
    ],
    [
      'three intervals',
      {
        ...WEEK,
        tue: [
          ['08:00', '09:00'],
          ['10:00', '11:00'],
          ['12:00', '13:00'],
        ],
      },
    ],
  ])('answers no line for %s', (_t, hours) => {
    expect(openStatus(hours, [], at('2027-11-02T10:15:00+02:00'))).toEqual({
      kind: 'none',
    });
  });

  it('answers no line for a week with no open day at all', () => {
    expect(openStatus(NEVER, [], at('2027-11-02T10:15:00+02:00'))).toEqual({
      kind: 'none',
    });
  });
});

// @traces 309-FR-004
describe('openStatus at the boundaries of an interval', () => {
  it('is open one millisecond before the end', () => {
    expect(openStatus(WEEK, [], at('2027-11-02T18:59:59.999+02:00'))).toEqual({
      kind: 'open',
      until: '19:00',
    });
  });

  it('is closed one millisecond after the start of the end second', () => {
    expect(openStatus(WEEK, [], at('2027-11-02T19:00:00.001+02:00'))).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 1 },
      reason: 'hours',
    });
  });

  it('is closed one millisecond before the start', () => {
    expect(openStatus(WEEK, [], at('2027-11-02T07:59:59.999+02:00'))).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 0 },
      reason: 'hours',
    });
  });

  it('is open at the exact start of the second interval of a split day', () => {
    expect(openStatus(LUNCH, [], at('2027-11-08T13:00:00+02:00'))).toEqual({
      kind: 'open',
      until: '19:00',
    });
  });

  it('is on a break one millisecond before the second interval', () => {
    expect(openStatus(LUNCH, [], at('2027-11-08T12:59:59.999+02:00'))).toEqual({
      kind: 'break',
      until: '13:00',
    });
  });

  it('is closed at the end of the last interval of a split day', () => {
    expect(openStatus(LUNCH, [], at('2027-11-08T19:00:00+02:00'))).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 1 },
      reason: 'hours',
    });
  });

  it('is open at midnight on a day that starts at 00:00', () => {
    expect(openStatus(ALL_DAY, [], at('2027-11-02T00:00:00+02:00'))).toEqual({
      kind: 'open',
      until: '23:45',
    });
  });
});

// @traces 309-FR-002
describe('openStatus on the Bucharest calendar day', () => {
  it('reads a Tuesday evening in UTC as Wednesday in Bucharest', () => {
    const hours = {
      ...ALL_DAY,
      tue: [],
      wed: [['00:00', '06:00']],
    } as unknown as WeeklyHours;
    expect(openStatus(hours, [], at('2027-11-02T22:30:00Z'))).toEqual({
      kind: 'open',
      until: '06:00',
    });
  });

  it('applies a closed day to the Bucharest date, not the UTC date', () => {
    expect(
      openStatus(WEEK, [closed('2027-11-03')], at('2027-11-02T22:30:00Z')),
    ).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 1 },
      reason: 'closed',
    });
  });

  it('reads a summer-time evening in UTC as the next Bucharest day', () => {
    expect(
      openStatus(WEEK, [holiday('2027-07-01')], at('2027-06-30T21:30:00Z')),
    ).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 1 },
      reason: 'holiday',
    });
  });

  it('counts a window that crosses the autumn clock change as whole days', () => {
    expect(
      openStatus(WEEK, [closed('2027-11-01')], at('2027-10-30T20:00:00+03:00')),
    ).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 3 },
      reason: 'hours',
    });
  });

  it('counts a window that crosses a month and a year end', () => {
    expect(
      openStatus(
        WEEK,
        [holiday('2028-01-03')],
        at('2027-12-31T20:00:00+02:00'),
      ),
    ).toEqual({
      kind: 'closed',
      next: { at: '09:00', inDays: 1 },
      reason: 'hours',
    });
  });

  it('handles 29 February in a leap year', () => {
    expect(openStatus(WEEK, [], at('2028-02-28T20:00:00+02:00'))).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 1 },
      reason: 'hours',
    });
    expect(
      openStatus(
        WEEK,
        [holiday('2028-02-29')],
        at('2028-02-28T20:00:00+02:00'),
      ),
    ).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 2 },
      reason: 'hours',
    });
  });
});

// @traces 309-FR-003
describe('openStatus with closed days', () => {
  it('names the holiday for a Sunday holiday the hours already shut', () => {
    expect(
      openStatus(
        WEEK,
        [holiday('2027-11-07')],
        at('2027-11-07T12:00:00+02:00'),
      ),
    ).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 1 },
      reason: 'holiday',
    });
  });

  it('names the closed day for a Sunday the owner also marked', () => {
    expect(
      openStatus(WEEK, [closed('2027-11-07')], at('2027-11-07T12:00:00+02:00')),
    ).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 1 },
      reason: 'closed',
    });
  });

  it('closes the whole day for a holiday even before opening hours', () => {
    expect(
      openStatus(
        WEEK,
        [holiday('2027-12-01')],
        at('2027-12-01T07:00:00+02:00'),
      ),
    ).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 1 },
      reason: 'holiday',
    });
  });

  it('lets the holiday win whichever order the two reasons arrive in', () => {
    const a = openStatus(
      WEEK,
      [holiday('2027-12-01'), closed('2027-12-01')],
      at('2027-12-01T10:00:00+02:00'),
    );
    const b = openStatus(
      WEEK,
      [closed('2027-12-01'), holiday('2027-12-01')],
      at('2027-12-01T10:00:00+02:00'),
    );
    expect(a).toEqual(b);
    expect(a).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 1 },
      reason: 'holiday',
    });
  });

  it('ignores a closed day in the past', () => {
    expect(
      openStatus(WEEK, [closed('2027-11-01')], at('2027-11-02T10:15:00+02:00')),
    ).toEqual({
      kind: 'open',
      until: '19:00',
    });
  });

  it('does not look at a closed day past the fourteenth day', () => {
    const days = Array.from({ length: 15 }, (_, i) =>
      closed(`2027-11-${String(3 + i).padStart(2, '0')}`),
    );
    expect(openStatus(ALL_DAY, days, at('2027-11-02T23:50:00+02:00'))).toEqual({
      kind: 'none',
    });
  });

  it('opens on the fourteenth day when the thirteen before it are shut', () => {
    const days = Array.from({ length: 13 }, (_, i) =>
      closed(`2027-11-${String(3 + i).padStart(2, '0')}`),
    );
    expect(openStatus(ALL_DAY, days, at('2027-11-02T23:50:00+02:00'))).toEqual({
      kind: 'closed',
      next: { at: '00:00', inDays: 14 },
      reason: 'hours',
    });
  });

  it('skips unsorted and repeated closed days', () => {
    expect(
      openStatus(
        ALL_DAY,
        [
          closed('2027-11-04'),
          closed('2027-11-03'),
          closed('2027-11-04'),
          holiday('2027-11-03'),
        ],
        at('2027-11-02T23:50:00+02:00'),
      ),
    ).toEqual({
      kind: 'closed',
      next: { at: '00:00', inDays: 3 },
      reason: 'hours',
    });
  });

  it('ignores a closed day that is not a date', () => {
    expect(
      openStatus(
        WEEK,
        [closed('soon'), closed('')],
        at('2027-11-02T10:15:00+02:00'),
      ),
    ).toEqual({
      kind: 'open',
      until: '19:00',
    });
  });

  it('answers the same twice and leaves a frozen closed-days list alone', () => {
    const list = Object.freeze([Object.freeze(holiday('2027-12-01'))]);
    const now = at('2027-12-01T10:00:00+02:00');
    expect(openStatus(WEEK, list, now)).toEqual(openStatus(WEEK, list, now));
    expect(list).toEqual([holiday('2027-12-01')]);
  });

  it('does not change the instant it is given', () => {
    const now = at('2027-12-01T10:00:00+02:00');
    openStatus(WEEK, [], now);
    expect(now.toISOString()).toBe('2027-12-01T08:00:00.000Z');
  });
});

// @traces 309-FR-004
describe('openStatus on a long list of closed days', () => {
  it('copes with ten thousand repeated entries', () => {
    const list = Array.from({ length: 10_000 }, () => closed('2027-11-03'));
    expect(openStatus(WEEK, list, at('2027-11-02T20:00:00+02:00'))).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 2 },
      reason: 'hours',
    });
  });

  it('looks seven days ahead for a garage open on one weekday only', () => {
    const monday = { ...NEVER, mon: DAY } as unknown as WeeklyHours;
    expect(openStatus(monday, [], at('2027-11-01T20:00:00+02:00'))).toEqual({
      kind: 'closed',
      next: { at: '08:00', inDays: 7 },
      reason: 'hours',
    });
  });
});

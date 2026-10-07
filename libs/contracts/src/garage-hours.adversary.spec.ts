import {
  CLOSED_NOTE_MAX,
  closedDayError,
  closedDaysError,
  DEFAULT_HOURS,
  intervalsError,
  isHoursSection,
  isTime,
  isWeeklyHours,
  TIMES,
  todayInBucharest,
  WEEKDAYS,
} from './garage-hours';

const week = (overrides: Record<string, unknown> = {}) => ({
  ...DEFAULT_HOURS,
  ...overrides,
});

describe('times', () => {
  it('lists 96 distinct grid times from 00:00 to 23:45', () => {
    expect(TIMES).toHaveLength(96);
    expect(new Set(TIMES).size).toBe(96);
    expect(TIMES[0]).toBe('00:00');
    expect(TIMES[95]).toBe('23:45');
  });

  it.each([
    '24:00',
    '08:10',
    '8:00',
    '08:00 ',
    ' 08:00',
    '08:00\n',
    '08:60',
    '０８:００',
    '08.00',
    '',
    '23:46',
  ])('refuses %j as a time', (value) => {
    expect(isTime(value)).toBe(false);
  });

  it.each([null, undefined, 800, ['08:00'], {}, true])(
    'refuses the non-string %j as a time',
    (value) => {
      expect(isTime(value)).toBe(false);
    },
  );

  it('accepts every grid time', () => {
    expect(TIMES.every((t) => isTime(t))).toBe(true);
  });
});

describe('intervals', () => {
  it('accepts no interval and one interval', () => {
    expect(intervalsError([])).toBeNull();
    expect(intervalsError([['00:00', '23:45']])).toBeNull();
  });

  it('accepts two intervals that touch', () => {
    expect(
      intervalsError([
        ['08:00', '12:00'],
        ['12:00', '17:00'],
      ]),
    ).toBeNull();
  });

  it('refuses a third interval', () => {
    expect(
      intervalsError([
        ['08:00', '09:00'],
        ['10:00', '11:00'],
        ['12:00', '13:00'],
      ]),
    ).toBe('count');
  });

  it('refuses a closing time equal to the opening time', () => {
    expect(intervalsError([['08:00', '08:00']])).toBe('order');
  });

  it('refuses a closing time before the opening time', () => {
    expect(intervalsError([['17:00', '08:00']])).toBe('order');
  });

  it('refuses overlapping intervals by one step', () => {
    expect(
      intervalsError([
        ['08:00', '12:15'],
        ['12:00', '17:00'],
      ]),
    ).toBe('overlap');
  });

  it('refuses intervals given out of order', () => {
    const error = intervalsError([
      ['13:00', '17:00'],
      ['08:00', '12:00'],
    ]);
    expect(['order', 'overlap']).toContain(error);
  });

  it('refuses an off-grid time', () => {
    expect(intervalsError([['08:10', '17:00']])).toBe('grid');
    expect(intervalsError([['08:00', '17:01']])).toBe('grid');
  });
});

describe('weekly hours', () => {
  it('accepts the default', () => {
    expect(isWeeklyHours(DEFAULT_HOURS)).toBe(true);
  });

  it.each([null, undefined, [], 'mon', 5])('refuses %j', (value) => {
    expect(isWeeklyHours(value)).toBe(false);
  });

  it.each(WEEKDAYS)('refuses a week missing %s', (day) => {
    const { [day]: _gone, ...rest } = DEFAULT_HOURS;
    expect(isWeeklyHours(rest)).toBe(false);
  });

  it('refuses a day that is not a list', () => {
    expect(isWeeklyHours(week({ mon: '08:00-17:00' }))).toBe(false);
    expect(isWeeklyHours(week({ mon: null }))).toBe(false);
  });

  it('refuses an interval of three times or of numbers', () => {
    expect(isWeeklyHours(week({ mon: [['08:00', '12:00', '13:00']] }))).toBe(
      false,
    );
    expect(isWeeklyHours(week({ mon: [[800, 1700]] }))).toBe(false);
    expect(isWeeklyHours(week({ mon: [['08:00']] }))).toBe(false);
  });

  it('refuses three intervals, an overlap and an off-grid time on any day', () => {
    expect(
      isWeeklyHours(
        week({
          sun: [
            ['08:00', '09:00'],
            ['10:00', '11:00'],
            ['12:00', '13:00'],
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isWeeklyHours(
        week({
          sun: [
            ['08:00', '12:00'],
            ['11:00', '13:00'],
          ],
        }),
      ),
    ).toBe(false);
    expect(isWeeklyHours(week({ sun: [['08:05', '13:00']] }))).toBe(false);
  });

  it('accepts a week with every day closed', () => {
    const closed = Object.fromEntries(WEEKDAYS.map((d) => [d, []]));
    expect(isWeeklyHours(closed)).toBe(true);
  });
});

describe('closed days list', () => {
  it('accepts an empty list', () => {
    expect(closedDaysError([])).toBeNull();
  });

  it('accepts a note of exactly the limit and refuses one past it', () => {
    const ok = [{ day: '2026-12-27', note: 'a'.repeat(CLOSED_NOTE_MAX) }];
    const bad = [{ day: '2026-12-27', note: 'a'.repeat(CLOSED_NOTE_MAX + 1) }];
    expect(closedDaysError(ok)).toBeNull();
    expect(closedDaysError(bad)).toBe('shape');
  });

  it('counts a note in code points, not UTF-16 units', () => {
    const emoji = '😀'.repeat(CLOSED_NOTE_MAX);
    expect(closedDaysError([{ day: '2026-12-27', note: emoji }])).toBeNull();
    expect(closedDaysError([{ day: '2026-12-27', note: `${emoji}😀` }])).toBe(
      'shape',
    );
  });

  it('refuses a duplicate date', () => {
    expect(
      closedDaysError([
        { day: '2026-12-27' },
        { day: '2026-12-27', note: 'x' },
      ]),
    ).toBe('duplicate');
  });

  it.each([
    'not a list',
    null,
    {},
    [null],
    [{}],
    [{ day: 20261227 }],
    [{ day: '2026-12-27', note: 5 }],
    [{ day: '27/12/2026' }],
    [{ day: '2026-13-01' }],
    [{ day: '2026-02-30' }],
    [{ day: '2026-12-27T00:00:00Z' }],
  ])('refuses the malformed %j', (value) => {
    expect(closedDaysError(value)).not.toBeNull();
  });
});

describe('closed day rules', () => {
  const today = '2026-10-07';

  it('accepts today', () => {
    expect(closedDayError(today, [], today, [])).toBeNull();
  });

  it('refuses yesterday as past', () => {
    expect(closedDayError('2026-10-06', [], today, [])).toBe('past');
  });

  it('accepts exactly two years ahead and refuses one day more', () => {
    expect(closedDayError('2028-10-07', [], today, [])).toBeNull();
    expect(closedDayError('2028-10-08', [], today, [])).toBe('tooFar');
  });

  it('measures two years from a leap day without crashing', () => {
    expect(closedDayError('2030-02-28', [], '2028-02-29', [])).toBeNull();
    expect(closedDayError('2030-03-02', [], '2028-02-29', [])).toBe('tooFar');
  });

  it('refuses a date already listed', () => {
    expect(
      closedDayError('2026-12-27', [{ day: '2026-12-27' }], today, []),
    ).toBe('duplicate');
  });

  it('refuses a legal holiday and accepts it when the calendar is empty', () => {
    expect(closedDayError('2026-12-01', [], today, ['2026-12-01'])).toBe(
      'holiday',
    );
    expect(closedDayError('2026-12-01', [], today, [])).toBeNull();
  });

  it('names a past holiday as past', () => {
    expect(closedDayError('2026-01-01', [], today, ['2026-01-01'])).toBe(
      'past',
    );
  });
});

describe('the draft section', () => {
  it('accepts an empty section and one with other stories keys', () => {
    expect(isHoursSection({})).toBe(true);
    expect(isHoursSection({ address: { street: 'x' }, photos: [] })).toBe(true);
  });

  it.each([null, undefined, [], 'x', 3])('refuses %j', (value) => {
    expect(isHoursSection(value)).toBe(false);
  });

  it('refuses an unknown facility, a duplicate facility and a non-list', () => {
    expect(isHoursSection({ facilities: ['car_wash'] })).toBe(false);
    expect(
      isHoursSection({ facilities: ['waiting_area', 'waiting_area'] }),
    ).toBe(false);
    expect(isHoursSection({ facilities: 'waiting_area' })).toBe(false);
    expect(isHoursSection({ facilities: [null] })).toBe(false);
  });

  it('accepts an empty facility list and all three', () => {
    expect(isHoursSection({ facilities: [] })).toBe(true);
    expect(
      isHoursSection({
        facilities: ['courtesy_car', 'pickup_dropoff', 'waiting_area'],
      }),
    ).toBe(true);
  });

  it('refuses null for a key that may be absent', () => {
    expect(isHoursSection({ hours: null })).toBe(false);
    expect(isHoursSection({ closedDays: null })).toBe(false);
    expect(isHoursSection({ facilities: null })).toBe(false);
  });

  it('refuses a bad time inside hours', () => {
    expect(isHoursSection({ hours: week({ mon: [['08:10', '17:00']] }) })).toBe(
      false,
    );
  });

  it('refuses an 81-character note inside closed days', () => {
    expect(
      isHoursSection({
        closedDays: [{ day: '2026-12-27', note: 'x'.repeat(81) }],
      }),
    ).toBe(false);
  });
});

describe('the Bucharest day', () => {
  it('rolls over at local midnight in winter', () => {
    expect(todayInBucharest(new Date('2026-12-31T21:59:59Z'))).toBe(
      '2026-12-31',
    );
    expect(todayInBucharest(new Date('2026-12-31T22:00:00Z'))).toBe(
      '2027-01-01',
    );
  });

  it('rolls over at local midnight in summer', () => {
    expect(todayInBucharest(new Date('2026-07-14T20:59:59Z'))).toBe(
      '2026-07-14',
    );
    expect(todayInBucharest(new Date('2026-07-14T21:00:00Z'))).toBe(
      '2026-07-15',
    );
  });

  it('follows the clock change at the end of March', () => {
    expect(todayInBucharest(new Date('2026-03-28T21:59:59Z'))).toBe(
      '2026-03-28',
    );
    expect(todayInBucharest(new Date('2026-03-28T22:00:00Z'))).toBe(
      '2026-03-29',
    );
  });
});

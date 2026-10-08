import {
  CLOSED_DAY_YEARS,
  CLOSED_NOTE_MAX,
  COURTESY_PRICE_MAX_BANI,
  COURTESY_PRICE_MIN_BANI,
  COURTESY_PRICE_STEP_BANI,
  closedDayError,
  closedDaysError,
  DEFAULT_HOURS,
  FACILITIES,
  hoursComplete,
  intervalsError,
  isHoursSection,
  isTime,
  isWeeklyHours,
  PAYMENTS,
  TIMES,
  todayInBucharest,
  WEEKDAYS,
} from './garage-hours';

const week = (overrides: Record<string, unknown> = {}) => ({
  ...DEFAULT_HOURS,
  ...overrides,
});

describe('a time of day', () => {
  it.each(['00:00', '08:15', '12:30', '23:45'])('takes %s', (time) => {
    expect(isTime(time)).toBe(true);
  });

  it.each([
    '08:10',
    '8:00',
    '24:00',
    '23:60',
    '08:00:00',
    '',
    ' 08:00',
    800,
    null,
  ])('refuses %p', (time) => {
    expect(isTime(time)).toBe(false);
  });

  it('offers every quarter hour of the day, in order', () => {
    expect(TIMES).toHaveLength(96);
    expect(TIMES[0]).toBe('00:00');
    expect(TIMES[1]).toBe('00:15');
    expect(TIMES[95]).toBe('23:45');
    expect(TIMES.every(isTime)).toBe(true);
  });
});

describe("a day's intervals", () => {
  it.each([
    ['no interval, a closed day', []],
    ['one interval', [['08:00', '17:00']]],
    [
      'two intervals around a break',
      [
        ['08:00', '12:00'],
        ['13:00', '17:00'],
      ],
    ],
    [
      'two touching intervals',
      [
        ['08:00', '12:00'],
        ['12:00', '17:00'],
      ],
    ],
    ['a day to the last quarter', [['00:00', '23:45']]],
  ])('accepts %s', (_, list) => {
    expect(intervalsError(list as [string, string][])).toBeNull();
  });

  it('refuses a third interval', () => {
    expect(
      intervalsError([
        ['08:00', '10:00'],
        ['11:00', '12:00'],
        ['13:00', '17:00'],
      ]),
    ).toBe('count');
  });

  it('refuses a time off the quarter-hour grid', () => {
    expect(intervalsError([['08:10', '17:00']])).toBe('grid');
  });

  it.each([
    ['closes before it opens', [['17:00', '08:00']]],
    ['closes as it opens', [['08:00', '08:00']]],
  ])('refuses an interval that %s', (_, list) => {
    expect(intervalsError(list as [string, string][])).toBe('order');
  });

  it('refuses two intervals that overlap', () => {
    expect(
      intervalsError([
        ['08:00', '13:00'],
        ['12:00', '17:00'],
      ]),
    ).toBe('overlap');
  });

  it('refuses two intervals given out of order', () => {
    expect(
      intervalsError([
        ['13:00', '17:00'],
        ['08:00', '12:00'],
      ]),
    ).toBe('overlap');
  });
});

describe('a weekly timetable', () => {
  it('starts Monday to Friday 08:00-17:00 with Saturday and Sunday closed', () => {
    expect(DEFAULT_HOURS).toEqual({
      fri: [['08:00', '17:00']],
      mon: [['08:00', '17:00']],
      sat: [],
      sun: [],
      thu: [['08:00', '17:00']],
      tue: [['08:00', '17:00']],
      wed: [['08:00', '17:00']],
    });
    expect(WEEKDAYS).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('accepts the seven days, each passing its rules', () => {
    expect(isWeeklyHours(DEFAULT_HOURS)).toBe(true);
    expect(
      isWeeklyHours(
        week({
          mon: [
            ['08:00', '12:00'],
            ['13:00', '17:00'],
          ],
          sun: [['10:00', '14:00']],
        }),
      ),
    ).toBe(true);
  });

  it('refuses a missing day', () => {
    const { sun: _sun, ...six } = DEFAULT_HOURS;
    expect(isWeeklyHours(six)).toBe(false);
  });

  it('refuses a key that is not a day', () => {
    expect(isWeeklyHours(week({ holiday: [] }))).toBe(false);
  });

  it.each([
    ['a day that is not a list', week({ mon: '08:00-17:00' })],
    ['an interval of one time', week({ mon: [['08:00']] })],
    ['an interval of numbers', week({ mon: [[8, 17]] })],
    ['a day breaking its rules', week({ tue: [['17:00', '08:00']] })],
    ['not an object', [['08:00', '17:00']]],
    ['nothing', null],
  ])('refuses %s', (_, value) => {
    expect(isWeeklyHours(value)).toBe(false);
  });
});

describe('the closed days as they are kept', () => {
  it('accepts days with and without a note', () => {
    expect(
      closedDaysError([
        { day: '2026-12-27', note: 'Inventar' },
        { day: '2026-12-28' },
      ]),
    ).toBeNull();
  });

  it(`accepts a note of ${CLOSED_NOTE_MAX} letters, counted as letters, not code units`, () => {
    expect(
      closedDaysError([{ day: '2026-12-27', note: '🚗'.repeat(80) }]),
    ).toBeNull();
    expect(CLOSED_NOTE_MAX).toBe(80);
  });

  it('refuses a note of 81 letters', () => {
    expect(
      closedDaysError([{ day: '2026-12-27', note: 'ș'.repeat(81) }]),
    ).not.toBeNull();
  });

  it('measures the note after trimming it', () => {
    expect(
      closedDaysError([{ day: '2026-12-27', note: `  ${'a'.repeat(80)}  ` }]),
    ).toBeNull();
  });

  it.each([
    ['a date that does not exist', [{ day: '2026-02-30' }]],
    ['a date not written YYYY-MM-DD', [{ day: '27.12.2026' }]],
    ['a date with a time', [{ day: '2026-12-27T00:00:00Z' }]],
    ['a note that is not text', [{ day: '2026-12-27', note: 5 }]],
    ['an entry with another key', [{ day: '2026-12-27', reason: 'x' }]],
    ['the same day twice', [{ day: '2026-12-27' }, { day: '2026-12-27' }]],
    ['a list that is not a list', { day: '2026-12-27' }],
  ])('refuses %s', (_, list) => {
    expect(closedDaysError(list)).not.toBeNull();
  });
});

describe('adding a closed day in the step', () => {
  const today = '2026-10-07';
  const holidays = ['2026-12-01', '2026-12-25'];

  it('takes today', () => {
    expect(closedDayError('2026-10-07', [], today, holidays)).toBeNull();
  });

  it('refuses a day before today', () => {
    expect(closedDayError('2026-10-06', [], today, holidays)).toBe('past');
  });

  it(`takes a day up to ${CLOSED_DAY_YEARS} years ahead and refuses the day after`, () => {
    expect(CLOSED_DAY_YEARS).toBe(2);
    expect(closedDayError('2028-10-07', [], today, holidays)).toBeNull();
    expect(closedDayError('2028-10-08', [], today, holidays)).toBe('tooFar');
  });

  it('counts two years from a 29 February to 28 February', () => {
    expect(closedDayError('2030-02-28', [], '2028-02-29', [])).toBeNull();
    expect(closedDayError('2030-03-01', [], '2028-02-29', [])).toBe('tooFar');
  });

  it('refuses a day already in the list', () => {
    expect(
      closedDayError('2026-12-27', [{ day: '2026-12-27' }], today, holidays),
    ).toBe('duplicate');
  });

  it('refuses a legal holiday', () => {
    expect(closedDayError('2026-12-01', [], today, holidays)).toBe('holiday');
  });

  it('takes a legal holiday when the calendar could not be read', () => {
    expect(closedDayError('2026-12-01', [], today, [])).toBeNull();
  });
});

describe('the step 5 section', () => {
  it('accepts a section without hours, closed days or facilities', () => {
    expect(isHoursSection({})).toBe(true);
  });

  it("ignores the other stories' keys", () => {
    expect(
      isHoursSection({ address: { city: 'Cluj' }, photos: ['a.jpg'] }),
    ).toBe(true);
  });

  it('accepts the three keys filled in', () => {
    expect(
      isHoursSection({
        closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
        facilities: ['waiting_area', 'courtesy_car'],
        hours: DEFAULT_HOURS,
      }),
    ).toBe(true);
  });

  it('accepts a past closed day, which only the write drops', () => {
    expect(isHoursSection({ closedDays: [{ day: '2020-01-01' }] })).toBe(true);
  });

  it('knows exactly three facilities', () => {
    expect(FACILITIES).toEqual([
      'courtesy_car',
      'pickup_dropoff',
      'waiting_area',
    ]);
  });

  it.each([
    ['an unknown facility', { facilities: ['car_wash'] }],
    ['a repeated facility', { facilities: ['waiting_area', 'waiting_area'] }],
    ['facilities that are not a list', { facilities: 'waiting_area' }],
    ['hours breaking a rule', { hours: week({ mon: [['08:10', '17:00']] }) }],
    ['a bad closed day', { closedDays: [{ day: 'mâine' }] }],
    ['a section that is not an object', ['hours']],
    ['nothing', null],
  ])('refuses %s', (_, section) => {
    expect(isHoursSection(section)).toBe(false);
  });
});

describe('the payment methods and the courtesy car in the section', () => {
  it('offers cash, card and bank transfer', () => {
    expect(PAYMENTS).toEqual(['cash', 'card', 'transfer']);
  });

  it('prices the courtesy car from 1 to 2,000 lei a day in whole lei', () => {
    expect(COURTESY_PRICE_MIN_BANI).toBe(100);
    expect(COURTESY_PRICE_MAX_BANI).toBe(200_000);
    expect(COURTESY_PRICE_STEP_BANI).toBe(100);
  });

  it.each([
    ['a section kept before payments existed', {}],
    ['no payment ticked yet', { payments: [] }],
    ['every payment ticked', { payments: ['cash', 'card', 'transfer'] }],
    ['a free courtesy car', { courtesyCar: { paid: false } }],
    [
      'a paid courtesy car',
      { courtesyCar: { paid: true, pricePerDayBani: 12_000 } },
    ],
    ['the lowest price', { courtesyCar: { paid: true, pricePerDayBani: 100 } }],
    [
      'the highest price',
      { courtesyCar: { paid: true, pricePerDayBani: 200_000 } },
    ],
    ['paid with the price still to type', { courtesyCar: { paid: true } }],
    [
      'a courtesy car the facilities do not list',
      { courtesyCar: { paid: false }, facilities: ['waiting_area'] },
    ],
  ])('accepts %s', (_, section) => {
    expect(isHoursSection(section)).toBe(true);
  });

  it.each([
    ['an unknown payment', { payments: ['crypto'] }],
    ['a repeated payment', { payments: ['cash', 'cash'] }],
    ['payments that are not a list', { payments: 'cash' }],
    ['a courtesy car that is not an object', { courtesyCar: true }],
    [
      'a courtesy car without paid',
      { courtesyCar: { pricePerDayBani: 1_000 } },
    ],
    ['paid that is not a boolean', { courtesyCar: { paid: 'yes' } }],
    [
      'a courtesy car with another key',
      { courtesyCar: { km: 100, paid: false } },
    ],
    [
      'a price below 1 leu',
      { courtesyCar: { paid: true, pricePerDayBani: 50 } },
    ],
    [
      'a price above 2,000 lei',
      { courtesyCar: { paid: true, pricePerDayBani: 200_100 } },
    ],
    [
      'a price that is not whole lei',
      { courtesyCar: { paid: true, pricePerDayBani: 150 } },
    ],
    [
      'a price that is not an integer',
      { courtesyCar: { paid: true, pricePerDayBani: 1_000.5 } },
    ],
    [
      'a price as text',
      { courtesyCar: { paid: true, pricePerDayBani: '1000' } },
    ],
  ])('refuses %s', (_, section) => {
    expect(isHoursSection(section)).toBe(false);
  });
});

describe('a complete step 5', () => {
  const car = ['courtesy_car'] as const;

  it('needs at least one payment method', () => {
    expect(hoursComplete({})).toBe(false);
    expect(hoursComplete({ payments: [] })).toBe(false);
    expect(hoursComplete({ payments: ['transfer'] })).toBe(true);
  });

  it('needs no price for a free courtesy car', () => {
    expect(
      hoursComplete({
        courtesyCar: { paid: false },
        facilities: [...car],
        payments: ['cash'],
      }),
    ).toBe(true);
  });

  it('needs a price for a paid courtesy car', () => {
    expect(
      hoursComplete({
        courtesyCar: { paid: true },
        facilities: [...car],
        payments: ['cash'],
      }),
    ).toBe(false);
    expect(
      hoursComplete({
        courtesyCar: { paid: true, pricePerDayBani: 12_000 },
        facilities: [...car],
        payments: ['cash'],
      }),
    ).toBe(true);
  });

  it('refuses a paid price outside the range or not in whole lei', () => {
    for (const pricePerDayBani of [50, 150, 200_100])
      expect(
        hoursComplete({
          courtesyCar: { paid: true, pricePerDayBani },
          facilities: [...car],
          payments: ['card'],
        }),
      ).toBe(false);
  });

  it('ignores the courtesy car when the facilities do not list it', () => {
    expect(
      hoursComplete({
        courtesyCar: { paid: true },
        facilities: ['waiting_area'],
        payments: ['card'],
      }),
    ).toBe(true);
  });
});

describe("today's date in Bucharest", () => {
  it('is the Bucharest calendar day, not the UTC one', () => {
    expect(todayInBucharest(new Date('2026-10-07T21:30:00Z'))).toBe(
      '2026-10-08',
    );
    expect(todayInBucharest(new Date('2026-01-15T21:59:00Z'))).toBe(
      '2026-01-15',
    );
    expect(todayInBucharest(new Date('2026-01-15T22:00:00Z'))).toBe(
      '2026-01-16',
    );
  });
});

import { DEFAULT_HOURS } from '@motor-fix/contracts/garage-hours';

import {
  addBreak,
  addClosedDay,
  hoursOf,
  mergeHours,
  removeBreak,
  removeClosedDay,
  setDay,
  setWeekdays,
  simpleRows,
  toggleClosed,
  toggleFacility,
} from './hours-section';

const TODAY = '2026-10-07';
const HOLIDAYS = ['2026-12-01', '2026-12-25'];

const data = (section: unknown) => ({ steps: { '5': section } });

describe('reading the step 5 section of a draft', () => {
  it('reads nothing from a draft without the section', () => {
    expect(hoursOf({})).toEqual({});
    expect(hoursOf({ steps: { '2': { brands: [] } } })).toEqual({});
  });

  it('reads the three keys back', () => {
    const section = {
      closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
      facilities: ['waiting_area'],
      hours: DEFAULT_HOURS,
    };

    expect(hoursOf(data(section))).toEqual(section);
  });

  it('reads a key that is not in shape as absent, keeping the others', () => {
    expect(
      hoursOf(
        data({
          closedDays: [{ day: '2026-12-27' }],
          facilities: ['car_wash'],
          hours: { ...DEFAULT_HOURS, mon: [['17:00', '08:00']] },
        }),
      ),
    ).toEqual({ closedDays: [{ day: '2026-12-27' }] });
  });
});

describe('putting the values back into the section', () => {
  it("keeps the other steps' keys of the section", () => {
    expect(
      mergeHours(
        { address: { city: 'Cluj' }, facilities: ['courtesy_car'] },
        { facilities: ['waiting_area'], hours: DEFAULT_HOURS },
      ),
    ).toEqual({
      address: { city: 'Cluj' },
      facilities: ['waiting_area'],
      hours: DEFAULT_HOURS,
    });
  });

  it('drops a key that is absent, or an empty list', () => {
    expect(
      mergeHours(
        {
          closedDays: [{ day: '2026-12-27' }],
          facilities: ['waiting_area'],
          hours: DEFAULT_HOURS,
          photos: ['a.jpg'],
        },
        { closedDays: [], facilities: [] },
      ),
    ).toEqual({ photos: ['a.jpg'] });
  });

  it('starts a section that was not there', () => {
    expect(mergeHours(undefined, { facilities: ['waiting_area'] })).toEqual({
      facilities: ['waiting_area'],
    });
  });
});

describe('the simple rows over the days', () => {
  it('shows the common weekday interval and a closed Saturday at the start', () => {
    expect(simpleRows(DEFAULT_HOURS)).toEqual({
      saturday: null,
      weekdays: ['08:00', '17:00'],
    });
  });

  it('shows an open Saturday', () => {
    expect(
      simpleRows({ ...DEFAULT_HOURS, sat: [['09:00', '13:00']] }).saturday,
    ).toEqual(['09:00', '13:00']);
  });

  it('says the weekdays differ when one of them has a break', () => {
    expect(
      simpleRows({
        ...DEFAULT_HOURS,
        mon: [
          ['08:00', '12:00'],
          ['13:00', '17:00'],
        ],
      }).weekdays,
    ).toBe('differs');
  });

  it('says the weekdays differ when one closes at another time', () => {
    expect(
      simpleRows({ ...DEFAULT_HOURS, fri: [['08:00', '15:00']] }).weekdays,
    ).toBe('differs');
  });

  it('says the weekdays differ when one of them is closed', () => {
    expect(simpleRows({ ...DEFAULT_HOURS, wed: [] }).weekdays).toBe('differs');
  });

  it('ignores Sunday', () => {
    expect(
      simpleRows({ ...DEFAULT_HOURS, sun: [['10:00', '14:00']] }).weekdays,
    ).toEqual(['08:00', '17:00']);
  });
});

describe('changing the hours', () => {
  it('sets all five weekdays to one interval and leaves the weekend', () => {
    const hours = setWeekdays(
      { ...DEFAULT_HOURS, sat: [['09:00', '13:00']], tue: [] },
      ['08:30', '18:00'],
    );

    expect(hours).toEqual({
      fri: [['08:30', '18:00']],
      mon: [['08:30', '18:00']],
      sat: [['09:00', '13:00']],
      sun: [],
      thu: [['08:30', '18:00']],
      tue: [['08:30', '18:00']],
      wed: [['08:30', '18:00']],
    });
  });

  it('sets one day and leaves the others', () => {
    const hours = setDay(DEFAULT_HOURS, 'sun', [['10:00', '14:00']]);

    expect(hours.sun).toEqual([['10:00', '14:00']]);
    expect(hours.mon).toEqual([['08:00', '17:00']]);
    expect(DEFAULT_HOURS.sun).toEqual([]);
  });

  it('closes an open day and opens a closed one at 08:00-17:00', () => {
    const closed = toggleClosed(
      { ...DEFAULT_HOURS, sat: [['09:00', '13:00']] },
      'sat',
    );
    expect(closed.sat).toEqual([]);

    expect(toggleClosed(closed, 'sat').sat).toEqual([['08:00', '17:00']]);
  });

  it('splits a day around a break', () => {
    expect(addBreak(['08:00', '17:00'], '12:00', '13:00')).toEqual([
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ]);
  });

  it.each([
    ['starts before the day opens', '07:00', '09:00'],
    ['ends after the day closes', '16:00', '18:00'],
    ['starts as the day opens', '08:00', '09:00'],
    ['ends as the day closes', '16:00', '17:00'],
    ['ends before it starts', '13:00', '12:00'],
    ['takes no time', '12:00', '12:00'],
  ])('refuses a break that %s', (_, from, to) => {
    expect(addBreak(['08:00', '17:00'], from, to)).toBe('breakOutside');
  });

  it('joins the two intervals again when the break is removed', () => {
    expect(
      removeBreak([
        ['08:00', '12:00'],
        ['13:00', '17:00'],
      ]),
    ).toEqual([['08:00', '17:00']]);
  });
});

describe('the closed days', () => {
  it('adds a day with its note, in day order', () => {
    expect(
      addClosedDay(
        [{ day: '2026-12-28' }],
        '2026-12-27',
        'Inventar',
        TODAY,
        HOLIDAYS,
      ),
    ).toEqual([{ day: '2026-12-27', note: 'Inventar' }, { day: '2026-12-28' }]);
  });

  it('trims the note and reads a blank one as none', () => {
    expect(addClosedDay([], '2026-12-27', '   ', TODAY, HOLIDAYS)).toEqual([
      { day: '2026-12-27' },
    ]);
    expect(
      addClosedDay([], '2026-12-27', '  Inventar ', TODAY, HOLIDAYS),
    ).toEqual([{ day: '2026-12-27', note: 'Inventar' }]);
  });

  it.each([
    ['a day before today', '2026-10-06', 'past'],
    ['a day more than two years ahead', '2028-10-08', 'tooFar'],
    ['a legal holiday', '2026-12-01', 'holiday'],
    ['a day already in the list', '2026-12-28', 'duplicate'],
  ])('refuses %s with its reason', (_, day, reason) => {
    expect(
      addClosedDay([{ day: '2026-12-28' }], day, '', TODAY, HOLIDAYS),
    ).toBe(reason);
  });

  it('refuses a note over 80 letters', () => {
    expect(
      addClosedDay([], '2026-12-27', 'ș'.repeat(81), TODAY, HOLIDAYS),
    ).toBe('note');
  });

  it('takes a legal holiday when the calendar is not known', () => {
    expect(addClosedDay([], '2026-12-01', '', TODAY, [])).toEqual([
      { day: '2026-12-01' },
    ]);
  });

  it('removes a day', () => {
    expect(
      removeClosedDay(
        [{ day: '2026-12-27', note: 'Inventar' }, { day: '2026-12-28' }],
        '2026-12-27',
      ),
    ).toEqual([{ day: '2026-12-28' }]);
  });
});

describe('the facilities', () => {
  it('ticks a facility, keeping the fixed order', () => {
    expect(toggleFacility(['waiting_area'], 'courtesy_car')).toEqual([
      'courtesy_car',
      'waiting_area',
    ]);
  });

  it('unticks a ticked one and never holds one twice', () => {
    expect(
      toggleFacility(['courtesy_car', 'waiting_area'], 'waiting_area'),
    ).toEqual(['courtesy_car']);
    expect(toggleFacility([], 'pickup_dropoff')).toEqual(['pickup_dropoff']);
  });
});

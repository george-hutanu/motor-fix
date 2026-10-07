import {
  CLOSED_NOTE_MAX,
  DEFAULT_HOURS,
  type Facility,
  type Interval,
} from '@motor-fix/contracts/garage-hours';

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

const today = '2026-10-07';

describe('reading the draft', () => {
  it.each([
    null,
    undefined,
    'x',
    5,
    [],
    {},
    { steps: null },
    { steps: [] },
    { steps: {} },
    { steps: { '5': null } },
    { steps: { '5': 'x' } },
    { steps: { '5': [] } },
  ])('finds nothing in %j', (data) => {
    expect(hoursOf(data)).toEqual({});
  });

  it('drops a key that is not in shape and keeps the others', () => {
    const got = hoursOf({
      steps: {
        '5': {
          closedDays: [{ day: '2026-12-27', note: 'x'.repeat(81) }],
          facilities: ['waiting_area'],
          hours: { mon: 'x' },
        },
      },
    });
    expect(got.hours).toBeUndefined();
    expect(got.closedDays).toBeUndefined();
    expect(got.facilities).toEqual(['waiting_area']);
  });

  it('does not read hours from another step', () => {
    expect(
      hoursOf({ steps: { '4': { facilities: ['waiting_area'] } } }),
    ).toEqual({});
  });
});

describe('merging into the section', () => {
  it('keeps other stories keys and does not mutate its input', () => {
    const section = { address: { street: 'x' }, facilities: ['courtesy_car'] };
    const copy = JSON.parse(JSON.stringify(section));
    const merged = mergeHours(section, { facilities: ['waiting_area'] });
    expect(merged['address']).toEqual({ street: 'x' });
    expect(merged['facilities']).toEqual(['waiting_area']);
    expect(section).toEqual(copy);
  });

  it('merges into an absent section', () => {
    expect(mergeHours(undefined, { facilities: ['waiting_area'] })).toEqual({
      facilities: ['waiting_area'],
    });
  });

  it('removes an old key the new value no longer holds', () => {
    const merged = mergeHours(
      { closedDays: [{ day: '2026-12-27' }], hours: DEFAULT_HOURS, photos: 1 },
      {},
    );
    expect(merged['hours']).toBeUndefined();
    expect(merged['closedDays']).toBeUndefined();
    expect(merged['photos']).toBe(1);
  });

  it('is idempotent', () => {
    const value = {
      facilities: ['waiting_area' as const],
      hours: DEFAULT_HOURS,
    };
    const once = mergeHours({ a: 1 }, value);
    expect(mergeHours(once, value)).toEqual(once);
  });
});

describe('simple rows', () => {
  it('shows the common interval and Saturday closed for the default', () => {
    expect(simpleRows(DEFAULT_HOURS)).toEqual({
      saturday: null,
      weekdays: ['08:00', '17:00'],
    });
  });

  it('shows Saturday open as its own interval', () => {
    const rows = simpleRows(setDay(DEFAULT_HOURS, 'sat', [['09:00', '13:00']]));
    expect(rows.saturday).toEqual(['09:00', '13:00']);
  });

  it('says the weekdays differ when one weekday is closed', () => {
    expect(simpleRows(setDay(DEFAULT_HOURS, 'wed', [])).weekdays).toBe(
      'differs',
    );
  });

  it('says the weekdays differ when one weekday differs by one step', () => {
    expect(
      simpleRows(setDay(DEFAULT_HOURS, 'fri', [['08:00', '16:45']])).weekdays,
    ).toBe('differs');
  });

  it('says the weekdays differ when Monday has a break', () => {
    expect(
      simpleRows(
        setDay(DEFAULT_HOURS, 'mon', [
          ['08:00', '12:00'],
          ['13:00', '17:00'],
        ]),
      ).weekdays,
    ).toBe('differs');
  });

  it('says the weekdays differ when every weekday is closed', () => {
    const closed = ['mon', 'tue', 'wed', 'thu', 'fri'].reduce(
      (hours, day) => setDay(hours, day as 'mon', []),
      DEFAULT_HOURS,
    );
    expect(simpleRows(closed).weekdays).not.toEqual(['08:00', '17:00']);
  });

  it('shows the common interval again once the days are made equal', () => {
    const odd = setDay(DEFAULT_HOURS, 'tue', [['09:00', '10:00']]);
    expect(
      simpleRows(setDay(odd, 'tue', [['08:00', '17:00']])).weekdays,
    ).toEqual(['08:00', '17:00']);
  });

  it('says Saturday differs when it holds a break', () => {
    const rows = simpleRows(
      setDay(DEFAULT_HOURS, 'sat', [
        ['08:00', '10:00'],
        ['11:00', '13:00'],
      ]),
    );
    expect(rows.saturday).toBe('differs');
  });
});

describe('editing the week', () => {
  it('sets Monday to Friday and leaves the weekend and the input alone', () => {
    const before = JSON.parse(JSON.stringify(DEFAULT_HOURS));
    const next = setWeekdays(DEFAULT_HOURS, ['09:00', '18:00']);
    expect(DEFAULT_HOURS).toEqual(before);
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri'] as const)
      expect(next[day]).toEqual([['09:00', '18:00']]);
    expect(next.sat).toEqual([]);
    expect(next.sun).toEqual([]);
  });

  it('overwrites a break on a weekday', () => {
    const split = setDay(DEFAULT_HOURS, 'mon', [
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ]);
    expect(setWeekdays(split, ['08:00', '17:00']).mon).toEqual([
      ['08:00', '17:00'],
    ]);
  });

  it('does not share interval arrays between weekdays', () => {
    const next = setWeekdays(DEFAULT_HOURS, ['09:00', '18:00']);
    expect(next.mon).not.toBe(next.tue);
  });

  it('opens a closed day and empties an open one, twice back to the start', () => {
    const open = toggleClosed(DEFAULT_HOURS, 'sat');
    expect(open.sat).toHaveLength(1);
    expect(toggleClosed(open, 'sat').sat).toEqual([]);
    expect(toggleClosed(DEFAULT_HOURS, 'mon').mon).toEqual([]);
  });

  it('empties a day that holds a break when ticked closed', () => {
    const split = setDay(DEFAULT_HOURS, 'mon', [
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ]);
    expect(toggleClosed(split, 'mon').mon).toEqual([]);
  });
});

describe('breaks', () => {
  const day: Interval = ['08:00', '17:00'];

  it('splits the day around a break inside it', () => {
    expect(addBreak(day, '12:00', '13:00')).toEqual([
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ]);
  });

  it.each([
    ['starts at the opening', '08:00', '09:00'],
    ['ends at the closing', '16:00', '17:00'],
    ['is the whole day', '08:00', '17:00'],
    ['starts before the opening', '07:00', '09:00'],
    ['ends after the closing', '16:00', '18:00'],
    ['is empty', '12:00', '12:00'],
    ['is inverted', '13:00', '12:00'],
  ])('refuses a break that %s', (_title, from, to) => {
    expect(addBreak(day, from, to)).toBe('breakOutside');
  });

  it('accepts the smallest break one step inside each end', () => {
    expect(addBreak(day, '08:15', '16:45')).toEqual([
      ['08:00', '08:15'],
      ['16:45', '17:00'],
    ]);
  });

  it('refuses any break in a day too short to hold one', () => {
    expect(addBreak(['08:00', '08:15'], '08:00', '08:15')).toBe('breakOutside');
  });

  it('removes a break and gives back the whole day', () => {
    const split = addBreak(day, '12:00', '13:00') as Interval[];
    expect(removeBreak(split)).toEqual([day]);
  });

  it('leaves a single interval as it is when the break is removed', () => {
    expect(removeBreak([day])).toEqual([day]);
  });
});

describe('closed days', () => {
  it('adds a day with its note', () => {
    expect(addClosedDay([], '2026-12-27', 'Inventar', today, [])).toEqual([
      { day: '2026-12-27', note: 'Inventar' },
    ]);
  });

  it('keeps the list in day order whatever the order of adding', () => {
    const a = addClosedDay([], '2026-12-27', '', today, []);
    const b = addClosedDay(a as never, '2026-11-01', '', today, []);
    expect((b as { day: string }[]).map((e) => e.day)).toEqual([
      '2026-11-01',
      '2026-12-27',
    ]);
  });

  it('trims the note and treats a blank note as none', () => {
    const trimmed = addClosedDay([], '2026-12-27', '  Inventar  ', today, []);
    expect(trimmed).toEqual([{ day: '2026-12-27', note: 'Inventar' }]);
    const blank = addClosedDay([], '2026-12-27', '   ', today, []);
    expect(blank).toEqual([{ day: '2026-12-27' }]);
  });

  it('accepts a note of exactly the limit and refuses one past it', () => {
    expect(
      addClosedDay([], '2026-12-27', 'a'.repeat(CLOSED_NOTE_MAX), today, []),
    ).toHaveLength(1);
    expect(
      addClosedDay(
        [],
        '2026-12-27',
        'a'.repeat(CLOSED_NOTE_MAX + 1),
        today,
        [],
      ),
    ).toBe('note');
  });

  it('counts a note in code points', () => {
    expect(
      addClosedDay([], '2026-12-27', '😀'.repeat(CLOSED_NOTE_MAX), today, []),
    ).toHaveLength(1);
    expect(
      addClosedDay(
        [],
        '2026-12-27',
        '😀'.repeat(CLOSED_NOTE_MAX + 1),
        today,
        [],
      ),
    ).toBe('note');
  });

  it('counts the limit after trimming', () => {
    const padded = ` ${'a'.repeat(CLOSED_NOTE_MAX)} `;
    expect(addClosedDay([], '2026-12-27', padded, today, [])).toHaveLength(1);
  });

  it('refuses a legal holiday, a past date and a date too far', () => {
    expect(addClosedDay([], '2026-12-01', '', today, ['2026-12-01'])).toBe(
      'holiday',
    );
    expect(addClosedDay([], '2026-10-06', '', today, [])).toBe('past');
    expect(addClosedDay([], '2028-10-08', '', today, [])).toBe('tooFar');
  });

  it('adds the same date once and reports the second as a duplicate', () => {
    const once = addClosedDay([], '2026-12-27', '', today, []);
    expect(addClosedDay(once as never, '2026-12-27', 'x', today, [])).toBe(
      'duplicate',
    );
  });

  it('does not change the list it was given', () => {
    const list = [{ day: '2026-12-27' }];
    addClosedDay(list, '2026-11-01', '', today, []);
    expect(list).toEqual([{ day: '2026-12-27' }]);
  });

  it('removes a day, and an unknown day changes nothing', () => {
    const list = [{ day: '2026-11-01' }, { day: '2026-12-27' }];
    expect(removeClosedDay(list, '2026-11-01')).toEqual([
      { day: '2026-12-27' },
    ]);
    expect(removeClosedDay(list, '2030-01-01')).toEqual(list);
    expect(removeClosedDay([], '2026-11-01')).toEqual([]);
  });
});

describe('facilities', () => {
  it('ticks and unticks one', () => {
    const on = toggleFacility([], 'waiting_area');
    expect(on).toEqual(['waiting_area']);
    expect(toggleFacility(on, 'waiting_area')).toEqual([]);
  });

  it('keeps the ticked set in the canonical order', () => {
    const got = toggleFacility(['waiting_area'], 'courtesy_car');
    expect(got).toEqual(['courtesy_car', 'waiting_area']);
  });

  it('does not change the list it was given', () => {
    const list: Facility[] = ['waiting_area'];
    toggleFacility(list, 'courtesy_car');
    expect(list).toEqual(['waiting_area']);
  });

  it('collapses a duplicated list while toggling another facility', () => {
    const got = toggleFacility(
      ['waiting_area', 'waiting_area'],
      'pickup_dropoff',
    );
    expect(got).toEqual(['pickup_dropoff', 'waiting_area']);
  });
});

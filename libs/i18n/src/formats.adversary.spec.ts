import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  ClockPipe,
  calendarNames,
  DayPipe,
  formatClock,
  formatDay,
  formatKm,
  formatLei,
  formatLeiRange,
  formatNum,
  formatPct,
  formatRating,
  I18n,
  KmPipe,
  LeiPipe,
  NumPipe,
  PctPipe,
  RatingPipe,
} from './index';

const MISSING = '—';

const hostileNumbers: unknown[] = [
  null,
  undefined,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '',
  '5',
  ' 5 ',
  '1e3',
  true,
  false,
  [],
  [5],
  {},
  BigInt(5),
  Object(5),
  () => 5,
  Symbol('5'),
];

const hostileInstants: unknown[] = [
  null,
  undefined,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  8.64e15 + 1,
  new Date(Number.NaN),
  '',
  '   ',
  'not a date',
  '2026-13-45',
  '2026-03-09T25:00:00Z',
  '1741523400000',
  '9 March 2026',
  'March 9, 2026',
  true,
  false,
  [],
  {},
  { getTime: () => 0 },
  BigInt(10),
  Symbol('now'),
];

const withGrouping = (n: number, separator: string): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, separator);

describe('formatLei at the edges', () => {
  it('uses an ordinary space before lei and a hyphen-minus for negatives', () => {
    for (const language of ['ro', 'en'] as const) {
      const text = formatLei(-140000, language);
      expect(text.codePointAt(0)).toBe(0x2d);
      expect(text.codePointAt(text.length - 4)).toBe(0x20);
      expect(text).not.toMatch(/[  −]/);
    }
  });

  it.each([
    [99, '0,99 lei', '0.99 lei'],
    [100, '1 lei', '1 lei'],
    [101, '1,01 lei', '1.01 lei'],
    [-5, '-0,05 lei', '-0.05 lei'],
    [-99, '-0,99 lei', '-0.99 lei'],
    [99900, '999 lei', '999 lei'],
    [100000, '1.000 lei', '1,000 lei'],
    [99999900, '999.999 lei', '999,999 lei'],
    [100000000, '1.000.000 lei', '1,000,000 lei'],
    [100000001, '1.000.000,01 lei', '1,000,000.01 lei'],
    [1.5, '0,02 lei', '0.02 lei'],
    [0.4, '0 lei', '0 lei'],
    [0.5, '0,01 lei', '0.01 lei'],
    [139999.5, '1.400 lei', '1,400 lei'],
    [Number.MIN_VALUE, '0 lei', '0 lei'],
  ])('writes %p bani as %p / %p', (bani, ro, en) => {
    expect(formatLei(bani, 'ro')).toBe(ro);
    expect(formatLei(bani, 'en')).toBe(en);
  });

  it('never prints a negative zero', () => {
    expect(formatLei(-0, 'ro')).toBe('0 lei');
    expect(formatLei(-0, 'en')).toBe('0 lei');
  });

  it.each(
    hostileNumbers.map((value, i) => [`${typeof value} #${i}`, value]),
  )('shows a dash for a %s value', (_kind, value) => {
    expect(formatLei(value, 'ro')).toBe(MISSING);
    expect(formatLei(value, 'en')).toBe(MISSING);
  });

  it('groups thousands correctly across a wide sweep of amounts', () => {
    for (let lei = 0; lei <= 30000; lei += 7) {
      expect(formatLei(lei * 100, 'ro')).toBe(`${withGrouping(lei, '.')} lei`);
      expect(formatLei(lei * 100, 'en')).toBe(`${withGrouping(lei, ',')} lei`);
    }
  });

  it('gives the same text when called twice and does not change on the other language in between', () => {
    const first = formatLei(140050, 'ro');
    formatLei(140050, 'en');
    expect(formatLei(140050, 'ro')).toBe(first);
    expect(first).toBe('1.400,50 lei');
  });
});

describe('formatLeiRange at the edges', () => {
  it('shows a single amount when the ends are equal, with decimals when needed', () => {
    expect(formatLeiRange(80000, 80000, 'ro')).toBe('800 lei');
    expect(formatLeiRange(80050, 80050, 'ro')).toBe('800,50 lei');
    expect(formatLeiRange(80050, 80050, 'en')).toBe('800.50 lei');
    expect(formatLeiRange(0, 0, 'en')).toBe('0 lei');
  });

  it('shows an inverted range as given', () => {
    expect(formatLeiRange(120000, 80000, 'ro')).toBe('1.200–800 lei');
    expect(formatLeiRange(120000, 80000, 'en')).toBe('1,200–800 lei');
  });

  it('gives both ends two decimals when either end is not whole lei', () => {
    expect(formatLeiRange(80000, 120050, 'ro')).toBe('800,00–1.200,50 lei');
    expect(formatLeiRange(80000, 120050, 'en')).toBe('800.00–1,200.50 lei');
    expect(formatLeiRange(80050, 120000, 'ro')).toBe('800,50–1.200,00 lei');
    expect(formatLeiRange(80050, 120000, 'en')).toBe('800.50–1,200.00 lei');
  });

  it('rounds fractional bani before deciding whether the ends are whole lei', () => {
    expect(formatLeiRange(80000.4, 120000, 'ro')).toBe('800–1.200 lei');
    expect(formatLeiRange(80000.6, 120000, 'ro')).toBe('800,01–1.200,00 lei');
  });

  it('uses an en dash with no spaces and one lei suffix', () => {
    const text = formatLeiRange(100, 200, 'en');
    expect(text).toBe('1–2 lei');
    expect(text.codePointAt(1)).toBe(0x2013);
  });

  it('handles negative and zero ends', () => {
    expect(formatLeiRange(-100, 200, 'ro')).toBe('-1–2 lei');
    expect(formatLeiRange(0, 100050, 'en')).toBe('0.00–1,000.50 lei');
  });

  it.each(
    hostileNumbers.map((value, i) => [`${typeof value} #${i}`, value]),
  )('shows a dash when one end is a %s value', (_kind, bad) => {
    expect(formatLeiRange(bad, 120000, 'ro')).toBe(MISSING);
    expect(formatLeiRange(80000, bad, 'ro')).toBe(MISSING);
    expect(formatLeiRange(bad, bad, 'en')).toBe(MISSING);
  });

  it('shows a dash for a missing end even when the other end is equal-looking', () => {
    expect(formatLeiRange(undefined, undefined, 'ro')).toBe(MISSING);
    expect(formatLeiRange(null, 80000, 'en')).toBe(MISSING);
  });
});

describe('formatRating at the edges', () => {
  it.each([
    [0, '0,0', '0.0'],
    [5, '5,0', '5.0'],
    [4.96, '5,0', '5.0'],
    [4.94, '4,9', '4.9'],
    [4.04, '4,0', '4.0'],
    [0.05, '0,1', '0.1'],
    [3.449, '3,4', '3.4'],
    [7.2, '7,2', '7.2'],
    [-1, '-1,0', '-1.0'],
    [12.34, '12,3', '12.3'],
    [1234.5, '1.234,5', '1,234.5'],
  ])('writes %p as %p / %p', (value, ro, en) => {
    expect(formatRating(value, 'ro')).toBe(ro);
    expect(formatRating(value, 'en')).toBe(en);
  });

  it.each(
    hostileNumbers.map((value, i) => [`${typeof value} #${i}`, value]),
  )('shows a dash for a %s value', (_kind, value) => {
    expect(formatRating(value, 'ro')).toBe(MISSING);
    expect(formatRating(value, 'en')).toBe(MISSING);
  });
});

describe('formatNum at the edges', () => {
  it.each([
    [0, '0', '0'],
    [1, '1', '1'],
    [999, '999', '999'],
    [1000, '1.000', '1,000'],
    [-12345.6, '-12.345,6', '-12,345.6'],
    [1000000000, '1.000.000.000', '1,000,000,000'],
    [0.5, '0,5', '0.5'],
    [0.1 + 0.2, '0,3', '0.3'],
    [Number.MAX_SAFE_INTEGER, '9.007.199.254.740.991', '9,007,199,254,740,991'],
  ])('writes %p as %p / %p', (value, ro, en) => {
    expect(formatNum(value, 'ro')).toBe(ro);
    expect(formatNum(value, 'en')).toBe(en);
  });

  it.each(
    hostileNumbers.map((value, i) => [`${typeof value} #${i}`, value]),
  )('shows a dash for a %s value', (_kind, value) => {
    expect(formatNum(value, 'ro')).toBe(MISSING);
    expect(formatNum(value, 'en')).toBe(MISSING);
  });
});

describe('formatKm at the edges', () => {
  it.each([
    [0, '0 km', '0 km'],
    [12, '12 km', '12 km'],
    [0.25, '0,3 km', '0.3 km'],
    [0.04, '0 km', '0 km'],
    [2.04, '2 km', '2 km'],
    [2.96, '3 km', '3 km'],
    [2.5, '2,5 km', '2.5 km'],
    [999.95, '1.000 km', '1,000 km'],
    [1234.56, '1.234,6 km', '1,234.6 km'],
    [-2.5, '-2,5 km', '-2.5 km'],
  ])('writes %p as %p / %p', (value, ro, en) => {
    expect(formatKm(value, 'ro')).toBe(ro);
    expect(formatKm(value, 'en')).toBe(en);
  });

  it('uses an ordinary space before km', () => {
    expect(formatKm(3, 'ro').codePointAt(1)).toBe(0x20);
    expect(formatKm(3, 'en').codePointAt(1)).toBe(0x20);
  });

  it.each(
    hostileNumbers.map((value, i) => [`${typeof value} #${i}`, value]),
  )('shows a dash for a %s value', (_kind, value) => {
    expect(formatKm(value, 'ro')).toBe(MISSING);
    expect(formatKm(value, 'en')).toBe(MISSING);
  });
});

describe('formatPct at the edges', () => {
  it.each([
    [0, '0%'],
    [92, '92%'],
    [92.4, '92%'],
    [92.5, '93%'],
    [0.5, '1%'],
    [0.49, '0%'],
    [99.5, '100%'],
    [100, '100%'],
    [150, '150%'],
    [-5, '-5%'],
  ])('writes %p as %p in both languages', (value, text) => {
    expect(formatPct(value, 'ro')).toBe(text);
    expect(formatPct(value, 'en')).toBe(text);
  });

  it('has no space before the percent sign', () => {
    expect(formatPct(92, 'ro')).not.toMatch(/\s/);
    expect(formatPct(92, 'en')).not.toMatch(/\s/);
  });

  it.each(
    hostileNumbers.map((value, i) => [`${typeof value} #${i}`, value]),
  )('shows a dash for a %s value', (_kind, value) => {
    expect(formatPct(value, 'ro')).toBe(MISSING);
    expect(formatPct(value, 'en')).toBe(MISSING);
  });
});

describe('formatDay and formatClock in Bucharest time', () => {
  const RO_MONTHS = [
    'ian.',
    'feb.',
    'mart.',
    'apr.',
    'mai',
    'iun.',
    'iul.',
    'aug.',
    'sept.',
    'oct.',
    'nov.',
    'dec.',
  ];
  const EN_MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  it.each(
    RO_MONTHS.map((name, month) => [month, name, EN_MONTHS[month]]),
  )('names month %p as %p / %p', (month, ro, en) => {
    const noon = Date.UTC(2026, month as number, 15, 9);
    expect(formatDay(noon, 'ro')).toBe(`15 ${ro} 2026`);
    expect(formatDay(noon, 'en')).toBe(`15 ${en} 2026`);
  });

  it('accepts a Date, an ISO string and epoch milliseconds for the same instant', () => {
    const inputs = [
      new Date('2026-03-09T12:30:00Z'),
      '2026-03-09T12:30:00Z',
      '2026-03-09T12:30:00.000Z',
      '2026-03-09T14:30:00+02:00',
      '2026-03-09T07:30:00-05:00',
      Date.UTC(2026, 2, 9, 12, 30),
    ];
    for (const input of inputs) {
      expect(formatDay(input, 'ro')).toBe('9 mart. 2026');
      expect(formatDay(input, 'en')).toBe('9 Mar 2026');
      expect(formatClock(input)).toBe('14:30');
    }
  });

  it('writes a single-digit day without a leading zero and a single-digit hour with one', () => {
    expect(formatDay('2026-03-01T12:00:00Z', 'en')).toBe('1 Mar 2026');
    expect(formatClock('2026-01-15T07:05:00Z')).toBe('09:05');
    expect(formatClock('2026-01-15T00:00:00Z')).toBe('02:00');
  });

  it('writes midnight Bucharest as 00:00 and never 24:00', () => {
    expect(formatClock('2026-03-08T22:00:00Z')).toBe('00:00');
    expect(formatClock('2026-03-08T22:59:00Z')).toBe('00:59');
    expect(formatClock('2026-07-08T21:00:00Z')).toBe('00:00');
  });

  it('rolls the calendar day over at Bucharest midnight, not UTC midnight', () => {
    expect(formatDay('2026-03-08T23:30:00Z', 'ro')).toBe('9 mart. 2026');
    expect(formatDay('2026-03-08T23:30:00Z', 'en')).toBe('9 Mar 2026');
    expect(formatDay('2026-03-08T21:59:59Z', 'en')).toBe('8 Mar 2026');
    expect(formatDay('2026-03-08T22:00:00Z', 'en')).toBe('9 Mar 2026');
  });

  it('rolls the year over at Bucharest midnight on new year', () => {
    expect(formatDay('2026-12-31T21:59:59Z', 'en')).toBe('31 Dec 2026');
    expect(formatDay('2026-12-31T22:00:00Z', 'en')).toBe('1 Jan 2027');
    expect(formatDay('2026-12-31T22:00:00Z', 'ro')).toBe('1 ian. 2027');
  });

  it('follows summer time: UTC+3 from the last Sunday of March to the last Sunday of October', () => {
    expect(formatClock('2026-03-29T00:59:00Z')).toBe('02:59');
    expect(formatClock('2026-03-29T01:00:00Z')).toBe('04:00');
    expect(formatClock('2026-07-01T12:30:00Z')).toBe('15:30');
    expect(formatClock('2026-10-25T00:59:00Z')).toBe('03:59');
    expect(formatClock('2026-10-25T01:00:00Z')).toBe('03:00');
    expect(formatDay('2026-03-28T22:30:00Z', 'en')).toBe('29 Mar 2026');
    expect(formatDay('2026-07-01T21:30:00Z', 'en')).toBe('2 Jul 2026');
  });

  it('reads a date-only string as midnight UTC on the same Bucharest calendar day', () => {
    expect(formatDay('2026-03-09', 'ro')).toBe('9 mart. 2026');
    expect(formatDay('2026-03-09', 'en')).toBe('9 Mar 2026');
    expect(formatDay('2026-07-09', 'en')).toBe('9 Jul 2026');
    expect(formatDay('2026-01-01', 'en')).toBe('1 Jan 2026');
    expect(formatDay('2026-12-31', 'en')).toBe('31 Dec 2026');
    expect(formatClock('2026-03-09')).toBe('02:00');
  });

  it('handles the epoch and instants before it', () => {
    expect(formatDay(0, 'en')).toBe('1 Jan 1970');
    expect(formatClock(0)).toBe('02:00');
    expect(formatDay(-1, 'en')).toBe('1 Jan 1970');
    expect(formatDay(-86400000 * 2, 'ro')).toBe('30 dec. 1969');
  });

  it('does not change the Date it was given', () => {
    const at = new Date('2026-03-09T12:30:00Z');
    formatDay(at, 'ro');
    formatClock(at);
    expect(at.getTime()).toBe(Date.UTC(2026, 2, 9, 12, 30));
  });

  it('gives the same text for the same instant on every call', () => {
    const at = '2026-03-09T12:30:00Z';
    expect(formatDay(at, 'ro')).toBe(formatDay(at, 'ro'));
    expect(formatClock(at)).toBe(formatClock(at));
    expect(formatClock(at)).toBe('14:30');
  });

  it.each(
    hostileInstants.map((value, i) => [`${typeof value} #${i}`, value]),
  )('shows a dash for a %s value', (_kind, value) => {
    expect(formatDay(value, 'ro')).toBe(MISSING);
    expect(formatDay(value, 'en')).toBe(MISSING);
    expect(formatClock(value)).toBe(MISSING);
  });

  it('shows a dash for an invalid Date object rather than Invalid Date', () => {
    const text = formatDay(new Date('nope'), 'en');
    expect(text).toBe(MISSING);
    expect(text).not.toMatch(/Invalid|NaN/);
  });
});

describe('calendarNames', () => {
  const RO = {
    firstDay: 1,
    months: [
      'ianuarie',
      'februarie',
      'martie',
      'aprilie',
      'mai',
      'iunie',
      'iulie',
      'august',
      'septembrie',
      'octombrie',
      'noiembrie',
      'decembrie',
    ],
    monthsShort: [
      'ian.',
      'feb.',
      'mart.',
      'apr.',
      'mai',
      'iun.',
      'iul.',
      'aug.',
      'sept.',
      'oct.',
      'nov.',
      'dec.',
    ],
  };
  const EN = {
    days: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ],
    daysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    firstDay: 1,
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    monthsShort: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
  };

  it('has exactly the five documented keys per language', () => {
    expect(Object.keys(calendarNames('ro')).sort()).toEqual([
      'days',
      'daysShort',
      'firstDay',
      'months',
      'monthsShort',
    ]);
    expect(Object.keys(calendarNames('en')).sort()).toEqual([
      'days',
      'daysShort',
      'firstDay',
      'months',
      'monthsShort',
    ]);
  });

  it('lists the Romanian months and short months in order', () => {
    const names = calendarNames('ro');
    expect(names.firstDay).toBe(1);
    expect(names.months).toEqual(RO.months);
    expect(names.monthsShort).toEqual(RO.monthsShort);
  });

  it('lists the Romanian days from Monday to Sunday', () => {
    const names = calendarNames('ro');
    expect(names.days).toHaveLength(7);
    expect(names.daysShort).toHaveLength(7);
    expect(names.days[0]).toBe('luni');
    expect(names.days[6]).toBe('duminică');
    expect(names.daysShort[0]).toBe('lun.');
    expect(names.daysShort[6]).toBe('dum.');
  });

  it('lists the English names in order starting on Monday', () => {
    expect(calendarNames('en')).toEqual(EN);
  });

  it('uses the same short month names as the date format', () => {
    const ro = calendarNames('ro').monthsShort;
    const en = calendarNames('en').monthsShort;
    for (let month = 0; month < 12; month++) {
      const at = Date.UTC(2026, month, 15, 9);
      expect(formatDay(at, 'ro')).toBe(`15 ${ro[month]} 2026`);
      expect(formatDay(at, 'en')).toBe(`15 ${en[month]} 2026`);
    }
  });

  it('is not changed by a caller mutating an earlier result', () => {
    const first = calendarNames('ro') as { months: string[]; firstDay: number };
    try {
      first.months.push('extra');
      first.months[0] = 'changed';
      first.firstDay = 0;
    } catch {
      // a frozen result is also acceptable
    }
    const again = calendarNames('ro');
    expect(again.months).toEqual(RO.months);
    expect(again.firstDay).toBe(1);
  });

  it('returns equal content on every call', () => {
    expect(calendarNames('en')).toEqual(calendarNames('en'));
  });

  it('is a plain object that survives a JSON round trip', () => {
    expect(JSON.parse(JSON.stringify(calendarNames('ro')))).toEqual(
      calendarNames('ro'),
    );
  });
});

describe('format pipes against hostile and changing input', () => {
  @Component({
    imports: [
      ClockPipe,
      DayPipe,
      KmPipe,
      LeiPipe,
      NumPipe,
      PctPipe,
      RatingPipe,
    ],
    template: `
      <p id="price">{{ value() | lei }}</p>
      <p id="range">{{ value() | lei: other() }}</p>
      <p id="rating">{{ value() | rating }}</p>
      <p id="count">{{ value() | num }}</p>
      <p id="distance">{{ value() | km }}</p>
      <p id="share">{{ value() | pct }}</p>
      <p id="day">{{ at() | day }}</p>
      <p id="clock">{{ at() | clock }}</p>
    `,
  })
  class Host {
    readonly value = signal<unknown>(140000);
    readonly other = signal<unknown>(150000);
    readonly at = signal<unknown>('2026-03-09T12:30:00Z');
  }

  const read = (view: HTMLElement) =>
    Object.fromEntries(
      [...view.querySelectorAll('p')].map((p) => [p.id, p.textContent?.trim()]),
    );

  it('reformats when the input changes without a language change', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const view = fixture.nativeElement as HTMLElement;
    expect(read(view)['price']).toBe('1.400 lei');
    expect(read(view)['range']).toBe('1.400–1.500 lei');
    expect(read(view)['day']).toBe('9 mart. 2026');

    fixture.componentInstance.value.set(250050);
    fixture.componentInstance.at.set('2026-12-31T22:30:00Z');
    await fixture.whenStable();

    expect(read(view)['price']).toBe('2.500,50 lei');
    expect(read(view)['range']).toBe('2.500,50–1.500,00 lei');
    expect(read(view)['day']).toBe('1 ian. 2027');
    expect(read(view)['clock']).toBe('00:30');
  });

  it('shows a dash in every pipe for null, undefined, NaN and a numeric string', async () => {
    for (const bad of [
      null,
      undefined,
      Number.NaN,
      '5',
      Number.POSITIVE_INFINITY,
    ]) {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.value.set(bad);
      fixture.componentInstance.other.set(bad);
      fixture.componentInstance.at.set(bad);
      await fixture.whenStable();
      expect(read(fixture.nativeElement)).toEqual({
        clock: MISSING,
        count: MISSING,
        day: MISSING,
        distance: MISSING,
        price: MISSING,
        range: MISSING,
        rating: MISSING,
        share: MISSING,
      });
      fixture.destroy();
    }
  });

  it('shows a dash for a range when only the second end is missing', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.other.set(null);
    await fixture.whenStable();
    expect(read(fixture.nativeElement)['range']).toBe(MISSING);
    expect(read(fixture.nativeElement)['price']).toBe('1.400 lei');
  });

  it('accepts epoch milliseconds and Date objects in the date pipes', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.at.set(Date.UTC(2026, 2, 9, 12, 30));
    await fixture.whenStable();
    expect(read(fixture.nativeElement)['clock']).toBe('14:30');

    fixture.componentInstance.at.set(new Date('2026-03-08T23:30:00Z'));
    await fixture.whenStable();
    expect(read(fixture.nativeElement)['day']).toBe('9 mart. 2026');
    expect(read(fixture.nativeElement)['clock']).toBe('01:30');
  });

  it('keeps two screens in step and gives a screen created after a switch the new language', async () => {
    const first = TestBed.createComponent(Host);
    await first.whenStable();
    await TestBed.inject(I18n).use('en');
    const second = TestBed.createComponent(Host);
    await first.whenStable();
    await second.whenStable();

    for (const fixture of [first, second]) {
      const text = read(fixture.nativeElement);
      expect([
        text['price'],
        text['range'],
        text['day'],
        text['clock'],
      ]).toEqual(['1,400 lei', '1,400–1,500 lei', '9 Mar 2026', '14:30']);
    }
  });

  it('switches back and forth many times and ends on the right format', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const i18n = TestBed.inject(I18n);
    for (let i = 0; i < 10; i++) {
      await i18n.use(i % 2 === 0 ? 'en' : 'ro');
      await fixture.whenStable();
    }
    expect(i18n.language()).toBe('ro');
    expect(read(fixture.nativeElement)['price']).toBe('1.400 lei');
    expect(read(fixture.nativeElement)['day']).toBe('9 mart. 2026');
  });
});

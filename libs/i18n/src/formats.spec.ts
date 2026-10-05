import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import {
  calendarNames,
  formatClock,
  formatDay,
  formatKm,
  formatLei,
  formatLeiRange,
  formatNum,
  formatPct,
  formatRating,
} from './formats';

const MISSING = '—';
const notNumbers = [null, undefined, Number.NaN, Infinity, '92'];

describe('formatLei', () => {
  it.each([
    [140000, '1.400 lei', '1,400 lei'],
    [140050, '1.400,50 lei', '1,400.50 lei'],
    [-140000, '-1.400 lei', '-1,400 lei'],
    [0, '0 lei', '0 lei'],
    [5, '0,05 lei', '0.05 lei'],
    [140049.6, '1.400,50 lei', '1,400.50 lei'],
    [-0.4, '0 lei', '0 lei'],
  ])('writes %p bani as %p / %p', (bani, ro, en) => {
    expect(formatLei(bani, 'ro')).toBe(ro);
    expect(formatLei(bani, 'en')).toBe(en);
  });

  it.each(notNumbers)('shows a dash for %p', (value) => {
    expect(formatLei(value, 'ro')).toBe(MISSING);
    expect(formatLei(value, 'en')).toBe(MISSING);
  });
});

describe('formatLeiRange', () => {
  it('joins the two ends with an en dash and no spaces', () => {
    expect(formatLeiRange(80000, 120000, 'ro')).toBe('800–1.200 lei');
    expect(formatLeiRange(80000, 120000, 'en')).toBe('800–1,200 lei');
  });

  it('shows one amount when both ends are equal', () => {
    expect(formatLeiRange(80000, 80000, 'ro')).toBe('800 lei');
  });

  it('gives both ends two decimals when either is not whole lei', () => {
    expect(formatLeiRange(80000, 120050, 'ro')).toBe('800,00–1.200,50 lei');
    expect(formatLeiRange(80050, 120000, 'en')).toBe('800.50–1,200.00 lei');
  });

  it('shows an inverted range as given', () => {
    expect(formatLeiRange(120000, 80000, 'ro')).toBe('1.200–800 lei');
  });

  it.each(notNumbers)('shows a dash when an end is %p', (value) => {
    expect(formatLeiRange(value, 80000, 'ro')).toBe(MISSING);
    expect(formatLeiRange(80000, value, 'en')).toBe(MISSING);
  });
});

describe('formatRating', () => {
  it.each([
    [4.9, '4,9', '4.9'],
    [5, '5,0', '5.0'],
    [4.96, '5,0', '5.0'],
    [4.04, '4,0', '4.0'],
  ])('writes %p as %p / %p', (value, ro, en) => {
    expect(formatRating(value, 'ro')).toBe(ro);
    expect(formatRating(value, 'en')).toBe(en);
  });

  it.each(notNumbers)('shows a dash for %p', (value) => {
    expect(formatRating(value, 'ro')).toBe(MISSING);
  });
});

describe('formatNum', () => {
  it.each([
    [12345.6, '12.345,6', '12,345.6'],
    [1400, '1.400', '1,400'],
    [7, '7', '7'],
  ])('writes %p as %p / %p', (value, ro, en) => {
    expect(formatNum(value, 'ro')).toBe(ro);
    expect(formatNum(value, 'en')).toBe(en);
  });

  it.each(notNumbers)('shows a dash for %p', (value) => {
    expect(formatNum(value, 'en')).toBe(MISSING);
  });
});

describe('formatKm', () => {
  it.each([
    [2.5, '2,5 km', '2.5 km'],
    [12, '12 km', '12 km'],
    [0.25, '0,3 km', '0.3 km'],
    [1234.5, '1.234,5 km', '1,234.5 km'],
  ])('writes %p km as %p / %p', (value, ro, en) => {
    expect(formatKm(value, 'ro')).toBe(ro);
    expect(formatKm(value, 'en')).toBe(en);
  });

  it.each(notNumbers)('shows a dash for %p', (value) => {
    expect(formatKm(value, 'ro')).toBe(MISSING);
  });
});

describe('formatPct', () => {
  it.each([
    [92, '92%'],
    [91.6, '92%'],
    [0, '0%'],
  ])('writes %p as %p in both languages', (value, text) => {
    expect(formatPct(value, 'ro')).toBe(text);
    expect(formatPct(value, 'en')).toBe(text);
  });

  it.each(notNumbers)('shows a dash for %p', (value) => {
    expect(formatPct(value, 'en')).toBe(MISSING);
  });
});

const SHORT_RO = [
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
const SHORT_EN = [
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

describe('dates and times', () => {
  // Jest cannot change the zone of its own process, so a child Node process
  // on another device zone runs the formats. Plain Node loads formats.ts only
  // while it keeps erasable TypeScript and `import type` relative imports.
  it.each([['America/New_York'], ['Pacific/Kiritimati']])(
    'read in Bucharest time on a device in %s',
    (zone) => {
      const script = `
      const f = await import(${JSON.stringify(join(__dirname, 'formats.ts'))});
      console.log(JSON.stringify([
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        f.formatDay('2026-03-08T23:30:00Z', 'ro'),
        f.formatDay('2026-03-09T21:30:00Z', 'en'),
        f.formatClock('2026-03-09T12:30:00Z'),
      ]));`;
      const out = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', script],
        { encoding: 'utf8', env: { ...process.env, TZ: zone } },
      );
      expect(JSON.parse(out)).toEqual([
        zone,
        '9 mart. 2026',
        '9 Mar 2026',
        '14:30',
      ]);
    },
  );

  it('writes 9 March 2026 with the short month of each language', () => {
    const instant = new Date('2026-03-09T10:00:00Z');
    expect(formatDay(instant, 'ro')).toBe('9 mart. 2026');
    expect(formatDay(instant, 'en')).toBe('9 Mar 2026');
  });

  it('uses every short month name of the table', () => {
    const days = SHORT_RO.map((_, m) => new Date(Date.UTC(2026, m, 15, 12)));
    expect(days.map((d) => formatDay(d, 'ro'))).toEqual(
      SHORT_RO.map((name) => `15 ${name} 2026`),
    );
    expect(days.map((d) => formatDay(d, 'en'))).toEqual(
      SHORT_EN.map((name) => `15 ${name} 2026`),
    );
  });

  it('takes the day in Bucharest, not on the device', () => {
    const instant = new Date('2026-03-08T23:30:00Z');
    expect(formatDay(instant, 'ro')).toBe('9 mart. 2026');
    expect(formatDay(instant, 'en')).toBe('9 Mar 2026');
  });

  it('accepts an ISO string and epoch milliseconds', () => {
    expect(formatDay('2026-03-09', 'ro')).toBe('9 mart. 2026');
    expect(formatDay('2026-03-09T10:00:00Z', 'en')).toBe('9 Mar 2026');
    expect(formatDay(Date.UTC(2026, 2, 9, 10), 'en')).toBe('9 Mar 2026');
    expect(formatClock('2026-03-09T14:30:00+02:00')).toBe('14:30');
  });

  it.each([
    ['2026-03-09T12:30:00Z', '14:30'],
    ['2026-07-01T06:05:00Z', '09:05'],
    ['2026-03-08T22:05:00Z', '00:05'],
  ])('writes %s as %s in Bucharest on a 24-hour clock', (iso, text) => {
    expect(formatClock(iso)).toBe(text);
    expect(formatClock(new Date(iso))).toBe(text);
  });

  it.each([
    'not a date',
    '9 March 2026',
    '92',
    '2026-03-09T14:30',
    new Date(Number.NaN),
    null,
    undefined,
    Number.NaN,
    {},
  ])('shows a dash for %p', (value) => {
    expect(formatDay(value, 'ro')).toBe(MISSING);
    expect(formatClock(value)).toBe(MISSING);
  });
});

describe('calendarNames', () => {
  it('names the Romanian months and days, weeks from Monday', () => {
    const names = calendarNames('ro');
    expect(names.firstDay).toBe(1);
    expect(names.months).toEqual([
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
    ]);
    expect(names.monthsShort).toEqual(SHORT_RO);
    expect(names.days).toEqual([
      'luni',
      'marți',
      'miercuri',
      'joi',
      'vineri',
      'sâmbătă',
      'duminică',
    ]);
    expect(names.daysShort).toEqual([
      'lun.',
      'mar.',
      'mie.',
      'joi',
      'vin.',
      'sâm.',
      'dum.',
    ]);
  });

  it('names the English months and days, weeks from Monday', () => {
    const names = calendarNames('en');
    expect(names.firstDay).toBe(1);
    expect(names.months[0]).toBe('January');
    expect(names.months[11]).toBe('December');
    expect(names.monthsShort).toEqual(SHORT_EN);
    expect(names.days).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(names.daysShort).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
  });
});

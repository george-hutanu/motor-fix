import { daysUntil, formatMonthYear } from './formats';

const MISSING = '—';

describe('daysUntil at the edges', () => {
  it('flips at the last millisecond before Bucharest midnight', () => {
    expect(daysUntil('2026-10-09', new Date('2026-10-08T20:59:59.999Z'))).toBe(
      1,
    );
    expect(daysUntil('2026-10-09', new Date('2026-10-08T21:00:00.000Z'))).toBe(
      0,
    );
  });

  it('flips at winter midnight to the millisecond', () => {
    expect(daysUntil('2027-01-02', new Date('2027-01-01T21:59:59.999Z'))).toBe(
      1,
    );
    expect(daysUntil('2027-01-02', new Date('2027-01-01T22:00:00.000Z'))).toBe(
      0,
    );
  });

  it('counts a whole leap year and a whole common year', () => {
    expect(daysUntil('2029-01-01', new Date('2028-01-01T10:00:00Z'))).toBe(366);
    expect(daysUntil('2028-01-01', new Date('2027-01-01T10:00:00Z'))).toBe(365);
  });

  it('knows 2100 is not a leap year', () => {
    expect(daysUntil('2100-03-01', new Date('2100-02-28T10:00:00Z'))).toBe(1);
    expect(
      daysUntil('2100-02-29', new Date('2100-02-28T10:00:00Z')),
    ).toBeNull();
  });

  it('counts across eight thousand years without losing a day', () => {
    expect(daysUntil('9999-12-31', new Date('1999-12-31T10:00:00Z'))).toBe(
      2921940,
    );
  });

  it.each([
    ' 2026-10-09',
    '2026-10-09 ',
    '2026-10-09\n',
    '2026-1-9',
    '26-10-09',
    '2026/10/09',
    '２０２６-１０-０９',
    '2026-00-10',
    '2026-10-00',
    '2026-10-32',
    '2026-04-31',
    '+2026-10-09',
    '2026-10-09T00:00:00',
    {},
    [],
    ['2026-10-09'],
    true,
  ])('has no count for %p', (value) => {
    expect(daysUntil(value, new Date('2026-10-08T10:00:00Z'))).toBeNull();
  });

  it('returns the same count when asked twice and in the other order', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    const first = [daysUntil('2026-10-16', now), daysUntil('2026-10-01', now)];
    const second = [daysUntil('2026-10-01', now), daysUntil('2026-10-16', now)];

    expect(first).toEqual([8, -7]);
    expect(second).toEqual([-7, 8]);
  });

  it('does not change the date it is given', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    daysUntil('2026-10-16', now);

    expect(now.toISOString()).toBe('2026-10-08T10:00:00.000Z');
  });
});

describe('formatMonthYear at the edges', () => {
  it.each([
    ['2027-01-01', 'ianuarie 2027', 'January 2027'],
    ['2027-01-31', 'ianuarie 2027', 'January 2027'],
    ['2027-02-28', 'februarie 2027', 'February 2027'],
    ['2028-02-29', 'februarie 2028', 'February 2028'],
    ['2027-12-31', 'decembrie 2027', 'December 2027'],
  ])('writes %s as the month it falls in', (day, ro, en) => {
    expect(formatMonthYear(day, 'ro')).toBe(ro);
    expect(formatMonthYear(day, 'en')).toBe(en);
  });

  it('puts the last evening of a year in the next year in Bucharest', () => {
    expect(formatMonthYear(new Date('2027-01-31T22:00:00Z'), 'en')).toBe(
      'February 2027',
    );
    expect(formatMonthYear(new Date('2027-01-31T21:59:59.999Z'), 'en')).toBe(
      'January 2027',
    );
  });

  it.each([
    '2027-13-01',
    '2027-02-30',
    '2100-02-29',
    '',
    ' 2027-06-15',
    '2027-6-15',
    {},
    [],
    true,
  ])('shows a dash for %p', (value) => {
    expect(formatMonthYear(value, 'ro')).toBe(MISSING);
    expect(formatMonthYear(value, 'en')).toBe(MISSING);
  });
});

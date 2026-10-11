import { isoWeek, monthStart } from './bucharest';

describe('monthStart', () => {
  it.each([
    ['2026-11-01', '2026-11-01'],
    ['2026-11-30', '2026-11-01'],
    ['2026-12-31', '2026-12-01'],
    ['2028-02-29', '2028-02-01'],
    ['2026-01-15', '2026-01-01'],
    ['2026-10-25', '2026-10-01'],
  ])('turns %s into %s', (day, first) => {
    expect(monthStart(day)).toBe(first);
  });
});

// @traces 143-FR-013
describe('isoWeek at the edges of the calendar', () => {
  it.each([
    ['2026-01-05', '2026-W02'],
    ['2026-03-02', '2026-W10'],
    ['2028-01-01', '2027-W52'],
    ['2028-01-03', '2028-W01'],
    ['2028-02-29', '2028-W09'],
    ['2032-12-31', '2032-W53'],
    ['2033-01-02', '2032-W53'],
    ['2033-01-03', '2033-W01'],
    ['2015-12-31', '2015-W53'],
    ['2016-01-03', '2015-W53'],
    ['2016-01-04', '2016-W01'],
    ['2100-01-01', '2099-W53'],
    ['2100-03-01', '2100-W09'],
    ['2027-12-31', '2027-W52'],
  ])('labels %s as %s', (day, week) => {
    expect(isoWeek(day)).toBe(week);
  });

  it('labels the seven days of a week alike', () => {
    const days = [
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ];

    expect(new Set(days.map(isoWeek))).toEqual(new Set(['2026-W41']));
  });

  it('labels the days across the autumn clock change by their own week', () => {
    expect(isoWeek('2026-10-25')).toBe('2026-W43');
    expect(isoWeek('2026-10-26')).toBe('2026-W44');
    expect(isoWeek('2026-03-29')).toBe('2026-W13');
  });
});

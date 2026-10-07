import { atLocal, localDay, monthStart } from './bucharest';

describe('monthStart', () => {
  it.each([
    ['2026-10-07', '2026-10-01'],
    ['2026-10-01', '2026-10-01'],
    ['2026-10-31', '2026-10-01'],
    ['2026-03-29', '2026-03-01'],
    ['2027-01-15', '2027-01-01'],
  ])('gives the first day of the month of %s', (day, first) => {
    expect(monthStart(day)).toBe(first);
  });

  it('starts the month at midnight in Bucharest, the evening before in UTC', () => {
    const now = new Date('2026-10-31T22:30:00Z');

    expect(localDay(now)).toBe('2026-11-01');
    expect(atLocal(monthStart(localDay(now)), 0)).toEqual(
      new Date('2026-10-31T22:00:00Z'),
    );
  });
});

import { addDays, addMonths, daysBetween, localDay } from './bucharest';

// @traces 068-FR-001
describe('addMonths at the edges of the calendar', () => {
  it.each([
    ['2024-02-29', 12, '2025-02-28'],
    ['2024-02-29', 48, '2028-02-29'],
    ['2023-02-28', 12, '2024-02-28'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2026-01-31', 2, '2026-03-31'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-08-31', 6, '2027-02-28'],
    ['2026-12-31', 2, '2027-02-28'],
    ['2096-02-29', 48, '2100-02-28'],
    ['2000-02-29', 12, '2001-02-28'],
    ['2000-02-29', 48, '2004-02-29'],
    ['2026-10-23', 0, '2026-10-23'],
    ['2026-10-23', -12, '2025-10-23'],
    ['2026-01-15', -1, '2025-12-15'],
    ['2026-03-31', -13, '2025-02-28'],
    ['2026-12-31', 12, '2027-12-31'],
    ['2026-11-30', 3, '2027-02-28'],
    ['2026-01-30', 1, '2026-02-28'],
    ['2028-01-30', 1, '2028-02-29'],
    ['2026-10-23', 120, '2036-10-23'],
  ])('moves %s by %i months to %s', (day, n, moved) => {
    expect(addMonths(day, n)).toBe(moved);
  });

  it('returns a calendar day in the shape the cycle stores', () => {
    expect(addMonths('2026-05-09', 12)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('puts the due date of a 29 February evening approval a year from the Bucharest day', () => {
    expect(addMonths(localDay(new Date('2028-02-29T22:30:00Z')), 12)).toBe(
      '2029-03-01',
    );
    expect(addMonths(localDay(new Date('2028-02-29T10:00:00Z')), 12)).toBe(
      '2029-02-28',
    );
  });

  it('never moves a day past the same day of the target month', () => {
    for (let n = 1; n <= 36; n += 1) {
      const moved = addMonths('2026-01-31', n);
      expect(Number(moved.slice(8))).toBeLessThanOrEqual(31);
      expect(daysBetween('2026-01-31', moved)).toBeGreaterThan(0);
    }
  });
});

// @traces 068-FR-003
describe('the reminder and grace arithmetic across the clock changes', () => {
  it('counts 30 days before 1 November 2026 over the end of summer time', () => {
    expect(addDays('2026-11-01', -30)).toBe('2026-10-02');
    expect(daysBetween('2026-10-02', '2026-11-01')).toBe(30);
  });

  it('counts 14 days of grace from 22 March 2027 over the spring change', () => {
    expect(addDays('2027-03-22', 14)).toBe('2027-04-05');
    expect(daysBetween('2027-03-22', '2027-04-05')).toBe(14);
  });

  it('reads the Bucharest day, not the UTC one, in the evening', () => {
    expect(localDay(new Date('2027-01-14T22:00:00Z'))).toBe('2027-01-15');
    expect(localDay(new Date('2027-01-14T21:59:59Z'))).toBe('2027-01-14');
    expect(localDay(new Date('2026-10-22T20:59:59Z'))).toBe('2026-10-22');
    expect(localDay(new Date('2026-10-22T21:00:00Z'))).toBe('2026-10-23');
  });
});

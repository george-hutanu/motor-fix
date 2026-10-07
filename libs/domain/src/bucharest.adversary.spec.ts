import { monthStart } from './bucharest';

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

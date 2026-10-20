import { formatDay, formatDayMonth } from './formats';

describe('formatDayMonth adversary', () => {
  // @traces 1354-FR-008
  it.each([
    [null, 'ro'],
    [undefined, 'en'],
    ['', 'ro'],
    ['not a date', 'en'],
    ['2026-13-45', 'ro'],
    [Number.NaN, 'en'],
  ] as const)(
    'writes the same placeholder as formatDay for %p',
    (value, language) => {
      expect(formatDayMonth(value, language)).toBe(formatDay(value, language));
    },
  );

  // @traces 1354-FR-008
  it('writes the first and last day of the year without a year', () => {
    expect(formatDayMonth('2026-01-01', 'ro')).toBe('1 ian.');
    expect(formatDayMonth('2026-12-31', 'en')).toBe('31 Dec');
  });

  // @traces 1354-FR-008
  it('moves a late-evening UTC instant to the next Bucharest day', () => {
    expect(formatDayMonth('2026-12-31T22:30:00Z', 'ro')).toBe('1 ian.');
    expect(formatDayMonth('2026-12-31T21:59:00Z', 'ro')).toBe('31 dec.');
  });

  // @traces 1354-FR-008
  it('writes September as in the row format in each language', () => {
    expect(formatDayMonth('2026-09-12', 'ro')).toBe('12 sept.');
    expect(formatDayMonth('2026-09-12', 'en')).toBe('12 Sep');
  });

  // @traces 1354-FR-008
  it('writes the leap day', () => {
    expect(formatDayMonth('2028-02-29', 'en')).toBe('29 Feb');
  });
});

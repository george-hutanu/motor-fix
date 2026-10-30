import { reportAge } from './report-age';

const MISSING = '—';

const now = new Date('2026-10-30T10:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// @traces 1389-FR-001
describe('reportAge under hostile values', () => {
  it.each(['', '   ', 'NaN', 'Infinity', '{}', '0000-00-00'])(
    'shows the missing mark for the string %p',
    (value) => {
      expect(reportAge(value, 'ro', now)).toBe(MISSING);
      expect(reportAge(value, 'en', now)).toBe(MISSING);
    },
  );

  it.each([{}, [], true, Symbol('x')])(
    'shows the missing mark for a non-time %p',
    (value) => {
      expect(reportAge(value, 'ro', now)).toBe(MISSING);
    },
  );

  it('shows the missing mark for an invalid Date', () => {
    expect(reportAge(new Date('nope'), 'en', now)).toBe(MISSING);
  });

  it.each([
    [21 * DAY, '21 de zile'],
    [100 * DAY, '100 de zile'],
    [101 * DAY, '101 zile'],
    [102 * DAY, '102 zile'],
    [119 * DAY, '119 zile'],
    [120 * DAY, '120 de zile'],
    [3650 * DAY, '3650 de zile'],
  ])('uses the Romanian plural form for %p ms', (ms, ro) => {
    expect(reportAge(ago(ms), 'ro', now)).toBe(ro);
  });

  it.each([
    [21 * MIN, '21 de minute'],
    [2 * MIN, '2 minute'],
    [20 * HOUR, '20 de ore'],
    [21 * HOUR, '21 de ore'],
    [2 * HOUR, '2 ore'],
  ])('uses the Romanian plural form for %p ms under a day', (ms, ro) => {
    expect(reportAge(ago(ms), 'ro', now)).toBe(ro);
  });

  it('stays in hours one millisecond before a day, and in days at the day', () => {
    expect(reportAge(ago(DAY - 1), 'en', now)).toBe('23 hours');
    expect(reportAge(ago(DAY), 'en', now)).toBe('1 day');
  });

  it('stays under a minute one millisecond before a minute, and in minutes at it', () => {
    expect(reportAge(ago(MIN - 1), 'en', now)).toBe('under a minute');
    expect(reportAge(ago(MIN), 'en', now)).toBe('1 minute');
  });

  it('stays in minutes one millisecond before an hour', () => {
    expect(reportAge(ago(HOUR - 1), 'en', now)).toBe('59 minutes');
  });

  it('reads a time far ahead of the clock as under a minute, never a negative', () => {
    expect(reportAge(ago(-5 * DAY), 'en', now)).toBe('under a minute');
  });

  it('reads a time with an offset against the same instant', () => {
    expect(reportAge('2026-10-29T13:00:00+03:00', 'en', now)).toBe('1 day');
  });

  it('answers the same twice for the same input', () => {
    const a = reportAge(ago(3 * HOUR), 'ro', now);
    expect(reportAge(ago(3 * HOUR), 'ro', now)).toBe(a);
    expect(a).toBe('3 ore');
  });
});

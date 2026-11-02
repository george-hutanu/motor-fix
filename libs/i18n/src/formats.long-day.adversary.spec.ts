import { formatLongDay } from './formats';

// @traces 1394-FR-003
describe('the long day under hostile values', () => {
  it.each([
    ['2026-02-30'],
    ['2026-13-01'],
    ['2026-00-10'],
    [''],
    ['  '],
    ['31 October 2026'],
    [NaN],
    [Infinity],
    [new Date('nope')],
    [undefined],
    [{}],
    [[]],
    [true],
  ])('shows the dash for %p', (value) => {
    expect(formatLongDay(value, 'ro')).toBe('—');
    expect(formatLongDay(value, 'en')).toBe('—');
  });

  it('turns to the next Bucharest day exactly at local midnight in winter', () => {
    expect(formatLongDay('2026-10-31T21:59:59Z', 'en')).toBe('31 October 2026');
    expect(formatLongDay('2026-10-31T22:00:00Z', 'en')).toBe('1 November 2026');
  });

  it('turns to the next Bucharest day exactly at local midnight in summer', () => {
    expect(formatLongDay('2026-07-14T20:59:59Z', 'ro')).toBe('14 iulie 2026');
    expect(formatLongDay('2026-07-14T21:00:00Z', 'ro')).toBe('15 iulie 2026');
  });

  it('keeps the calendar day on the day the clocks go back', () => {
    expect(formatLongDay('2026-10-25', 'ro')).toBe('25 octombrie 2026');
  });

  it('keeps the calendar day on the day the clocks go forward', () => {
    expect(formatLongDay('2026-03-29', 'en')).toBe('29 March 2026');
  });

  it('writes a leap day', () => {
    expect(formatLongDay('2028-02-29', 'ro')).toBe('29 februarie 2028');
  });

  it('writes the year end and start', () => {
    expect(formatLongDay('2026-12-31', 'ro')).toBe('31 decembrie 2026');
    expect(formatLongDay('2027-01-01', 'ro')).toBe('1 ianuarie 2027');
  });

  it('reads an instant given as epoch milliseconds', () => {
    expect(formatLongDay(Date.UTC(2026, 0, 5, 12), 'en')).toBe(
      '5 January 2026',
    );
  });

  it('reads an offset instant by the Bucharest day', () => {
    expect(formatLongDay('2026-10-31T23:30:00-05:00', 'en')).toBe(
      '1 November 2026',
    );
  });
});

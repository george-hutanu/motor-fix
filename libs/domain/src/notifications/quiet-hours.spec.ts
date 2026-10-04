import { isQuiet, nextMorning } from './quiet-hours';

// Bucharest is UTC+3 in summer and UTC+2 after the clocks go back at 04:00 on
// 25 October 2026.
describe('quiet hours in Bucharest', () => {
  it.each([
    ['2026-10-04T18:59:59Z', false],
    ['2026-10-04T19:00:00Z', true],
    ['2026-10-04T20:10:00Z', true],
    ['2026-10-04T23:00:00Z', true],
    ['2026-10-05T04:59:59Z', true],
    ['2026-10-05T05:00:00Z', false],
    ['2026-10-05T09:00:00Z', false],
    ['2026-12-01T20:00:00Z', true],
    ['2026-12-01T05:59:59Z', true],
    ['2026-12-01T06:00:00Z', false],
  ])('at %s is quiet: %s', (at, quiet) => {
    expect(isQuiet(new Date(at))).toBe(quiet);
  });

  it('holds a message built at 23:10 until 08:00 the next morning', () => {
    expect(nextMorning(new Date('2026-10-04T20:10:00Z')).toISOString()).toBe(
      '2026-10-05T05:00:00.000Z',
    );
  });

  it('holds a message built at 02:00 until 08:00 the same morning', () => {
    expect(nextMorning(new Date('2026-10-04T23:00:00Z')).toISOString()).toBe(
      '2026-10-05T05:00:00.000Z',
    );
  });

  it('releases at 08:00 local time across the clock change', () => {
    expect(nextMorning(new Date('2026-10-24T20:10:00Z')).toISOString()).toBe(
      '2026-10-25T06:00:00.000Z',
    );
  });

  it('releases at 08:00 local time in winter', () => {
    expect(nextMorning(new Date('2026-12-01T21:30:00Z')).toISOString()).toBe(
      '2026-12-02T06:00:00.000Z',
    );
  });

  it('releases at 08:00 local time across the spring clock change', () => {
    expect(nextMorning(new Date('2027-03-27T21:00:00Z')).toISOString()).toBe(
      '2027-03-28T05:00:00.000Z',
    );
  });
});

import { isQuiet, nextMorning } from './quiet-hours';

describe('quiet hours at the edges', () => {
  it.each([
    ['2026-10-04T18:59:59.999Z', false],
    ['2026-10-04T19:00:00.000Z', true],
    ['2026-10-05T04:59:59.999Z', true],
    ['2026-10-05T05:00:00.000Z', false],
    ['2026-01-15T19:59:59.999Z', false],
    ['2026-01-15T20:00:00.000Z', true],
    ['2026-01-16T05:59:59.999Z', true],
    ['2026-01-16T06:00:00.000Z', false],
  ])('at %s quiet is %s', (at, quiet) => {
    expect(isQuiet(new Date(at))).toBe(quiet);
  });

  it('follows the clock change of 25 October 2026', () => {
    expect(isQuiet(new Date('2026-10-24T18:59:59Z'))).toBe(false);
    expect(isQuiet(new Date('2026-10-24T19:00:00Z'))).toBe(true);
    expect(isQuiet(new Date('2026-10-25T05:59:59Z'))).toBe(true);
    expect(isQuiet(new Date('2026-10-25T06:00:00Z'))).toBe(false);
  });

  it('follows the spring clock change of 29 March 2026', () => {
    expect(isQuiet(new Date('2026-03-29T04:59:59Z'))).toBe(true);
    expect(isQuiet(new Date('2026-03-29T05:00:00Z'))).toBe(false);
    expect(isQuiet(new Date('2026-03-28T19:59:59Z'))).toBe(false);
    expect(isQuiet(new Date('2026-03-28T20:00:00Z'))).toBe(true);
  });

  it('is not quiet at midday', () => {
    expect(isQuiet(new Date('2026-07-01T09:00:00Z'))).toBe(false);
  });

  it('is quiet at Bucharest midnight', () => {
    expect(isQuiet(new Date('2026-07-01T21:00:00Z'))).toBe(true);
  });

  it('judges far-past and far-future instants by Bucharest time', () => {
    expect(isQuiet(new Date('1970-01-01T00:00:00Z'))).toBe(true);
    expect(isQuiet(new Date('2099-12-31T22:30:00Z'))).toBe(true);
  });
});

describe('the next morning', () => {
  it.each([
    ['2026-10-24T20:10:00Z', '2026-10-25T06:00:00.000Z'],
    ['2026-10-25T01:30:00Z', '2026-10-25T06:00:00.000Z'],
    ['2026-10-25T00:59:59Z', '2026-10-25T06:00:00.000Z'],
    ['2026-03-28T20:10:00Z', '2026-03-29T05:00:00.000Z'],
    ['2026-07-01T19:00:00Z', '2026-07-02T05:00:00.000Z'],
    ['2026-12-31T21:00:00Z', '2027-01-01T06:00:00.000Z'],
  ])('after %s is %s', (at, morning) => {
    expect(nextMorning(new Date(at)).toISOString()).toBe(morning);
  });

  it('is the following day when asked exactly at 08:00', () => {
    expect(nextMorning(new Date('2026-10-05T05:00:00Z')).toISOString()).toBe(
      '2026-10-06T05:00:00.000Z',
    );
  });

  it('is the same day one millisecond before 08:00', () => {
    expect(
      nextMorning(new Date('2026-10-05T04:59:59.999Z')).toISOString(),
    ).toBe('2026-10-05T05:00:00.000Z');
  });

  it('is always later than its input, within a day, and never quiet', () => {
    for (let h = 0; h < 24 * 14; h += 1) {
      const at = new Date(Date.UTC(2026, 9, 20, 0, 7) + h * 3_600_000);
      const next = nextMorning(at);
      expect(next.getTime()).toBeGreaterThan(at.getTime());
      expect(isQuiet(next)).toBe(false);
      expect(next.getTime() - at.getTime()).toBeLessThanOrEqual(25 * 3_600_000);
    }
  });

  it('does not mutate its input', () => {
    const at = new Date('2026-10-04T20:10:00Z');
    nextMorning(at);
    expect(at.toISOString()).toBe('2026-10-04T20:10:00.000Z');
  });
});

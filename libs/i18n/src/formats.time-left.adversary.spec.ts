import { timeLeft } from './formats';

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = new Date('2026-10-09T10:00:00Z');
const ahead = (ms: number) => new Date(now.getTime() + ms).toISOString();

// @traces 222-FR-007
describe('timeLeft at its boundaries', () => {
  it('reads exactly one hour as one hour', () => {
    expect(timeLeft(ahead(HOUR), 'ro', now)).toBe('încă 1 h');
    expect(timeLeft(ahead(HOUR), 'en', now)).toBe('1 h left');
  });

  it('reads one millisecond under an hour as 59 minutes', () => {
    expect(timeLeft(ahead(HOUR - 1), 'ro', now)).toBe('încă 59 min');
    expect(timeLeft(ahead(HOUR - 1), 'en', now)).toBe('59 min left');
  });

  it('reads exactly one minute as one minute', () => {
    expect(timeLeft(ahead(MIN), 'ro', now)).toBe('încă 1 min');
    expect(timeLeft(ahead(MIN), 'en', now)).toBe('1 min left');
  });

  it('reads one millisecond under a minute as moments', () => {
    expect(timeLeft(ahead(MIN - 1), 'ro', now)).toBe('încă câteva secunde');
    expect(timeLeft(ahead(MIN - 1), 'en', now)).toBe('moments left');
  });

  it('rounds hours down, never up', () => {
    expect(timeLeft(ahead(2 * HOUR - 1), 'en', now)).toBe('1 h left');
    expect(timeLeft(ahead(23 * HOUR + 59 * MIN), 'en', now)).toBe('23 h left');
  });

  it('reads 24 hours as 24 hours, not as days', () => {
    expect(timeLeft(ahead(24 * HOUR), 'en', now)).toBe('24 h left');
    expect(timeLeft(ahead(24 * HOUR), 'ro', now)).toBe('încă 24 h');
  });

  it('reads a very distant deadline in whole hours', () => {
    expect(timeLeft(ahead(1000 * HOUR), 'en', now)).toBe('1000 h left');
  });

  it('reads a deadline exactly now as moments', () => {
    expect(timeLeft(now.toISOString(), 'en', now)).toBe('moments left');
    expect(timeLeft(now.toISOString(), 'ro', now)).toBe('încă câteva secunde');
  });

  it.each([1, MIN, HOUR, 400 * HOUR])(
    'reads a deadline %i ms past as moments, never a negative number',
    (ms) => {
      expect(timeLeft(ahead(-ms), 'en', now)).toBe('moments left');
      expect(timeLeft(ahead(-ms), 'ro', now)).toBe('încă câteva secunde');
    },
  );
});

// @traces 222-FR-007
describe('timeLeft under hostile input', () => {
  it('takes a Date and an epoch number as it takes the ISO string', () => {
    const at = now.getTime() + 3 * HOUR;
    expect(timeLeft(new Date(at), 'en', now)).toBe('3 h left');
    expect(timeLeft(at, 'en', now)).toBe('3 h left');
  });

  it('reads an offset instant by its true moment', () => {
    expect(timeLeft('2026-10-09T15:30:00+03:00', 'en', now)).toBe('2 h left');
  });

  it.each([null, undefined, '', 'tomorrow', {}, [], true, NaN, Infinity])(
    'answers the dash for %p, in both languages',
    (value) => {
      expect(timeLeft(value, 'ro', now)).toBe('—');
      expect(timeLeft(value, 'en', now)).toBe('—');
    },
  );

  it('answers the dash for an invalid Date', () => {
    expect(timeLeft(new Date('nope'), 'en', now)).toBe('—');
  });

  it('answers the dash for a numeric string, which is not an instant', () => {
    expect(timeLeft('1790000000000', 'en', now)).toBe('—');
  });

  it('gives the same answer twice and leaves now untouched', () => {
    const before = now.getTime();
    const first = timeLeft(ahead(5 * HOUR), 'en', now);
    expect(timeLeft(ahead(5 * HOUR), 'en', now)).toBe(first);
    expect(now.getTime()).toBe(before);
  });
});

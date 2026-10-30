import { formatDeadline, quoteExpiry } from './quote-expiry';

const MISSING = '—';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = new Date('2026-10-09T10:00:00Z');
const ahead = (ms: number) => new Date(now.getTime() + ms);

// @traces 346-FR-003
describe('quoteExpiry at its boundaries', () => {
  it.each([
    [7 * DAY + 1, 'expiră în 8 zile', 'expires in 8 days'],
    [DAY + 1, 'expiră în 2 zile', 'expires in 2 days'],
    [HOUR - 1, 'expiră în 59 min', 'expires in 59 min'],
    [MIN - 1, 'expiră în câteva momente', 'expires in moments'],
    [HOUR + 1, 'expiră în 1 h', 'expires in 1 h'],
    [-1, 'expiră în câteva momente', 'expires in moments'],
    [-400 * DAY, 'expiră în câteva momente', 'expires in moments'],
    [30 * DAY, 'expiră în 30 de zile', 'expires in 30 days'],
  ])('words %p ms ahead as %p / %p', (ms, ro, en) => {
    expect(quoteExpiry(ahead(ms), 'ro', now)).toBe(ro);
    expect(quoteExpiry(ahead(ms), 'en', now)).toBe(en);
  });

  it.each([
    new Date('nope'),
    'not-a-date',
    '',
    Number.NaN,
    {},
    [],
    Number.POSITIVE_INFINITY,
  ])('shows a dash for %p', (value) => {
    expect(quoteExpiry(value, 'en', now)).toBe(MISSING);
  });

  it('answers the same for a Date and its ISO string', () => {
    const at = ahead(3 * HOUR + 5);
    expect(quoteExpiry(at, 'en', now)).toBe(
      quoteExpiry(at.toISOString(), 'en', now),
    );
  });
});

// @traces 346-FR-003
describe('formatDeadline across the Bucharest clock changes and midnight', () => {
  it('says tomorrow from the first instant of the next Bucharest day to its last, and not after', () => {
    expect(formatDeadline('2026-10-09T21:00:00Z', 'ro', now)).toBe(
      'mâine, 00:00',
    );
    expect(formatDeadline('2026-10-09T21:00:00Z', 'en', now)).toBe(
      'tomorrow, 00:00',
    );
    expect(formatDeadline('2026-10-10T20:59:59Z', 'ro', now)).toBe(
      'mâine, 23:59',
    );
    expect(formatDeadline('2026-10-09T20:59:59Z', 'ro', now)).toBe('23:59');
    expect(formatDeadline('2026-10-10T21:00:00Z', 'ro', now)).not.toMatch(
      /^mâine/,
    );
  });

  it('says tomorrow for 23:30 the day after the autumn clock change, from a 25-hour day', () => {
    const base = new Date('2026-10-25T10:00:00Z');
    expect(formatDeadline('2026-10-26T21:30:00Z', 'ro', base)).toBe(
      'mâine, 23:30',
    );
    expect(formatDeadline('2026-10-26T21:30:00Z', 'en', base)).toBe(
      'tomorrow, 23:30',
    );
  });

  it('does not say tomorrow for 00:30 two Bucharest days on, across the autumn change', () => {
    const base = new Date('2026-10-25T10:00:00Z');
    expect(formatDeadline('2026-10-26T22:30:00Z', 'ro', base)).not.toMatch(
      /^mâine/,
    );
    expect(formatDeadline('2026-10-26T22:30:00Z', 'en', base)).not.toMatch(
      /^tomorrow/,
    );
  });

  it('says tomorrow for 23:59 across the spring change and not for 00:00 a day later', () => {
    const base = new Date('2026-03-28T10:00:00Z');
    expect(formatDeadline('2026-03-29T20:59:00Z', 'ro', base)).toBe(
      'mâine, 23:59',
    );
    expect(formatDeadline('2026-03-29T21:00:00Z', 'ro', base)).not.toMatch(
      /^mâine/,
    );
  });

  it('does not say tomorrow when it is yesterday', () => {
    expect(formatDeadline('2026-10-08T11:30:00Z', 'ro', now)).not.toMatch(
      /^mâine/,
    );
    expect(formatDeadline('2026-10-08T11:30:00Z', 'en', now)).not.toMatch(
      /^tomorrow/,
    );
  });

  it.each([new Date('nope'), 'not-a-date', '', Number.NaN, {}, []])(
    'shows a dash for %p',
    (value) => {
      expect(formatDeadline(value, 'en', now)).toBe(MISSING);
    },
  );
});

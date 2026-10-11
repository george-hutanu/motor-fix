import { requestExpiry } from './formats';

const MARK = requestExpiry('not a time', 'ro', new Date());
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const now = new Date('2026-10-09T10:00:00Z');
const ahead = (ms: number) => new Date(now.getTime() + ms).toISOString();

// @traces 347-FR-003
describe('requestExpiry at its boundaries', () => {
  it('reads exactly 24 hours as one day, in both languages', () => {
    expect(requestExpiry(ahead(DAY), 'ro', now)).toBe('expiră în 1 zi');
    expect(requestExpiry(ahead(DAY), 'en', now)).toBe('expires in 1 day');
  });

  it('reads the last millisecond before 24 hours as 23 hours, rounded down', () => {
    expect(requestExpiry(ahead(DAY - 1), 'ro', now)).toBe(
      'expiră în 23 de ore',
    );
    expect(requestExpiry(ahead(DAY - 1), 'en', now)).toBe(
      'expires in 23 hours',
    );
  });

  it('reads exactly one hour as one hour and one millisecond less as under an hour', () => {
    expect(requestExpiry(ahead(HOUR), 'ro', now)).toBe('expiră în 1 oră');
    expect(requestExpiry(ahead(HOUR), 'en', now)).toBe('expires in 1 hour');
    expect(requestExpiry(ahead(HOUR - 1), 'ro', now)).toBe(
      'expiră în mai puțin de o oră',
    );
    expect(requestExpiry(ahead(HOUR - 1), 'en', now)).toBe(
      'expires in less than an hour',
    );
  });

  it('keeps "less than an hour" down to the last millisecond', () => {
    expect(requestExpiry(ahead(1), 'en', now)).toBe(
      'expires in less than an hour',
    );
  });

  it('says expired at the exact instant and for anything past, a year included', () => {
    expect(requestExpiry(now.toISOString(), 'ro', now)).toBe('a expirat');
    expect(requestExpiry(ahead(-1), 'en', now)).toBe('expired');
    expect(requestExpiry(ahead(-365 * DAY), 'ro', now)).toBe('a expirat');
  });

  it('rounds days down and puts "de" from 20 on', () => {
    expect(requestExpiry(ahead(2 * DAY + 23 * HOUR), 'en', now)).toBe(
      'expires in 2 days',
    );
    expect(requestExpiry(ahead(6 * DAY + 2 * HOUR), 'ro', now)).toBe(
      'expiră în 6 zile',
    );
    expect(requestExpiry(ahead(20 * DAY), 'ro', now)).toBe(
      'expiră în 20 de zile',
    );
    expect(requestExpiry(ahead(21 * HOUR), 'ro', now)).toBe(
      'expiră în 21 de ore',
    );
  });

  it('never prints "undefined", "NaN" or a negative count', () => {
    for (const ms of [-DAY, -1, 0, 1, HOUR, DAY, 400 * DAY]) {
      for (const language of ['ro', 'en'] as const) {
        expect(requestExpiry(ahead(ms), language, now)).not.toMatch(
          /undefined|NaN|-\d/,
        );
      }
    }
  });
});

// @traces 347-FR-003
describe('requestExpiry across the clock change in Europe/Bucharest', () => {
  it('counts the 25 real hours of the autumn change as one day', () => {
    const before = new Date('2026-10-24T09:00:00Z');
    expect(requestExpiry('2026-10-25T10:00:00Z', 'en', before)).toBe(
      'expires in 1 day',
    );
  });

  it('counts the 23 real hours of the spring change as hours, not a day', () => {
    const before = new Date('2026-03-28T10:00:00Z');
    expect(requestExpiry('2026-03-29T09:00:00Z', 'en', before)).toBe(
      'expires in 23 hours',
    );
  });

  it('gives the same answer on both sides of the change for the same real gap', () => {
    const winter = new Date('2026-01-10T10:00:00Z');
    const summer = new Date('2026-07-10T10:00:00Z');
    const gap = 3 * DAY + 5 * HOUR;
    expect(requestExpiry(new Date(winter.getTime() + gap), 'ro', winter)).toBe(
      requestExpiry(new Date(summer.getTime() + gap), 'ro', summer),
    );
  });
});

// @traces 347-FR-003
describe('requestExpiry with a value that is not a time', () => {
  it.each([null, undefined, '', 'tomorrow', {}, [], NaN, Number.NaN, true])(
    'answers the same placeholder as the age helper for %p',
    (value) => {
      expect(requestExpiry(value, 'ro', now)).toBe(MARK);
      expect(requestExpiry(value, 'en', now)).toBe(MARK);
    },
  );

  it('accepts a Date object and a numeric timestamp like the ISO string', () => {
    const iso = ahead(2 * HOUR);
    expect(requestExpiry(new Date(iso), 'en', now)).toBe(
      requestExpiry(iso, 'en', now),
    );
  });

  it('answers the placeholder for an invalid Date', () => {
    expect(requestExpiry(new Date('nope'), 'en', now)).toBe(MARK);
  });
});

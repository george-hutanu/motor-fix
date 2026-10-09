import { requestAge } from './formats';

const MARK = requestAge('not a time', 'ro', new Date());
const MIN = 60_000;
const HOUR = 60 * MIN;

// @traces 343-FR-008
describe('requestAge at its boundaries', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('stays on seconds up to the last millisecond of the first minute', () => {
    expect(requestAge(ago(MIN - 1), 'ro', now)).toBe('acum câteva secunde');
    expect(requestAge(ago(MIN), 'en', now)).toBe('1 min ago');
  });

  it('stays on minutes up to the last millisecond of the first hour', () => {
    expect(requestAge(ago(HOUR - 1), 'ro', now)).toBe('acum 59 de min');
    expect(requestAge(ago(HOUR), 'ro', now)).toBe('acum 1 oră');
    expect(requestAge(ago(HOUR - 1), 'en', now)).toBe('59 min ago');
  });

  it('stays on hours up to the last millisecond of the first day', () => {
    expect(requestAge(ago(24 * HOUR - 1), 'ro', now)).toBe('acum 23 de ore');
    expect(requestAge(ago(24 * HOUR - 1), 'en', now)).toBe('23 hours ago');
    expect(requestAge(ago(24 * HOUR), 'ro', now)).toBe('ieri, 13:00');
  });

  it('puts "de" on every count from 20 to 23 hours and 20 to 59 minutes', () => {
    for (const n of [21, 22, 23]) {
      expect(requestAge(ago(n * HOUR), 'ro', now)).toBe(`acum ${n} de ore`);
    }
    for (const n of [21, 30, 45, 58]) {
      expect(requestAge(ago(n * MIN), 'ro', now)).toBe(`acum ${n} de min`);
    }
  });

  it('reads the time, never the clock, when the exact day has passed over midnight', () => {
    const justAfterMidnight = new Date('2026-10-09T21:30:00Z');
    expect(requestAge('2026-10-08T21:30:00Z', 'en', justAfterMidnight)).toBe(
      'yesterday, 00:30',
    );
  });
});

// @traces 343-FR-008
describe('requestAge across daylight saving and the new year', () => {
  it('calls the day before yesterday when the clocks went back in between', () => {
    const now = new Date('2026-10-26T10:00:00Z');
    expect(requestAge('2026-10-25T00:30:00Z', 'ro', now)).toBe('ieri, 03:30');
    expect(requestAge('2026-10-25T01:30:00Z', 'ro', now)).toBe('ieri, 03:30');
  });

  it('calls the day before yesterday when the clocks went forward in between', () => {
    const now = new Date('2026-03-30T10:00:00Z');
    expect(requestAge('2026-03-28T22:30:00Z', 'en', now)).toBe(
      'yesterday, 00:30',
    );
  });

  it('shows the Bucharest hour either side of the spring change', () => {
    const now = new Date('2026-04-05T10:00:00Z');
    expect(requestAge('2026-03-29T00:59:00Z', 'en', now)).toBe(
      'Sun, 29 Mar, 02:59',
    );
    expect(requestAge('2026-03-29T01:00:00Z', 'en', now)).toBe(
      'Sun, 29 Mar, 04:00',
    );
  });

  it('calls 31 December yesterday on 1 January and 30 December a weekday', () => {
    const now = new Date('2027-01-01T10:00:00Z');
    expect(requestAge('2026-12-31T10:00:00Z', 'en', now)).toBe(
      'yesterday, 12:00',
    );
    expect(requestAge('2026-12-30T10:00:00Z', 'en', now)).toBe(
      'Wed, 30 Dec, 12:00',
    );
  });
});

// @traces 343-FR-008
describe('requestAge on what is not a time', () => {
  const now = new Date('2026-10-09T10:00:00Z');

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a blank string', '   '],
    ['an impossible date', '2026-13-45T99:00:00Z'],
    ['an invalid Date', new Date(Number.NaN)],
    ['an object', {}],
    ['a list', []],
  ])('answers the missing mark for %s in both languages', (_, value) => {
    expect(requestAge(value, 'ro', now)).toBe(MARK);
    expect(requestAge(value, 'en', now)).toBe(MARK);
  });

  it('gives the same answer to a Date and to its ISO string', () => {
    const when = new Date('2026-10-09T09:15:00Z');
    expect(requestAge(when, 'ro', now)).toBe(
      requestAge(when.toISOString(), 'ro', now),
    );
    expect(requestAge(when, 'ro', now)).toBe('acum 45 de min');
  });

  it('gives the same answer to the same call twice', () => {
    const first = requestAge('2026-10-05T15:05:00Z', 'ro', now);
    expect(requestAge('2026-10-05T15:05:00Z', 'ro', now)).toBe(first);
  });
});

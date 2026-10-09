import { formatSlot } from './formats';

// @traces 344-FR-014

const MISSING = '—';
// Friday 9 October 2026, 13:00 in Bucharest (summer time).
const now = new Date('2026-10-09T10:00:00Z');

describe('formatSlot at the edges of the Bucharest day', () => {
  it.each([
    ['the last minute of today', '2026-10-09T20:59:00Z', 'azi, 23:59'],
    ['the first minute of tomorrow', '2026-10-09T21:00:00Z', 'mâine, 00:00'],
    ['the last minute of tomorrow', '2026-10-10T20:59:00Z', 'mâine, 23:59'],
    [
      'the first minute of the day after',
      '2026-10-10T21:00:00Z',
      'dum., 11 oct., 00:00',
    ],
    ['the start of today', '2026-10-08T21:00:00Z', 'azi, 00:00'],
  ])('%s in Romanian', (_, slot, expected) => {
    expect(formatSlot(slot, 'ro', now)).toBe(expected);
  });

  it('gives the same instant the same text whatever offset writes it', () => {
    expect(formatSlot('2026-10-10T09:00:00+03:00', 'ro', now)).toBe(
      formatSlot('2026-10-10T06:00:00Z', 'ro', now),
    );
    expect(formatSlot('2026-10-10T01:00:00-05:00', 'en', now)).toBe(
      'tomorrow, 09:00',
    );
  });

  it('reads the Bucharest day, not the machine day, for now', () => {
    const lateUtc = new Date('2026-10-09T21:30:00Z');
    expect(formatSlot('2026-10-10T06:00:00Z', 'en', lateUtc)).toBe(
      'today, 09:00',
    );
  });

  it('takes a Date, a string and an epoch number alike', () => {
    const at = new Date('2026-10-10T06:00:00Z');
    expect(formatSlot(at, 'ro', now)).toBe('mâine, 09:00');
    expect(formatSlot(at.getTime(), 'ro', now)).toBe('mâine, 09:00');
  });

  it('names a slot in the past by its day', () => {
    expect(formatSlot('2026-10-07T07:00:00Z', 'en', now)).toBe(
      'Wed, 7 Oct, 10:00',
    );
  });

  it.each([null, undefined, '', 'tomorrow', Number.NaN, {}])(
    'shows a dash for %p',
    (value) => {
      expect(formatSlot(value, 'ro', now)).toBe(MISSING);
    },
  );

  it('shows a dash for an invalid Date', () => {
    expect(formatSlot(new Date('nope'), 'en', now)).toBe(MISSING);
  });
});

describe('formatSlot across the daylight-saving changes', () => {
  it('shows summer time before the autumn change and winter time after', () => {
    const before = new Date('2026-10-20T10:00:00Z');
    expect(formatSlot('2026-10-24T20:30:00Z', 'ro', before)).toBe(
      'sâm., 24 oct., 23:30',
    );
    expect(formatSlot('2026-10-25T00:30:00Z', 'ro', before)).toBe(
      'dum., 25 oct., 03:30',
    );
    expect(formatSlot('2026-10-25T01:30:00Z', 'ro', before)).toBe(
      'dum., 25 oct., 03:30',
    );
  });

  it('calls the day after the 25-hour autumn day tomorrow', () => {
    const sunday = new Date('2026-10-25T10:00:00Z');
    expect(formatSlot('2026-10-26T07:00:00Z', 'en', sunday)).toBe(
      'tomorrow, 09:00',
    );
  });

  it('calls the day after the 23-hour spring day tomorrow', () => {
    const saturday = new Date('2027-03-27T10:00:00Z');
    expect(formatSlot('2027-03-28T05:00:00Z', 'en', saturday)).toBe(
      'tomorrow, 08:00',
    );
    expect(formatSlot('2027-03-28T20:59:00Z', 'en', saturday)).toBe(
      'tomorrow, 23:59',
    );
    expect(formatSlot('2027-03-28T21:00:00Z', 'en', saturday)).toBe(
      'Mon, 29 Mar, 00:00',
    );
  });

  it('skips the clock hour that does not exist on the spring night', () => {
    const saturday = new Date('2027-03-27T10:00:00Z');
    expect(formatSlot('2027-03-28T00:59:00Z', 'ro', saturday)).toBe(
      'mâine, 02:59',
    );
    expect(formatSlot('2027-03-28T01:00:00Z', 'ro', saturday)).toBe(
      'mâine, 04:00',
    );
  });
});

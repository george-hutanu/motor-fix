import { formatAround, formatSlot } from './formats';

const MISSING = '—';
// Friday 9 October 2026, 13:00 in Bucharest (summer time).
const now = new Date('2026-10-09T10:00:00Z');

// @traces 274-FR-014
describe('formatAround at the edges of the Bucharest day', () => {
  it.each([
    [
      'the last minute of today',
      '2026-10-09T20:59:00Z',
      'azi, în jur de 23:59',
    ],
    [
      'the first minute of tomorrow, still today in UTC',
      '2026-10-09T21:00:00Z',
      'mâine, în jur de 00:00',
    ],
    [
      'the first minute of the day after',
      '2026-10-10T21:00:00Z',
      'dum., 11 oct., în jur de 00:00',
    ],
  ])('%s', (_, eta, expected) => {
    expect(formatAround(eta, 'ro', now)).toBe(expected);
  });

  it('says tomorrow in English on the next Bucharest day', () => {
    expect(formatAround('2026-10-09T21:30:00Z', 'en', now)).toBe(
      'tomorrow, around 00:30',
    );
  });

  it('reads the wall clock across the change to winter time', () => {
    expect(formatAround('2026-10-26T07:00:00Z', 'ro', now)).toBe(
      'lun., 26 oct., în jur de 09:00',
    );
  });
});

// @traces 274-FR-014
describe('formatAround against formatSlot', () => {
  const around = (slot: string, words: string) =>
    slot.replace(/, (\d{2}:\d{2})$/, `, ${words} $1`);

  it.each([
    '2026-10-09T06:00:00Z',
    '2026-10-08T09:10:00Z',
    '2026-10-01T09:10:00Z',
    '2026-10-10T09:10:00+03:00',
    '2026-12-31T21:59:00Z',
  ])('words %p as the slot does, around its time', (eta) => {
    expect(formatAround(eta, 'ro', now)).toBe(
      around(formatSlot(eta, 'ro', now), 'în jur de'),
    );
    expect(formatAround(eta, 'en', now)).toBe(
      around(formatSlot(eta, 'en', now), 'around'),
    );
  });

  it('shows an estimate that has passed as written, an hour ago today', () => {
    expect(formatAround('2026-10-09T09:00:00Z', 'ro', now)).toBe(
      'azi, în jur de 12:00',
    );
  });

  it('answers the same text on a second call', () => {
    const eta = '2026-10-09T09:10:00Z';
    expect(formatAround(eta, 'ro', now)).toBe(formatAround(eta, 'ro', now));
  });
});

// @traces 274-FR-014
describe('formatAround on what is not a time', () => {
  it.each(['', 'azi', '2026-13-45T99:00:00Z', {}, [], true])(
    'shows a dash for %p',
    (value) => {
      expect(formatAround(value, 'ro', now)).toBe(MISSING);
      expect(formatAround(value, 'en', now)).toBe(MISSING);
    },
  );
});

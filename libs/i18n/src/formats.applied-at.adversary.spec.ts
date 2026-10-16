import { appliedAt } from './formats';

// @traces 301-FR-005
// Friday 16 October 2026, 13:00 in Bucharest (UTC+3).
const now = new Date('2026-10-16T10:00:00Z');

describe('appliedAt', () => {
  it('names today in both languages', () => {
    expect(appliedAt('2026-10-16T06:12:00Z', 'ro', now)).toBe('azi, 09:12');
    expect(appliedAt('2026-10-16T06:12:00Z', 'en', now)).toBe('today, 09:12');
  });

  it('names yesterday in both languages', () => {
    expect(appliedAt('2026-10-15T11:30:00Z', 'ro', now)).toBe('ieri, 14:30');
    expect(appliedAt('2026-10-15T11:30:00Z', 'en', now)).toBe(
      'yesterday, 14:30',
    );
  });

  it('writes the weekday, day, month and time for an older day', () => {
    expect(appliedAt('2026-10-12T07:00:00Z', 'ro', now)).toBe(
      'lun., 12 oct., 10:00',
    );
    expect(appliedAt('2026-10-12T07:00:00Z', 'en', now)).toBe(
      'Mon, 12 Oct, 10:00',
    );
  });

  it('reads the day before yesterday as a date', () => {
    expect(appliedAt('2026-10-14T07:00:00Z', 'ro', now)).toBe(
      'mie., 14 oct., 10:00',
    );
  });

  it('turns to the new day at Bucharest midnight, not UTC midnight', () => {
    expect(appliedAt('2026-10-15T21:00:00Z', 'ro', now)).toBe('azi, 00:00');
    expect(appliedAt('2026-10-15T20:59:00Z', 'ro', now)).toBe('ieri, 23:59');
  });

  it('judges today by the Bucharest day of now', () => {
    const lateNow = new Date('2026-10-16T21:30:00Z');
    expect(appliedAt('2026-10-16T06:12:00Z', 'ro', lateNow)).toBe(
      'ieri, 09:12',
    );
  });

  it('keeps yesterday across the October clock change', () => {
    const monday = new Date('2026-10-26T10:00:00Z');
    expect(appliedAt('2026-10-25T21:30:00Z', 'ro', monday)).toBe('ieri, 23:30');
    expect(appliedAt('2026-10-23T21:30:00Z', 'ro', monday)).toBe(
      'sâm., 24 oct., 00:30',
    );
  });

  it('writes a date, not a word, for a time in the future', () => {
    expect(appliedAt('2026-10-17T07:00:00Z', 'ro', now)).toBe(
      'sâm., 17 oct., 10:00',
    );
  });

  it('accepts a Date and an epoch number', () => {
    const when = new Date('2026-10-16T06:12:00Z');
    expect(appliedAt(when, 'ro', now)).toBe('azi, 09:12');
    expect(appliedAt(when.getTime(), 'ro', now)).toBe('azi, 09:12');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['text', 'azi'],
    ['a day-first date', '16/10/2026'],
    ['an invalid Date', new Date('nope')],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an object', {}],
    ['an array', ['2026-10-16T06:12:00Z']],
    ['a boolean', true],
  ])('answers a dash for %s', (_label, value) => {
    expect(appliedAt(value, 'ro', now)).toBe('—');
    expect(appliedAt(value, 'en', now)).toBe('—');
  });
});

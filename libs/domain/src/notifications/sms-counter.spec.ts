// @traces 392-FR-003
import { smsMonth } from './sms-counter';

describe('the month an SMS counts in', () => {
  it('is the calendar month in Bucharest, not in UTC', () => {
    // 31 October 23:59 and 1 November 00:00 local time (UTC+2 after the clock change).
    expect(smsMonth(new Date('2026-10-31T21:59:00Z'))).toBe('2026-10');
    expect(smsMonth(new Date('2026-10-31T22:00:00Z'))).toBe('2026-11');
  });

  it('turns over at midnight in summer time too', () => {
    // 30 June 23:59 and 1 July 00:00 local time (UTC+3).
    expect(smsMonth(new Date('2026-06-30T20:59:00Z'))).toBe('2026-06');
    expect(smsMonth(new Date('2026-06-30T21:00:00Z'))).toBe('2026-07');
  });

  it('turns over the year', () => {
    expect(smsMonth(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01');
  });
});

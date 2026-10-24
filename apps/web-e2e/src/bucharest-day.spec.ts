import { expect, test } from '@playwright/test';

import { bucharestDay } from './bucharest-day.js';

test.describe('bucharestDay', () => {
  test('counts calendar days in Bucharest', () => {
    expect(bucharestDay(0, new Date('2026-10-20T12:00:00Z'))).toBe(
      '2026-10-20',
    );
    expect(bucharestDay(1, new Date('2026-10-20T12:00:00Z'))).toBe(
      '2026-10-21',
    );
    expect(bucharestDay(1, new Date('2026-10-20T21:30:00Z'))).toBe(
      '2026-10-22',
    );
  });

  // The day the clocks go back has 25 hours: just after midnight, 24 hours
  // later is still the same day (send-quote on 25 October at 00:20).
  test('tomorrow on the day the clocks go back is the next day', () => {
    expect(bucharestDay(1, new Date('2026-10-24T21:20:00Z'))).toBe(
      '2026-10-26',
    );
  });

  test('tomorrow on the day the clocks go forward is the next day', () => {
    expect(bucharestDay(1, new Date('2026-03-28T22:30:00Z'))).toBe(
      '2026-03-30',
    );
  });
});

import { expect } from '@playwright/test';

import { test } from './fixtures.js';
import { FRESH_PER_WORKER, phoneAt } from './fresh-phone.js';

// Every number a run hands out is new to that run, whichever worker asks:
// two flows given the same number would meet one account, and the second
// would sign in where it expected a new one (phone-sign-in.spec.ts:180 met
// my-details.spec.ts's "Andrei Telefon" that way).
test.describe('fresh phone numbers', () => {
  test('no two workers or turns of one run get the same number', () => {
    for (const base of [0, 4321, 8998]) {
      const seen = new Set<string>();
      for (let worker = 0; worker < 40; worker++) {
        for (let nth = 0; nth < FRESH_PER_WORKER; nth++) {
          seen.add(phoneAt(base, worker, nth));
        }
      }
      expect(seen.size).toBe(40 * FRESH_PER_WORKER);
    }
  });

  test('every number sits under the allow-listed prefix, past the seeded ones and short of the refused one', () => {
    for (const base of [0, 8998]) {
      for (const worker of [0, 39]) {
        for (const nth of [0, FRESH_PER_WORKER - 1]) {
          const phone = phoneAt(base, worker, nth);
          expect(phone).toMatch(/^\+4070000\d{4}$/);
          const tail = Number(phone.slice(-4));
          expect(tail).toBeGreaterThanOrEqual(1000);
          expect(tail).toBeLessThan(9999);
        }
      }
    }
  });

  test('a worker that asks for more than its share is told, not handed a repeat', () => {
    expect(() => phoneAt(0, 0, FRESH_PER_WORKER)).toThrow(/share/);
  });
});

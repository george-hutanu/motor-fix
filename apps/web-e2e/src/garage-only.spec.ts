import { expect, test } from '@playwright/test';

import { ACCOUNTS } from './accounts.js';
import { resetGarageOnly } from './garage-only.js';

test.describe('the garage-only account a local run resets', () => {
  test('resets only that account: its cars, its driver role and its last role', async () => {
    const calls: { text: string; values: unknown[] }[] = [];
    const db = {
      query: async (text: string, values: unknown[]) => {
        calls.push({ text, values });
        return { rowCount: 1 };
      },
    };

    expect(await resetGarageOnly(db)).toBe(true);

    expect(calls).toHaveLength(1);
    const [{ text, values }] = calls;
    expect(values).toEqual([ACCOUNTS.garageOnly]);
    expect(text).toMatch(/DELETE FROM car WHERE owner_id IN/);
    expect(text).toMatch(/DELETE FROM account_role[\s\S]*role = 'driver'/);
    expect(text).toMatch(/SET last_role = 'garage'/);
  });

  test('says so when the seed never added the account', async () => {
    const db = { query: async () => ({ rowCount: 0 }) };

    expect(await resetGarageOnly(db)).toBe(false);
  });
});

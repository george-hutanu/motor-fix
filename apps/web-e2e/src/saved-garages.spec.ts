import { expect } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, settled, signIn } from './accounts.js';
import { test } from './fixtures.js';

// The driver saves a garage, finds it on Service-uri salvate and on Panou,
// removes it from the list and undoes it. Each test starts and ends with no saved row
// for this garage; a deployed address, whose run has no DATABASE_URL, skips it.
test.describe('the saved garages list @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'clears its saved row straight in PostgreSQL, which needs DATABASE_URL',
  );
  const slug = 'service-colentina';
  const name = 'Service Colentina';
  let db: Client;

  const clear = () =>
    db.query(
      `DELETE FROM saved_garage
       WHERE garage_id = (SELECT id FROM garage WHERE slug = $1)
         AND account_id = (SELECT id FROM account WHERE email = $2)`,
      [slug, ACCOUNTS.driver],
    );

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });
  test.beforeEach(() => clear());
  test.afterEach(() => clear());
  test.afterAll(() => db.end());

  // @traces 291-FR-007 291-FR-009 291-FR-011
  test('a saved garage shows on the list and on Panou, and leaves the list on Scoate din salvate until undone', async ({
    page,
  }) => {
    await ready(page, `/ro/garages/${slug}`);
    await page.getByRole('button', { exact: true, name: 'Salvează' }).click();
    await signIn(page, ACCOUNTS.driver);
    await expect(
      page.getByRole('button', { exact: true, name: 'Salvat' }),
    ).toBeVisible();

    await page.goto('/app/driver/saved');
    await settled(page);
    const row = page.locator('mf-saved-garage-row', { hasText: name });
    await expect(row.getByRole('link', { name })).toHaveAttribute(
      'href',
      `/ro/garages/${slug}`,
    );

    await page.goto('/app/driver');
    await settled(page);
    await expect(
      page
        .locator('[data-panel="saved"]')
        .getByRole('link', { exact: true, name }),
    ).toBeVisible();

    await page.goto('/app/driver/saved');
    await settled(page);
    await row.getByRole('button', { name: 'Scoate din salvate' }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText('Scos din salvate')).toBeVisible();
    await page.getByRole('button', { name: 'Anulează' }).click();
    await expect(row).toHaveCount(1);
  });
});

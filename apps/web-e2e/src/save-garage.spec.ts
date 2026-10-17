import { expect } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// The driver's saved rows outlive a run: each test starts and ends with none
// for this garage. A deployed address, whose run has no DATABASE_URL, skips it.
test.describe('saving a garage from its profile @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'clears its saved row straight in PostgreSQL, which needs DATABASE_URL',
  );
  const slug = 'service-colentina';
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

  // @traces 290-FR-012 290-FR-013 290-FR-014 290-FR-017
  test('a visitor signs in on the tap, the garage is saved, then removed and undone', async ({
    page,
  }) => {
    await ready(page, `/ro/garages/${slug}`);
    const save = page.getByRole('button', { exact: true, name: 'Salvează' });
    const saved = page.getByRole('button', { exact: true, name: 'Salvat' });

    await save.click();
    await signIn(page, ACCOUNTS.driver);

    await expect(page).toHaveURL(new RegExp(`/ro/garages/${slug}`));
    await expect(saved).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Salvat în Service‑uri salvate')).toBeVisible();

    await saved.click();
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Scos din salvate')).toBeVisible();
    await page.getByRole('button', { name: 'Anulează' }).click();

    await expect(saved).toBeVisible();
    await page.reload();
    await expect(saved).toBeVisible();
  });
});

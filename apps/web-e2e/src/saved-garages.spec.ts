import { expect } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// The driver, with two cars, saves two garages and finds them on Service-uri
// salvate and on Panou: one works on both cars' brands, the other on neither.
// It removes one from the list and undoes it. Each test starts and ends with
// none of these rows; a deployed address, whose run has no DATABASE_URL,
// skips it.
test.describe('the saved garages list @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'seeds its cars, garage and saved rows straight in PostgreSQL, which needs DATABASE_URL',
  );
  const stamp = Date.now().toString(36);
  // A garage of this file's own: save-garage.spec.ts saves the seeded
  // Colentina for the same driver beside this one, and a garage already
  // saved sends no save.
  const slug = `e2e-ales-${stamp}`;
  const name = `Service Ales ${stamp}`;
  const brands = [
    {
      fuel: 'petrol',
      name: `Marca Unu ${stamp}`,
      slug: `e2e-salvat-1-${stamp}`,
    },
    {
      fuel: 'diesel',
      name: `Marca Doi ${stamp}`,
      slug: `e2e-salvat-2-${stamp}`,
    },
  ] as const;
  const working = `Service Salvat ${stamp}`;
  let db: Client;
  let driverId = '';
  let workingId = '';
  const brandIds: string[] = [];

  const clear = async () => {
    await db.query(
      `DELETE FROM saved_garage
       WHERE account_id = $1
         AND garage_id IN ((SELECT id FROM garage WHERE slug = $2), $3)`,
      [driverId, slug, workingId],
    );
    await db.query(
      'DELETE FROM car WHERE owner_id = $1 AND brand_id = ANY($2)',
      [driverId, brandIds],
    );
  };

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const driver = await db.query<{ id: string }>(
      'SELECT id FROM account WHERE email = $1',
      [ACCOUNTS.driver],
    );
    driverId = driver.rows[0]?.id ?? '';
    for (const brand of brands) {
      const made = await db.query<{ id: string }>(
        `INSERT INTO brand (id, key, name, slug, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $1, now()) RETURNING id`,
        [brand.slug, brand.name],
      );
      brandIds.push(made.rows[0]?.id ?? '');
    }
    await db.query(
      `INSERT INTO garage (id, name, slug, status, approved_at)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now())`,
      [name, slug],
    );
    const garage = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, rating, review_count)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now(), 4.5, 3) RETURNING id`,
      [working, `e2e-salvat-${stamp}`],
    );
    workingId = garage.rows[0]?.id ?? '';
    for (const [i, brand] of brands.entries()) {
      await db.query(
        `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
         VALUES ($1, $2, 'works_on', $3, $4, false, false, now())`,
        [
          workingId,
          brandIds[i],
          brand.fuel === 'petrol',
          brand.fuel === 'diesel',
        ],
      );
    }
  });
  test.beforeEach(async () => {
    await clear();
    for (const [i, brand] of brands.entries()) {
      await db.query(
        // The first brand's car is the newest, so the line names it first.
        `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, odometer_km, idempotency_key, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'E2E', 2018, $3::fuel, 100000, $4, now() - $5 * interval '1 minute')`,
        [driverId, brandIds[i], brand.fuel, `e2e-salvat-${stamp}-${i}`, i],
      );
    }
    // Saved earlier than the one the test saves, so it lists second.
    await db.query(
      `INSERT INTO saved_garage (account_id, garage_id, saved_at)
       VALUES ($1, $2, now() - interval '1 hour')`,
      [driverId, workingId],
    );
  });
  test.afterEach(() => clear());
  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE id = $1 OR slug = $2', [
      workingId,
      slug,
    ]);
    await db.query('DELETE FROM brand WHERE id = ANY($1)', [brandIds]);
    await db.end();
  });

  // @traces 291-FR-006 291-FR-007 291-FR-008 291-FR-009 291-FR-011 291-FR-015
  test('two saved garages show their lines and the subtitle, on the list and on Panou, and one leaves on Scoate din salvate until undone', async ({
    page,
  }) => {
    await ready(page, `/ro/garages/${slug}`);
    // The button turns to Salvat before the server has the save: wait for it,
    // or leaving the page cancels it.
    const stored = page.waitForResponse(
      (res) =>
        res.request().method() === 'PUT' &&
        res.url().includes('/api/v1/me/saved-garages/') &&
        res.ok(),
    );
    await page.getByRole('button', { exact: true, name: 'Salvează' }).click();
    await signIn(page, ACCOUNTS.driver);
    await expect(
      page.getByRole('button', { exact: true, name: 'Salvat' }),
    ).toBeVisible();
    await stored;

    // The list keeps the live stream open, so networkidle never comes: wait
    // for the list itself.
    await page.goto('/app/driver/saved');
    await expect(page.locator('[data-subtitle]')).toBeVisible();
    const row = page.locator('mf-saved-garage-row', { hasText: name });
    const other = page.locator('mf-saved-garage-row', { hasText: working });
    await expect(row.getByRole('link', { name })).toHaveAttribute(
      'href',
      `/ro/garages/${slug}`,
    );
    await expect(row.locator('[data-line]')).toHaveText(
      'Nu lucrează pe mașinile tale',
    );
    await expect(other.locator('[data-line]')).toHaveText(
      `Lucrează pe ${brands[0].name} și ${brands[1].name}`,
    );
    await expect(page.locator('[data-subtitle]')).toHaveText(
      '1 service care lucrează pe mașinile tale',
    );

    await page.goto('/app/driver');
    const panel = page.locator('[data-panel="saved"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('link', { exact: true, name })).toBeVisible();
    await expect(
      panel.getByRole('link', { exact: true, name: working }),
    ).toBeVisible();

    await page.goto('/app/driver/saved');
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Scoate din salvate' }).click();
    await expect(row).toHaveCount(0);
    await expect(other).toHaveCount(1);
    await expect(page.getByText('Scos din salvate')).toBeVisible();
    await page.getByRole('button', { name: 'Anulează' }).click();
    await expect(row).toHaveCount(1);
  });
});

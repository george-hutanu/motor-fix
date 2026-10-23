import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// The seeded driver with a Dacia Logan saves the seeded Service Auto Militari,
// which works on Dacia and has an oil change on its price list, then asks it
// for a quote straight from Service-uri salvate. Each test starts and ends
// without the saved row; a deployed address, whose run has no DATABASE_URL,
// skips it.
const DRIVER = 'cerere@example.test';
const SLUG = 'service-auto-militari';
const GARAGE = 'Service Auto Militari';
const OIL = 'Schimb de ulei și filtre';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signedInDriver(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, DRIVER);
  await expect(page).toHaveURL('/app/driver');
}

test.describe('a quote request from a saved garage @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'saves the garage straight in PostgreSQL, which needs DATABASE_URL',
  );
  let db: Client;
  let driverId = '';
  let garageId = '';
  let savedBefore = false;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const driver = await db.query<{ id: string }>(
      'SELECT id FROM account WHERE email = $1',
      [DRIVER],
    );
    driverId = driver.rows[0]?.id ?? '';
    const garage = await db.query<{ id: string }>(
      'SELECT id FROM garage WHERE slug = $1',
      [SLUG],
    );
    garageId = garage.rows[0]?.id ?? '';
    const saved = await db.query(
      'SELECT 1 FROM saved_garage WHERE account_id = $1 AND garage_id = $2',
      [driverId, garageId],
    );
    savedBefore = (saved.rowCount ?? 0) > 0;
  });
  test.beforeEach(async () => {
    await db.query(
      `INSERT INTO saved_garage (account_id, garage_id, saved_at)
       VALUES ($1, $2, now()) ON CONFLICT DO NOTHING`,
      [driverId, garageId],
    );
  });
  test.afterEach(async () => {
    if (savedBefore) return;
    await db.query(
      'DELETE FROM saved_garage WHERE account_id = $1 AND garage_id = $2',
      [driverId, garageId],
    );
  });
  test.afterAll(() => db.end());

  // @traces 292-FR-001 292-FR-004 292-FR-006 292-FR-009
  test('goes out from the saved row to the garage, named saved, and shows in Cererile mele', async ({
    page,
  }) => {
    await signedInDriver(page);
    // The list keeps the live stream open, so networkidle never comes: wait
    // for the row itself.
    await page.goto('/app/driver/saved');
    const row = page.locator('mf-saved-garage-row', { hasText: GARAGE });
    await row
      .getByRole('button', { exact: true, name: `Cere ofertă de la ${GARAGE}` })
      .click();

    const quote = page.getByRole('dialog', { name: 'Cere ofertă' });
    await expect(
      quote.getByRole('combobox', { exact: true, name: 'Mașina' }),
    ).toContainText('Dacia Logan');
    await quote.getByRole('switch', { name: OIL }).click();
    const sent = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/quote-requests') &&
        r.request().method() === 'POST',
    );
    await quote.getByRole('button', { name: 'Trimite' }).click();
    const response = await sent;
    expect(response.status()).toBe(201);
    const body = response.request().postDataJSON() as {
      garageIds: string[];
      sources: string[];
    };
    expect(body.garageIds[0]).toBe(garageId);
    expect(body.sources[0]).toBe('saved');
    await expect(quote.getByText(`Trimis către ${GARAGE}.`)).toBeVisible();

    await quote.getByRole('link', { name: 'Vezi Cererile mele' }).click();
    await expect(page).toHaveURL('/app/driver/requests');
    const newest = page.locator('[data-request]').first();
    await expect(newest).toContainText('Dacia Logan');
    await expect(newest).toContainText(OIL);
  });

  // @traces 292-FR-001 292-FR-008
  for (const scheme of ['light', 'dark'] as const) {
    test(`the row with its button fits a 320 px phone, ${scheme}, with no sideways scroll`, async ({
      page,
    }) => {
      // Signed in at the desktop size, where the header carries Autentificare.
      await signedInDriver(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 800, width: 320 });
      await page.goto('/app/driver/saved');
      const button = page
        .locator('mf-saved-garage-row', { hasText: GARAGE })
        .getByRole('button', {
          exact: true,
          name: `Cere ofertă de la ${GARAGE}`,
        });
      await expect(button).toBeVisible();

      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});

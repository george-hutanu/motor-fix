import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { hydrated } from './accounts.js';
import { test } from './fixtures.js';

const MILITARI = '/garages/service-auto-militari';

const prices = (page: Page, name: string) => page.getByRole('region', { name });
const rows = (page: Page) => page.locator('section[data-slot="prices"] .row');
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// Militari's seeded price list: six jobs, the suspension check without a top
// price; a BMW range for the front brakes and a BMW tick list without the
// timing chain; the oil service alone ticked for Dacia.
// @traces 355-price-list-ranges-FR-006 355-price-list-ranges-FR-007 355-price-list-ranges-FR-008 355-price-list-ranges-FR-009
// @traces 355-price-list-ranges-FR-002 355-price-list-ranges-FR-003 355-price-list-ranges-FR-014 355-price-list-ranges-FR-015
// @traces 355-price-list-ranges-FR-011 355-price-list-ranges-FR-012 355-price-list-ranges-FR-016
test.describe('the price list on a garage profile @seeded', () => {
  test.describe.configure({ mode: 'serial' });

  test('lists the five public jobs with their durations and ranges in Romanian', async ({
    page,
  }) => {
    await page.goto(`/ro${MILITARI}`);

    const section = prices(page, 'Lista de prețuri');
    await expect(
      section.getByRole('heading', { level: 2, name: 'Lista de prețuri' }),
    ).toBeVisible();
    await expect(section).toContainText(
      'Pornește ce ai nevoie. Prețurile sunt intervale, pentru că lucrarea depinde de mașină. Manopera este 180–240 lei / oră.',
    );
    await expect(section).toContainText(
      'Prețurile includ piese și manoperă, cu TVA, și sunt orientative.',
    );
    await expect(rows(page).locator('.name')).toHaveText([
      'Diagnoză și citire coduri de eroare',
      'Schimb de ulei și filtre',
      'Plăcuțe și discuri de frână față',
      'Kit lanț de distribuție',
      'Încărcare freon climă',
    ]);
    await expect(rows(page).locator('.duration')).toHaveText([
      '30 min',
      '1 h',
      '2 h',
      '1 zi',
      '45 min',
    ]);
    await expect(rows(page).locator('.range')).toHaveText([
      '150–220 lei',
      '250–400 lei',
      '890–1.400 lei',
      '4.200–6.800 lei',
      '280–360 lei',
    ]);
    await expect(section).not.toContainText('Verificare suspensie');
  });

  test('writes the list the English way', async ({ page }) => {
    await page.goto(`/en${MILITARI}`);

    const section = prices(page, 'Price list');
    await expect(section).toContainText(
      'Switch on what you need. Prices are ranges, because the job depends on the car. Labour is 180–240 lei / hour.',
    );
    await expect(rows(page).locator('.name')).toHaveText([
      'Diagnosis and fault-code read',
      'Oil and filter service',
      'Front brake pads and discs',
      'Timing chain kit',
      'Air-con regas',
    ]);
    await expect(rows(page).locator('.duration').nth(3)).toHaveText('1 day');
    await expect(rows(page).locator('.range').nth(2)).toHaveText(
      '890–1,400 lei',
    );
  });

  test("shows the brand's range and leaves out the jobs it did not tick", async ({
    page,
  }) => {
    await page.goto(`/ro${MILITARI}?brand=bmw`);

    await expect(rows(page).locator('.name')).toHaveText([
      'Diagnoză și citire coduri de eroare',
      'Schimb de ulei și filtre',
      'Plăcuțe și discuri de frână față',
      'Încărcare freon climă',
    ]);
    await expect(
      rows(page).filter({ hasText: 'Plăcuțe și discuri' }).locator('.range'),
    ).toHaveText('1.100–1.700 lei');
  });

  test('keeps the default list for a brand with no range and no tick', async ({
    page,
  }) => {
    await page.goto(`/ro${MILITARI}?brand=audi`);

    await expect(rows(page)).toHaveCount(5);
    await expect(
      rows(page).filter({ hasText: 'Plăcuțe și discuri' }).locator('.range'),
    ).toHaveText('890–1.400 lei');
  });

  test('lists only the job ticked for Dacia', async ({ page }) => {
    await page.goto(`/ro${MILITARI}?brand=dacia`);

    await expect(rows(page).locator('.name')).toHaveText([
      'Schimb de ulei și filtre',
    ]);
    await expect(rows(page).locator('.range')).toHaveText(['250–400 lei']);
  });

  test('fits a 320 px phone without scrolling sideways, each row a full target', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto(`/ro${MILITARI}`);
    await expect(rows(page)).toHaveCount(5);

    expect(await sideways(page)).toBeLessThanOrEqual(0);
    for (const box of await rows(page).evaluateAll((all) =>
      all.map((row) => row.getBoundingClientRect().height),
    )) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
  });

  test('turns a switch on and off from the keyboard', async ({ page }) => {
    await hydrated(page, `/ro${MILITARI}`);
    const first = page.getByRole('switch', {
      name: 'Diagnoză și citire coduri de eroare',
    });
    await expect(first).toHaveAttribute('aria-checked', 'false');

    await first.focus();
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('switch', { name: 'Schimb de ulei și filtre' }),
    ).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-checked', 'false');
    await expect(
      page.getByRole('switch', { name: 'Schimb de ulei și filtre' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  // The range changes in PostgreSQL and its event is recorded beside it, as
  // the owner's editors will; the worker's relay carries it to the open page.
  // Last in this serial file, so no row above reads the changed range. A
  // deployed address, whose run has no DATABASE_URL, skips it.
  let db: Client | undefined;

  test.beforeAll(async () => {
    if (!process.env['DATABASE_URL']) return;
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    await db?.end();
  });

  const setTop = async (client: Client, toBani: number) => {
    await client.query('BEGIN');
    try {
      const { rows: changed } = await client.query<{ garage_id: string }>(
        `UPDATE garage_price p SET to_bani = $1
         FROM garage g, job_type j
         WHERE p.garage_id = g.id AND p.job_type_id = j.id
           AND p.brand_id IS NULL
           AND g.slug = 'service-auto-militari' AND j.key = 'ac-regas'
         RETURNING p.garage_id`,
        [toBani],
      );
      const garageId = changed[0]?.garage_id;
      if (garageId === undefined) {
        throw new Error('the seeded A/C regas range is missing');
      }
      await client.query(
        `INSERT INTO outbox_event (kind, subject_id, audience)
         VALUES ('price_list.updated', $1, $2)`,
        [garageId, [`garage:${garageId}`, `public:garage:${garageId}`]],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  };

  test('shows a changed range in place and keeps the switches on', async ({
    page,
  }) => {
    test.skip(
      !process.env['DATABASE_URL'],
      'changes a range straight in PostgreSQL, which needs DATABASE_URL',
    );
    const client = db;
    if (client === undefined) throw new Error('no PostgreSQL client');
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto(`/ro${MILITARI}`);
    const regas = rows(page).filter({ hasText: 'Încărcare freon climă' });
    await expect(regas.locator('.range')).toHaveText('280–360 lei');
    await stream;
    const toggle = page.getByRole('switch', { name: 'Încărcare freon climă' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    try {
      await setTop(client, 39_000);

      await expect(regas.locator('.range')).toHaveText('280–390 lei', {
        timeout: 15_000,
      });
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(navigations).toBe(0);
    } finally {
      await setTop(client, 36_000);
    }
  });
});

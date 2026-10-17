import { expect, type Page } from '@playwright/test';

import { hydrated, signIn } from './accounts.js';
import { test } from './fixtures.js';

const MILITARI = '/garages/service-auto-militari';
const DIAGNOSIS = 'Diagnoză și citire coduri de eroare';
const BRAKES = 'Plăcuțe și discuri de frână față';

const box = (page: Page, name = 'Estimarea ta') =>
  page.getByRole('region', { name });
const totals = (page: Page, name?: string) =>
  box(page, name).locator('.totals');
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// Militari's seeded list: diagnosis 150–220 lei, the front brakes 890–1.400
// lei by default and 1.100–1.700 lei for BMW.
// @traces 356-FR-001 356-FR-002 356-FR-003
// @traces 356-FR-005 356-FR-008 356-FR-011
// @traces 356-FR-012 356-FR-013 356-FR-014
test.describe('the live estimate on a garage profile @seeded', () => {
  test('adds up the switched-on jobs and keeps them through a reload', async ({
    page,
  }) => {
    await hydrated(page, `/ro${MILITARI}?brand=bmw`);
    await expect(box(page)).toContainText(
      'Pornește lucrările de care ai nevoie în lista de prețuri și contorul le adună.',
    );
    await expect(box(page)).toContainText(
      'Unde ajungi în interval depinde de mașină. Service‑ul confirmă după ce o vede.',
    );

    await page.getByRole('switch', { name: DIAGNOSIS }).click();
    await page.getByRole('switch', { name: BRAKES }).click();
    await expect(totals(page)).toHaveAttribute(
      'aria-label',
      'Estimare de la 1.250 la 1.920 lei',
    );

    await page.getByRole('switch', { name: BRAKES }).click();
    await expect(totals(page)).toHaveAttribute(
      'aria-label',
      'Estimare de la 150 la 220 lei',
    );
    await page.getByRole('switch', { name: BRAKES }).click();

    await hydrated(page, `/ro${MILITARI}`);
    await expect(page.getByRole('switch', { name: BRAKES })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(totals(page)).toHaveAttribute(
      'aria-label',
      'Estimare de la 1.040 la 1.620 lei',
    );
  });

  test('opens the quote dialog with the switched-on jobs ticked', async ({
    page,
  }) => {
    await hydrated(page, `/ro${MILITARI}`);
    await page.getByRole('switch', { name: DIAGNOSIS }).click();

    await box(page)
      .getByRole('button', { exact: true, name: 'CERE OFERTĂ' })
      .click();
    // A visitor signs in over the dialog first; the ticks wait for it.
    await signIn(page, 'cerere@example.test');
    const quote = page.getByRole('dialog', { name: 'Cere ofertă' });
    await expect(
      quote.getByRole('switch', { name: DIAGNOSIS }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(quote.getByRole('switch', { name: BRAKES })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('starts with nothing on in a new browser session', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await hydrated(page, `/ro${MILITARI}`);
      await expect(totals(page)).toHaveAttribute(
        'aria-label',
        'Estimare de la 0 la 0 lei',
      );
      await expect(
        totals(page)
          .locator('mf-odometer')
          .first()
          .locator('.mf-odometer-digit'),
      ).toHaveText(['0', '0', '0', '0', '0']);
    } finally {
      await context.close();
    }
  });

  test('puts the cursor in the description when nothing is on', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1280 });
    await hydrated(page, `/ro${MILITARI}`);
    await box(page)
      .getByRole('button', { exact: true, name: 'CERE OFERTĂ' })
      .click();
    await signIn(page, 'cerere@example.test');

    const quote = page.getByRole('dialog', { name: 'Cere ofertă' });
    await expect(quote.getByLabel('Ce se întâmplă cu mașina')).toBeFocused();
  });

  test('writes the box the English way', async ({ page }) => {
    await hydrated(page, `/en${MILITARI}`);
    await page
      .getByRole('switch', { name: 'Front brake pads and discs' })
      .click();

    await expect(totals(page, 'Your estimate')).toHaveAttribute(
      'aria-label',
      'Estimate from 890 to 1,400 lei',
    );
    await expect(box(page, 'Your estimate')).toContainText('FROM');
    await expect(box(page, 'Your estimate')).toContainText('TO');
  });

  test('fits a 320 px phone without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await hydrated(page, `/ro${MILITARI}`);
    await page.getByRole('switch', { name: BRAKES }).click();

    await expect(totals(page)).toHaveAttribute(
      'aria-label',
      'Estimare de la 890 la 1.400 lei',
    );
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

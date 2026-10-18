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

// The bar keeps the total and CERE OFERTĂ on a phone's screen; from 1024 px
// the box itself stays in view beside the long sections.
// @traces 311-FR-013 311-SC-001 311-SC-002 311-SC-003 311-SC-006
test.describe('the estimate within reach @seeded', () => {
  const bar = (page: Page) => page.locator('mf-estimate-bar');

  test('keeps the total and CERE OFERTĂ on a phone, down to the request', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    await hydrated(page, `/ro${MILITARI}?brand=bmw`);
    await page.getByRole('switch', { name: DIAGNOSIS }).click();
    await page.getByRole('switch', { name: BRAKES }).click();
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );

    const request = bar(page).getByRole('button', {
      exact: true,
      name: 'CERE OFERTĂ',
    });
    await expect(request).toBeInViewport({ ratio: 1 });
    const height = (await request.boundingBox())?.height ?? 0;
    expect(height).toBeGreaterThanOrEqual(44);

    await request.click();
    await signIn(page, 'cerere@example.test');
    const quote = page.getByRole('dialog', { name: 'Cere ofertă' });
    for (const name of [DIAGNOSIS, BRAKES])
      await expect(quote.getByRole('switch', { name })).toHaveAttribute(
        'aria-checked',
        'true',
      );
  });

  test('opens the whole estimate in a sheet from the total', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    await hydrated(page, `/ro${MILITARI}?brand=bmw`);
    await page.getByRole('switch', { name: DIAGNOSIS }).click();
    await page.getByRole('switch', { name: BRAKES }).click();
    const scrolled = await page.evaluate(() => window.scrollY);

    await bar(page)
      .getByRole('button', { name: 'Estimare de la 1.250 la 1.920 lei' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Estimarea ta' });
    await expect(sheet).toContainText(DIAGNOSIS);
    await expect(sheet).toContainText(BRAKES);
    await expect(sheet).toContainText(
      'Unde ajungi în interval depinde de mașină.',
    );

    await sheet
      .getByRole('button', { name: /închide/i })
      .first()
      .click();
    await expect(sheet).toBeHidden();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  });

  test('holds the box in view on a desktop and shows no bar on a tablet', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await hydrated(page, `/ro${MILITARI}?brand=bmw`);
    await page.getByRole('switch', { name: DIAGNOSIS }).click();
    await page.getByRole('switch', { name: BRAKES }).click();
    await page.evaluate(() => window.scrollBy(0, 1500));
    await expect(box(page)).toBeInViewport();
    await expect(bar(page)).toBeHidden();

    await page.setViewportSize({ height: 1194, width: 834 });
    await expect(bar(page)).toBeHidden();
  });

  test('fits a 320 px phone with the bar', async ({ page }) => {
    await page.setViewportSize({ height: 568, width: 320 });
    await hydrated(page, `/ro${MILITARI}?brand=bmw`);
    await page.getByRole('switch', { name: DIAGNOSIS }).click();
    await page.getByRole('switch', { name: BRAKES }).click();

    await expect(
      bar(page).getByRole('button', { name: /Estimare/ }),
    ).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

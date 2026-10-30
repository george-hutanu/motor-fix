import { expect } from '@playwright/test';

import { ACCOUNTS, signedIn } from './accounts.js';
import { test } from './fixtures.js';
import { type PastJob, pastJob } from './past-job.js';

// @traces 1393-FR-015
// @traces 1393-FR-009
// @traces 1393-FR-010
// @traces 1393-FR-012
test.describe('the final price, from the desk to the driver @seeded @database', () => {
  let job: PastJob | undefined;

  test.afterEach(async () => {
    await job?.remove();
    job = undefined;
  });

  test('the receptionist records 1.250,50 lei and the driver’s row closes with it', async ({
    browser,
    page,
    request,
  }) => {
    // Two browsers, each signing in: more than one page's time.
    test.setTimeout(60_000);
    job = await pastJob(request, 'Vlad Stan');

    const driverContext = await browser.newContext();
    const driver = await driverContext.newPage();
    await signedIn(
      driver,
      job.driver.email,
      '/app/driver',
      job.driver.password,
    );
    await driver.goto('/app/driver/requests');
    const row = driver.locator('[data-request]').first();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-amount]')).toHaveCount(0);
    // The job is Gata: the panel above the list still tracks the request.
    const stages = driver.locator('mf-active-request ol.stages');
    await expect(stages).toBeVisible();

    await page.setViewportSize({ height: 844, width: 390 });
    await signedIn(page, ACCOUNTS.receptionist, /\/app\/garage/);
    await page.goto('/app/garage/jobs');
    await page.locator('[data-job]', { hasText: job.plate }).first().click();
    const drawer = page.getByRole('dialog').first();
    await drawer.getByRole('button', { exact: true, name: 'Predare' }).click();

    const dialog = page.getByRole('dialog', { name: 'Predare' });
    await dialog.getByLabel('Preț final (lei)').fill('1.250,50');
    await dialog.getByRole('button', { exact: true, name: 'Salvează' }).click();
    await expect(dialog).toBeHidden();
    await expect(drawer.getByText('Preț final 1.250,50 lei')).toBeVisible();
    await expect(
      drawer.getByRole('button', { exact: true, name: 'Corectează' }),
    ).toBeVisible();

    await expect(row).toContainText('Încheiată pe', { timeout: 5_000 });
    await expect(row.locator('[data-amount]')).toContainText('1.250,50 lei', {
      timeout: 5_000,
    });
    // The handover ends the request, so the panel lets it go.
    await expect(stages).toHaveCount(0, { timeout: 5_000 });
    await driverContext.close();
  });
});

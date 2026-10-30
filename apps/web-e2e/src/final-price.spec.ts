import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { type PastJob, pastJob } from './past-job.js';

// Signs in at the width the site bar shows its button at, then goes to the
// page's own size.
async function signedIn(
  page: Page,
  email: string,
  password: string,
  landing: string | RegExp,
) {
  const size = page.viewportSize();
  await page.setViewportSize({ height: 900, width: 1280 });
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email, { password });
  await expect(page).toHaveURL(landing);
  if (size) await page.setViewportSize(size);
}

// @traces 1393-FR-015
// @traces 1393-FR-009
// @traces 1393-FR-010
// @traces 1393-FR-012
test.describe('the final price, from the desk to the driver @seeded', () => {
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
    test.skip(
      !process.env['DATABASE_URL'],
      'writes the finished job straight to PostgreSQL, which needs DATABASE_URL',
    );
    // Two browsers, each signing in: more than one page's time.
    test.setTimeout(60_000);
    job = await pastJob(request, 'Vlad Stan');

    const driverContext = await browser.newContext();
    const driver = await driverContext.newPage();
    await signedIn(
      driver,
      job.driver.email,
      job.driver.password,
      '/app/driver',
    );
    await driver.goto('/app/driver/requests');
    const row = driver.locator('[data-request]').first();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-amount]')).toHaveCount(0);

    await page.setViewportSize({ height: 844, width: 390 });
    await signedIn(page, ACCOUNTS.receptionist, PASSWORD, /\/app\/garage/);
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
    await driverContext.close();
  });
});

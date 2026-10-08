import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { restore } from './platform-rules.js';

const RESULTS = '/ro/garages?brand=dacia';

const maintenancePage = (page: Page) =>
  page.getByRole('heading', { level: 1, name: 'Mentenanță' });

const banner = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Mentenanță activă' });

const maintenanceSwitch = (page: Page) =>
  page.getByRole('switch', { exact: true, name: 'Mod mentenanță' });

const signInDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Autentificare' });

// Sets the switch and waits for the server to keep it.
async function switchMaintenance(page: Page, on: boolean) {
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PATCH' &&
      res.url().includes('/admin/platform-rules/maintenance_mode'),
  );
  await maintenanceSwitch(page).click();
  await expect(maintenanceSwitch(page)).toHaveAttribute(
    'aria-checked',
    String(on),
  );
  expect((await saved).ok()).toBe(true);
}

test.describe('maintenance mode @seeded', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(({ request }) => restore(request));
  test.afterEach(({ request }) => restore(request));

  test('a driver tab shows the maintenance page and comes back, live, while an admin signs in through /admin', async ({
    browser,
    page,
  }) => {
    let loads = 0;
    page.on('load', () => {
      loads++;
    });
    const listening = page.waitForRequest((req) =>
      req.url().includes('/api/v1/live/public'),
    );
    await ready(page, RESULTS);
    await listening;

    const admin = await (await browser.newContext()).newPage();
    await admin.goto('/admin');
    await signIn(admin, ACCOUNTS.admin);
    await expect(admin).toHaveURL('/app/admin');
    await admin.goto('/app/admin/settings');
    await expect(maintenanceSwitch(admin)).toBeVisible();

    await switchMaintenance(admin, true);

    await expect(banner(admin)).toBeVisible({ timeout: 5000 });
    await expect(maintenancePage(page)).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('link', { name: 'Administrator? Intră în cont' }),
    ).toHaveAttribute('href', '/admin');
    await expect(page).toHaveURL(RESULTS);

    const driver = await (await browser.newContext()).newPage();
    await driver.goto('/admin');
    // The dialog opens over the page, and a modal hides what lies under it.
    await expect(
      driver.getByRole('heading', {
        includeHidden: true,
        level: 1,
        name: 'Mentenanță',
      }),
    ).toBeAttached();
    await signIn(driver, ACCOUNTS.driver);
    await expect(
      signInDialog(driver).getByText(
        'MotorFix este în mentenanță. Încearcă din nou în câteva minute.',
      ),
    ).toBeVisible();
    await signInDialog(driver).getByRole('button', { name: 'Închide' }).click();
    await expect(maintenancePage(driver)).toBeVisible();
    await driver.context().close();

    await switchMaintenance(admin, false);

    await expect(banner(admin)).toBeHidden({ timeout: 5000 });
    await expect(maintenancePage(page)).toBeHidden({ timeout: 5000 });
    await expect(page).toHaveURL(RESULTS);
    expect(loads).toBe(1);
    await admin.context().close();
  });

  test('the server answers 503 with the maintenance page, readable at 320 px', async ({
    browser,
    page,
  }) => {
    const admin = await (await browser.newContext()).newPage();
    await admin.goto('/admin');
    await signIn(admin, ACCOUNTS.admin);
    await expect(admin).toHaveURL('/app/admin');
    await admin.goto('/app/admin/settings');
    await switchMaintenance(admin, true);
    await admin.context().close();

    await page.setViewportSize({ height: 640, width: 320 });
    const response = await page.goto('/ro');

    expect(response?.status()).toBe(503);
    expect(response?.headers()['retry-after']).toBe('300');
    await expect(maintenancePage(page)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});

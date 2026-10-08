import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const menuLink = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Meniu' })
    .getByRole('link', { exact: true, name });

const chip = (page: Page, name: string) =>
  page
    .getByRole('group', { name: 'Rolul tău' })
    .getByRole('button', { exact: true, name });

async function signInFromHome(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.switcher);
}

// One seeded account of its own: a switch changes the role its next sign-in
// opens, which no other spec may depend on meanwhile.
test.describe('switching between the driver and garage roles @seeded', () => {
  test('a driver and garage switches to driver, the next sign-in opens it, and switches back', async ({
    page,
  }) => {
    await signInFromHome(page);
    await page.waitForURL(/\/app\/(garage|driver)$/);
    // A run stopped half-way left the account on its driver role.
    if (page.url().endsWith('/app/driver')) await chip(page, 'Service').click();
    await expect(page).toHaveURL('/app/garage');
    await expect(chip(page, 'Service')).toHaveAttribute('aria-pressed', 'true');

    await chip(page, 'Șofer').click();

    await expect(page).toHaveURL('/app/driver');
    await expect(menuLink(page, 'Mașinile mele')).toBeVisible();
    await expect(chip(page, 'Șofer')).toHaveAttribute('aria-pressed', 'true');

    await page
      .getByRole('button', { exact: true, name: 'Ieși din cont' })
      .click();
    await expect(page).toHaveURL(/\/ro\/?$/);
    await signInFromHome(page);
    await expect(page).toHaveURL('/app/driver');

    await chip(page, 'Service').click();

    await expect(page).toHaveURL('/app/garage');
    await expect(menuLink(page, 'Mecanici')).toBeVisible();
  });

  test('an account with one role shows no role chips', async ({ page }) => {
    await ready(page, '/ro');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');

    await expect(page.getByRole('group', { name: 'Rolul tău' })).toHaveCount(0);
  });
});

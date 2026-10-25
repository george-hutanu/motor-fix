import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, openSignIn, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// The seeded driver whose acceptance predates the texts in force. Accepting
// is for good, so the tests run in order: sign out first, accept last.
test.describe.configure({ mode: 'serial' });

// The CDK's dialog container draws nothing itself: whether the dialog shows
// is read on its panel.
const reaccept = (page: Page) =>
  page.getByRole('dialog', { name: 'Termeni noi' });

async function signInStale(page: Page) {
  await ready(page, '/ro/garages');
  await openSignIn(page);
  await signIn(page, ACCOUNTS.staleDriver);
  await expect(reaccept(page).locator('mf-overlay-panel')).toBeVisible();
}

// @traces 1204-FR-007
test('asks for the new texts at sign-in, and only accepting or signing out closes it', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await signInStale(page);
  const dialog = reaccept(page);

  await expect(
    dialog.getByRole('link', { name: 'Termenii de utilizare' }),
  ).toHaveAttribute('href', '/ro/terms');
  await expect(
    dialog.getByRole('link', {
      name: 'Nota de informare privind datele personale',
    }),
  ).toHaveAttribute('href', '/ro/privacy');
  await expect(dialog).toContainText('versiunea 2026-10-12');
  await expect(dialog).toContainText('versiunea 2026-10-24');

  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(dialog.locator('mf-overlay-panel')).toBeVisible();

  await dialog.getByRole('button', { name: 'Deconectare' }).click();
  await expect(page).toHaveURL(/\/ro$/);
  await expect(dialog.locator('mf-overlay-panel')).toBeHidden();
  await expect(
    page
      .getByRole('dialog', { name: 'Autentificare' })
      .locator('mf-overlay-panel'),
  ).toBeHidden();
});

// @traces 1204-FR-007 1204-FR-014 1204-FR-015
test('fits a 320 px phone, and once accepted opens the dashboard and never asks again', async ({
  page,
}) => {
  await page.setViewportSize({ height: 700, width: 320 });
  await signInStale(page);
  const dialog = reaccept(page);
  const sideways = await dialog
    .locator('mf-overlay-panel')
    .evaluate((panel) => panel.scrollWidth > panel.clientWidth);
  expect(sideways).toBe(false);

  await page.setViewportSize({ height: 844, width: 390 });
  await dialog.getByRole('button', { name: 'Accept' }).click();
  await expect(page).toHaveURL('/app/driver');
  await expect(dialog.locator('mf-overlay-panel')).toBeHidden();

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await ready(page, '/ro/garages');
  await openSignIn(page);
  await signIn(page, ACCOUNTS.staleDriver);
  await expect(page).toHaveURL('/app/driver');
  await expect(reaccept(page)).toHaveCount(0);
});

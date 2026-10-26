import { expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import { accepted, DRIVER, MILITARI } from './booking.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

async function signedIn(page: Page, email: string, landing: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL(landing);
}

// @seeded: the seeded driver's accepted booking is confirmed by Militari.
test.describe('confirming a booking @seeded', () => {
  // @traces 389-FR-002
  // @traces 389-FR-014
  // @traces 389-FR-015
  // @traces 389-FR-016
  // @traces 389-FR-020
  test('the owner confirms with a mechanic and Elevator 1, and the driver’s Cererile mele shows it booked without a reload', async ({
    browser,
    page,
    request,
  }) => {
    const requestId = await accepted(request);
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, DRIVER, '/app/driver');
    await page.goto('/app/driver/requests');
    const row = page.locator(`li[data-request="${requestId}"]`);
    await expect(row.locator('.waiting')).toBeVisible();
    await expect(row.locator('.booked')).toHaveCount(0);

    const context = await browser.newContext();
    try {
      const owner = await context.newPage();
      await owner.setViewportSize({ height: 900, width: 1440 });
      await signedIn(owner, MILITARI, '/app/garage');
      await owner.goto('/app/garage/requests');
      const sent = owner
        .locator('mf-quotes-sent-panel')
        .locator(`[data-live-id="${requestId}"]`);
      await sent.getByRole('button', { name: 'Confirmă programarea' }).click();

      const dialog = owner.getByRole('dialog', {
        name: 'Confirmă programarea',
      });
      const mechanic = dialog.getByLabel('Mecanic');
      // The choices arrive after the dialog opens.
      await expect(mechanic).toBeVisible();
      const [, first] = await mechanic.locator('option').allTextContents();
      await mechanic.selectOption({ label: first });
      await dialog.getByLabel('Elevator').selectOption({ label: 'Elevator 1' });
      await dialog
        .getByRole('button', { exact: true, name: 'Confirmă' })
        .click();
      await expect(owner.getByText('Programare confirmată')).toBeVisible();
      await expect(dialog).toBeHidden();

      await expect(sent).toContainText('Acceptată · programată');
      await expect(sent.locator('.mechanic')).toHaveText(first);
      await expect(sent.locator('.lift')).toHaveText('Elevator 1');
      await expect(
        sent.getByRole('button', { name: 'Confirmă programarea' }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }

    await expect(row.locator('.booked')).toContainText('Programată ·', {
      timeout: 5_000,
    });
    await expect(row.locator('.waiting')).toHaveCount(0);
  });
});

import { expect, type Locator, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const STEPS = ['Mașina pe elevator', 'Etriere demontate', 'Probă pe drum'];

async function openJob(page: Page, email: string, landing: string) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL(landing);
  await page.goto('/app/garage/jobs');
  await page.locator('[data-job]', { hasText: 'B101QAT' }).first().click();
  return page.getByRole('dialog');
}

const rows = (panel: Locator) => panel.locator('[data-step]');

// Leaves the seeded job with no steps, whatever an earlier run left.
async function clear(panel: Locator) {
  for (let n = 0; n < 20 && (await rows(panel).count()) > 0; n++) {
    await rows(panel).first().locator('button.menu-button').click();
    await panel.page().getByRole('button', { name: 'Șterge' }).click();
  }
  await expect(panel.getByText('Niciun pas încă')).toBeVisible();
}

// @traces 424-FR-012 424-FR-013 424-FR-015
test.describe('a job’s steps @seeded', () => {
  test('the owner writes three steps, the mechanic ticks one on a phone, the owner sees it at once', async ({
    browser,
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1280 });
    const owner = await openJob(page, ACCOUNTS.garage, '/app/garage');
    await clear(owner);
    for (const step of STEPS) {
      await owner.getByRole('button', { name: 'Adaugă un pas' }).click();
      await owner.getByRole('textbox').fill(step);
      await owner.getByRole('button', { exact: true, name: 'Adaugă' }).click();
      await expect(rows(owner).filter({ hasText: step })).toHaveCount(1);
    }
    await expect(owner.getByText('0 din 3 gata')).toBeVisible();

    const phone = await browser.newContext({
      viewport: { height: 844, width: 390 },
    });
    const mechanicPage = await phone.newPage();
    const mechanic = await openJob(
      mechanicPage,
      ACCOUNTS.mechanic,
      '/app/garage',
    );
    await rows(mechanic).first().locator('button[aria-pressed]').click();
    await expect(
      rows(mechanic).first().locator('button[aria-pressed]'),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      await mechanicPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    await expect(owner.getByText('1 din 3 gata')).toBeVisible({
      timeout: 5_000,
    });

    await rows(mechanic).first().locator('button[aria-pressed]').click();
    await expect(mechanic.getByText('0 din 3 gata')).toBeVisible();
    await phone.close();
    await clear(owner);
  });
});

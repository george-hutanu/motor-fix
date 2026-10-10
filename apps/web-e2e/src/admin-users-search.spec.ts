import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const rows = (page: Page) => page.locator('mf-admin-users li.row');
const names = (page: Page) => rows(page).locator('.name');

async function signInAsAdmin(page: Page) {
  await ready(page, '/ro/garages');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { name: 'Cont' })
      .click();
  } else {
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
  }
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
}

// The seeded admin reads Romanian; only the language is changed.
async function inEnglish(page: Page) {
  await page.route('**/api/v1/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), language: 'en' },
      response,
    });
  });
}

const searchBox = (page: Page, name = 'Caută după nume, e‑mail sau telefon') =>
  page.getByRole('searchbox', { name });

// @traces 002-FR-004 002-FR-008 002-FR-010 002-FR-011
// @traces 002-FR-015
test.describe('searching the accounts @seeded', () => {
  test('finds the seeded driver by a phone written with spaces, and keeps the search on reload', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);
    await page.goto('/app/admin/users');

    await searchBox(page).fill('0700 000 102');

    await expect(page).toHaveURL(/[?&]q=0700(\+|%20)000(\+|%20)102/);
    await expect(names(page)).toHaveText(['Andrei Marin']);
    await expect(page.locator('.found')).toHaveText('1 cont găsit');
    await expect(rows(page).first()).not.toContainText('0700');

    await page.reload();
    await expect(searchBox(page)).toHaveValue('0700 000 102');
    await expect(names(page)).toHaveText(['Andrei Marin']);
  });

  test("filters a garage's active mechanics, and the back button undoes the filter", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);
    await page.goto('/app/admin/users?q=atelier%20test');
    await expect(names(page).first()).toBeVisible();

    await page.getByRole('button', { name: 'Toate rolurile' }).click();
    await page
      .getByRole('group', { name: 'Roluri' })
      .getByRole('checkbox', { name: 'mecanic' })
      .check();
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Stare' }).selectOption('active');

    await expect(page).toHaveURL(/role=mechanic/);
    await expect(page).toHaveURL(/status=active/);
    await expect(names(page)).toContainText(['Vlad Stan']);
    await expect(names(page)).toContainText(['Radu Oferte']);
    for (const detail of await rows(page).locator('.detail').allTextContents())
      expect(detail).toContain('mecanic');

    await page.goBack();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByRole('combobox', { name: 'Stare' })).toHaveValue('');
  });

  test('says when nothing matches and clears everything', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);
    await page.goto('/app/admin/users?q=qqqzzzqqq&status=suspended');

    await expect(page.getByText('Niciun cont nu se potrivește.')).toBeVisible();
    await page.getByRole('button', { name: 'Șterge filtrele' }).click();

    await expect(page).toHaveURL('/app/admin/users');
    await expect(searchBox(page)).toBeFocused();
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator('.found')).toHaveCount(0);
  });

  for (const [device, width, height] of [
    ['a 320 px phone', 320, 640],
    ['a 390 px phone', 390, 844],
  ] as const) {
    test(`filters through the sheet on ${device}, with no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await signInAsAdmin(page);
      await page.goto('/app/admin/users');
      await expect(searchBox(page)).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      const filters = page.getByRole('button', {
        name: 'Filtre: Toate rolurile · Toate stările',
      });
      await filters.click();
      const sheet = page.getByRole('dialog');
      await sheet.getByRole('checkbox', { name: 'mecanic' }).check();
      await sheet.getByRole('radio', { name: 'activ' }).check();
      await sheet.getByRole('button', { name: 'Aplică' }).click();

      await expect(
        page.getByRole('button', { name: 'Filtre: mecanic · activ' }),
      ).toBeFocused();
      await expect(page).toHaveURL(/role=mechanic&status=active/);
      await expect(page.locator('.found')).toHaveText(
        /^[\d.]+ (de )?(cont găsit|conturi găsite)$/,
      );
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      await page
        .getByRole('button', { name: 'Filtre: mecanic · activ' })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('checkbox', { name: 'șofer' })
        .check();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).toHaveURL(/role=mechanic&status=active/);
    });
  }

  test('filters through the sheet in English on a phone', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await signInAsAdmin(page);
    await inEnglish(page);
    await page.goto('/app/admin/users');

    await page
      .getByRole('button', { name: 'Filters: All roles · All states' })
      .click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('checkbox', { name: 'mechanic' }).check();
    await sheet.getByRole('radio', { name: 'active' }).check();
    await sheet.getByRole('button', { name: 'Apply' }).click();

    await expect(
      page.getByRole('button', { name: 'Filters: mechanic · active' }),
    ).toBeFocused();
    await expect(page).toHaveURL(/role=mechanic&status=active/);
    await expect(page.locator('.found')).toHaveText(/^[\d,]+ accounts? found$/);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('reads in English', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);
    await inEnglish(page);
    await page.goto('/app/admin/users?q=0700000102');

    await expect(
      searchBox(page, 'Search by name, e‑mail or phone'),
    ).toHaveValue('0700000102');
    await expect(page.locator('.found')).toHaveText('1 account found');
  });
});

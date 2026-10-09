import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const panel = (page: Page) => page.locator('mf-admin-panel');
const line = (page: Page) => page.locator('.admin-line');

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

// @traces 163-FR-008 163-FR-009 163-FR-011 163-FR-013
test.describe('the admin figures by period and city @seeded', () => {
  test('chooses the period and the city on a desktop, and keeps them on reload', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);
    await expect(line(page)).toHaveText(/^\s*MotorFix · Toată țara ·/);

    await page.getByRole('radio', { name: 'Ultimele 7 zile' }).check();
    await page
      .getByRole('combobox', { name: 'Oraș' })
      .selectOption({ label: 'Cluj-Napoca' });

    await expect(page).toHaveURL('/app/admin?city=cluj-napoca&period=7d');
    await expect(line(page)).toHaveText(/^\s*MotorFix · Cluj-Napoca\b/);
    await expect(
      panel(page).getByRole('group', {
        name: /^Service‑uri listate, \d+, \+\d+ în ultimele 7 zile$/,
      }),
    ).toBeVisible();
    await expect(page.locator('mf-admin-panel[aria-busy]')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Oraș' })).toHaveValue(
      'cluj-napoca',
    );
    await expect(
      page.getByRole('radio', { name: 'Ultimele 7 zile' }),
    ).toBeChecked();
    await expect(line(page)).toHaveText(/^\s*MotorFix · Cluj-Napoca\b/);
  });

  test('chooses them in the sheet on a 390 px phone, with no sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await signInAsAdmin(page);

    await page
      .getByRole('button', { name: 'Filtre: Toată țara, Implicit' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Filtre' });
    await sheet.getByRole('radio', { name: 'Cluj-Napoca' }).check();
    await sheet.getByRole('radio', { name: 'Ultimele 7 zile' }).check();
    await sheet.getByRole('button', { name: 'Aplică' }).click();

    await expect(page).toHaveURL('/app/admin?city=cluj-napoca&period=7d');
    await expect(
      page.getByRole('button', {
        name: 'Filtre: Cluj-Napoca, Ultimele 7 zile',
      }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole('group', {
        name: /^Service‑uri listate, \d+, \+\d+ în ultimele 7 zile$/,
      }),
    ).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    await page.reload();
    await expect(
      page.getByRole('button', {
        name: 'Filtre: Cluj-Napoca, Ultimele 7 zile',
      }),
    ).toBeVisible();
  });

  test('falls back to the whole country for a city nobody has', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);

    await page.goto('/app/admin?city=timisoara&period=30d');

    await expect(page).toHaveURL('/app/admin?period=30d');
    await expect(line(page)).toHaveText(/^\s*MotorFix · Toată țara ·/);
    await expect(
      page.getByRole('radio', { name: 'Ultimele 30 de zile' }),
    ).toBeChecked();
  });

  test('reads the choices in English', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);
    await inEnglish(page);
    await page.goto('/app/admin?city=bucuresti&period=7d');

    await expect(line(page)).toHaveText(/^\s*MotorFix · Bucharest ·/);
    await expect(
      page.getByRole('radio', { name: 'Last 7 days' }),
    ).toBeChecked();
    await expect(
      panel(page).getByRole('group', {
        name: /^Garages listed, \d+, \+\d+ in the last 7 days$/,
      }),
    ).toBeVisible();
  });
});

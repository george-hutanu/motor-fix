import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, headers, openSignIn, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// @traces 1405-FR-001 1405-FR-002 1405-FR-003 1405-FR-005

// The driver whose logged repair the seed adds (libs/domain/src/seed.ts,
// loggedRepair), and that repair.
const DRIVER = 'cerere@example.test';
const REPAIR = '5eed0b00-0000-4000-8000-000000000001';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// The repair as the driver's own history reads it.
async function historyRow(request: APIRequestContext) {
  const auth = await headers(request, DRIVER);
  const cars = await request.get('/api/v1/cars', { headers: auth });
  expect(cars.ok()).toBe(true);
  const { items: owned } = (await cars.json()) as { items: { id: string }[] };
  for (const { id } of owned) {
    const res = await request.get(`/api/v1/cars/${id}/repairs`, {
      headers: auth,
    });
    if (!res.ok()) continue;
    const { items } = (await res.json()) as {
      items: {
        correctedBy: string | null;
        costBani: number | null;
        id: string;
      }[];
    };
    const found = items.find((r) => r.id === REPAIR);
    if (found) return found;
  }
  return null;
}

test.describe("correcting a driver's logged repair @seeded", () => {
  test('the admin opens it from the account, corrects the amount, and the driver sees MotorFix corrected it', async ({
    browser,
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await ready(page, '/ro/garages');
    await openSignIn(page);
    await signIn(page, ACCOUNTS.admin);
    await expect(page).toHaveURL('/app/admin');

    await page.goto(`/app/admin/users?q=${encodeURIComponent(DRIVER)}`);
    await page
      .getByRole('button', { name: 'Deschide contul Andrei Marin' })
      .click();
    const drawer = page.getByRole('dialog', { name: 'Detalii' });
    const section = drawer.getByRole('region', { name: 'Reparații adăugate' });
    const row = section.getByRole('listitem').filter({
      hasText: '12 mart. 2025 · Dacia Logan 2018',
    });
    await expect(row).toHaveCount(1);
    // The row tells the date and the car, nothing of the repair itself.
    await expect(section).not.toContainText('Garaj Nordic');
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    await row.getByRole('button', { name: /^Deschide reparația/ }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Reparație adăugată de șofer',
    });
    await expect(dialog.getByText('Garaj Nordic')).toBeVisible();
    await expect(
      dialog.getByText('Deschiderea este înregistrată în istoric'),
    ).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    await dialog.getByRole('button', { name: 'Corectează' }).click();
    await dialog.getByLabel('Suma, în lei').fill('480');
    await dialog.getByRole('button', { name: 'Salvează' }).click();
    await expect(dialog.getByText('480 lei')).toBeVisible();
    await expect(dialog.getByText('Corectată de MotorFix')).toBeVisible();

    // The driver's history tells MotorFix corrected it, at the new amount.
    await expect
      .poll(async () => historyRow(request))
      .toMatchObject({ correctedBy: 'admin', costBani: 48000 });

    // And the driver's bell names MotorFix.
    const context = await browser.newContext();
    const driver = await context.newPage();
    await ready(driver, '/ro/garages');
    await openSignIn(driver);
    await signIn(driver, DRIVER);
    await expect(driver).toHaveURL(/\/app\/driver/);
    await driver.getByRole('button', { name: /^Notificări/ }).click();
    await expect(
      driver
        .getByRole('dialog', { name: 'Notificări' })
        .getByText(/MotorFix a corectat o reparație/)
        .first(),
    ).toBeVisible();
    await context.close();
  });
});

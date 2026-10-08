import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// [entry in the menu, tab in the bar, address, title]
const VIEWS = [
  ['Panou', 'Panou', '/app/driver', 'Panoul tău'],
  ['Cererile mele', 'Cereri', '/app/driver/requests', 'Cererile mele'],
  ['Mașinile mele', 'Mașini', '/app/driver/cars', 'Mașinile mele'],
  ['Recenziile mele', 'Recenzii', '/app/driver/reviews', 'Recenziile mele'],
  [
    'Service‑uri salvate',
    'Salvate',
    '/app/driver/saved',
    'Service‑uri salvate',
  ],
  ['Setări', 'Setări', '/app/driver/settings', 'Setări'],
] as const;

const title = (page: Page) => page.getByRole('heading', { level: 1 });

async function signedInDriver(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.driver);
  await expect(page).toHaveURL('/app/driver');
  await expect(title(page)).toHaveText('Panoul tău');
}

// A marker that a reload would lose, and a page tall enough to scroll.
async function mark(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __mf: number }).__mf = 1;
    document.documentElement.style.minHeight = '400vh';
  });
}

async function scrollDown(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
}

async function arrived(page: Page, address: string, text: string) {
  await expect(page).toHaveURL(address);
  await expect(title(page)).toHaveText(text);
  expect(
    await page.evaluate(() => (window as unknown as { __mf?: number }).__mf),
  ).toBe(1);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

// @seeded: signs in as the seeded driver against the real API.
test.describe('driver views @seeded', () => {
  // @traces 028-FR-003 028-FR-006 028-FR-007
  test('the menu opens every released view at the top, without a reload, and back returns', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedInDriver(page);
    await mark(page);
    const menu = page.getByRole('navigation', { name: 'Meniu' });

    await expect(menu.getByRole('link')).toHaveText(
      VIEWS.map(([entry]) => entry),
    );
    for (const [entry, , address, text] of [...VIEWS.slice(1), VIEWS[0]]) {
      await scrollDown(page);
      // A click event as a tap sends it, with no scrolling the entry into view.
      await menu
        .getByRole('link', { exact: true, name: entry })
        .dispatchEvent('click');
      await arrived(page, address, text);
    }

    await menu
      .getByRole('link', { exact: true, name: 'Mașinile mele' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/app/driver/cars');
    await expect(
      menu.getByRole('link', { exact: true, name: 'Mașinile mele' }),
    ).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL('/app/driver');
    await expect(title(page)).toHaveText('Panoul tău');

    await page.getByRole('button', { exact: true, name: 'EN' }).click();
    await expect(title(page)).toHaveText('Your dashboard');
    await expect(page.getByText('DRIVER ACCOUNT')).toBeVisible();
    await page.getByRole('button', { exact: true, name: 'RO' }).click();
    await expect(page.getByText('CONT ȘOFER')).toBeVisible();

    await page
      .getByRole('button', { exact: true, name: 'Ieși din cont' })
      .click();
    await expect(page).toHaveURL(/\/ro\/?$/);
  });

  // @traces 028-FR-003 028-FR-007
  test('the bar opens every released view on a phone, at the top', async ({
    page,
  }) => {
    // Signed in at desktop width, where the header carries the button.
    await signedInDriver(page);
    await page.setViewportSize({ height: 844, width: 390 });
    await mark(page);
    const bar = page.getByRole('navigation', { name: 'Panou șofer' });

    await expect(bar.getByRole('link')).toHaveText(VIEWS.map(([, tab]) => tab));
    for (const [, tab, address, text] of [...VIEWS.slice(1), VIEWS[0]]) {
      await scrollDown(page);
      await bar
        .getByRole('link', { exact: true, name: tab })
        .dispatchEvent('click');
      await arrived(page, address, text);
    }
    await expect(page.getByText('Asistent AI')).toHaveCount(0);
  });

  // @traces 028-FR-005 028-FR-007
  test('a signed-out visit to a view opens that view after sign-in', async ({
    page,
  }) => {
    await ready(page, '/app/driver/cars');
    await expect(page).toHaveURL(/\/ro\/?$/);

    await signIn(page, ACCOUNTS.driver);

    await expect(page).toHaveURL('/app/driver/cars');
    await expect(title(page)).toHaveText('Mașinile mele');
  });
});

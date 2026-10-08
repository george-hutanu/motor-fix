import { expect, type Page } from '@playwright/test';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

const field = (page: Page, name = 'Caută marca') =>
  page.getByRole('combobox', { name });
const suggestions = (page: Page) => page.getByRole('option');
const tiles = (page: Page) =>
  page.getByRole('radiogroup', { name: 'Marca mașinii' }).getByRole('radio');

test.describe('the brand search @seeded', () => {
  test('finds Alfa Romeo, makes it the selected first tile and opens its results', async ({
    page,
  }) => {
    await ready(page, '/ro');

    await field(page).fill('alf');
    await expect(suggestions(page)).toHaveText(['Alfa Romeo']);
    await suggestions(page).first().click();

    await expect(tiles(page)).toHaveCount(8);
    await expect(tiles(page).first()).toHaveText('Alfa Romeo');
    await expect(tiles(page).first()).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Service‑uri pentru Alfa Romeo')).toBeVisible();
    await expect(
      page.getByText(/primesc Alfa Romeo|primește Alfa Romeo/),
    ).toBeVisible();
    await expect(field(page)).toHaveValue('');

    await page.waitForTimeout(6_000);
    await expect(tiles(page).first()).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('link', { name: 'Caută service‑uri' }).click();
    await expect(page).toHaveURL('/ro/garages?brand=alfa-romeo');
  });

  test('ignores case and diacritics', async ({ page }) => {
    await ready(page, '/ro');

    await field(page).fill('skoda');
    await expect(suggestions(page)).toHaveText(['Škoda']);
    await field(page).fill('CITROEN');
    await expect(suggestions(page)).toHaveText(['Citroën']);
  });

  test('chooses a suggestion with the keyboard and announces the count', async ({
    page,
  }) => {
    await ready(page, '/ro');

    await field(page).focus();
    await page.keyboard.type('a');
    const second = await suggestions(page).nth(1).textContent();
    await expect(
      page.getByRole('status').filter({ hasText: /mărci găsite|marcă găsită/ }),
    ).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(tiles(page).filter({ hasText: second ?? '' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('closes with Escape and keeps the selected brand', async ({ page }) => {
    await ready(page, '/ro');
    const selected = await tiles(page).first().textContent();

    await field(page).fill('a');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');

    await expect(suggestions(page)).toHaveCount(0);
    await expect(tiles(page).first()).toHaveText(selected ?? '');
  });

  test('reads "Nicio marcă găsită" for text that is no brand, and selects nothing', async ({
    page,
  }) => {
    await ready(page, '/ro');
    const selected = await tiles(page).first().textContent();

    await field(page).fill('zzz');
    await expect(page.getByText('Nicio marcă găsită').first()).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(tiles(page).first()).toHaveText(selected ?? '');
    await expect(tiles(page).first()).toHaveAttribute('aria-checked', 'true');
  });

  test('turns English with the page and keeps the typed text', async ({
    page,
  }) => {
    await ready(page, '/ro');

    await field(page).fill('alf');
    await page.getByRole('button', { exact: true, name: 'EN' }).click();

    await expect(field(page, 'Search for a brand')).toHaveValue('alf');
  });

  test('says the list did not load, keeps the tiles working, and tries again', async ({
    page,
  }) => {
    let fail = true;
    await page.route('**/api/v1/brands?*', (route) =>
      fail ? route.abort() : route.continue(),
    );
    await page.route('**/api/v1/brands', (route) =>
      fail ? route.abort() : route.continue(),
    );
    await ready(page, '/ro');

    await field(page).focus();
    await expect(
      page.getByText('Lista de mărci nu s‑a încărcat'),
    ).toBeVisible();
    await expect(field(page)).toBeDisabled();
    await tiles(page).filter({ hasText: 'Dacia' }).click();
    await expect(tiles(page).filter({ hasText: 'Dacia' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fail = false;
    await page
      .locator('mf-brand-search')
      .getByRole('button', { name: 'Reîncearcă' })
      .click();
    await expect(field(page)).toBeEnabled();
    await field(page).fill('alf');
    await expect(suggestions(page)).toHaveText(['Alfa Romeo']);
  });
});

for (const scheme of ['light', 'dark'] as const) {
  for (const path of ['/ro', '/en']) {
    test(`fits the search on a 320 px phone on ${path}, ${scheme} @seeded`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 640, width: 320 });
      await ready(page, path);
      const button = page.locator('a.search');
      const before = await button.boundingBox();

      await page.getByRole('combobox').fill('a');
      await expect(suggestions(page).first()).toBeVisible();

      const heights = [
        await page
          .getByRole('combobox')
          .evaluate((e) => e.getBoundingClientRect().height),
        ...(await suggestions(page).evaluateAll((all) =>
          all.map((o) => o.getBoundingClientRect().height),
        )),
      ];
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
      expect(await button.boundingBox()).toEqual(before);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320);
    });
  }
}

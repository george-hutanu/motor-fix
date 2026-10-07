import { expect, type Page } from '@playwright/test';

import { test } from './fixtures.js';

// @traces 040-FR-013

const step = (page: Page) => page.locator('mf-brands-step');
const chip = (page: Page, name: string) =>
  step(page).locator('.chips button', { hasText: name });
const counter = (page: Page) => step(page).locator('[aria-live="polite"]');

async function open(page: Page, path = '/ro/list-your-garage') {
  await page.goto(path);
  await expect(chip(page, 'BMW')).toBeVisible();
}

async function tap(page: Page, name: string, times = 1) {
  for (let i = 0; i < times; i++) await chip(page, name).click();
}

test.describe('step 2 of list your garage, the brands', () => {
  test('marks four brands taken and two refused, then switches one off', async ({
    page,
  }) => {
    await open(page);

    for (const name of ['BMW', 'Mini', 'Audi', 'Dacia']) await tap(page, name);
    await tap(page, 'Tesla', 2);
    await tap(page, 'Renault', 2);

    await expect(counter(page)).toHaveText('4 primite · 2 refuzate');
    await expect(chip(page, 'BMW')).toHaveText(/lucrezi pe ea/);
    await expect(chip(page, 'Tesla')).toHaveText(/nu o primești/);

    await tap(page, 'Renault');
    await expect(counter(page)).toHaveText('4 primite · 1 refuzată');
    await expect(chip(page, 'Renault')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('finds Lada by search and adds it taken, then keeps everything in English', async ({
    page,
  }) => {
    // The catalogue ships the twelve popular brands only, so the search for
    // a brand outside them is answered here, shaped like the API's page.
    await page.route(
      (url) =>
        url.pathname.endsWith('/api/v1/brands') &&
        url.searchParams.get('q') === 'lada',
      (route) =>
        route.fulfill({
          json: {
            items: [
              {
                id: '00000000-0000-4000-8000-0000000000aa',
                name: 'Lada',
                popularity: null,
                slug: 'lada',
              },
            ],
            nextCursor: null,
            total: 1,
          },
        }),
    );
    await open(page);
    await tap(page, 'Tesla', 2);
    // A field typed in before hydration is wiped when the client takes over.
    await expect(chip(page, 'Tesla')).toHaveText(/nu o primești/);

    await step(page).locator('input[type="search"]').fill('lada');
    await step(page).locator('.results button', { hasText: 'Lada' }).click();
    await expect(chip(page, 'Lada')).toHaveText(/lucrezi pe ea/);

    await step(page).locator('input[name="brandNote"]').fill('Doar benzină');
    await step(page)
      .locator('input[name="refusalPhrase"]')
      .fill('orice nu e BMW');
    await expect(counter(page)).toHaveText('1 primită · 1 refuzată');

    await page.getByRole('button', { exact: true, name: 'EN' }).click();

    await expect(counter(page)).toHaveText('1 taken · 1 refused');
    await expect(chip(page, 'Lada')).toHaveText(/you work on it/);
    await expect(chip(page, 'Tesla')).toHaveText(/you do not take it/);
    await expect(step(page).locator('input[name="brandNote"]')).toHaveValue(
      'Doar benzină',
    );
    await expect(step(page).locator('input[name="refusalPhrase"]')).toHaveValue(
      'orice nu e BMW',
    );
  });

  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [820, 1180],
    [1280, 800],
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      for (const path of ['/ro/list-your-garage', '/en/list-your-garage']) {
        test(`${path} at ${width} px, ${scheme}: no sideways scroll, chips at least 44 px tall`, async ({
          page,
        }) => {
          await page.setViewportSize({ height, width });
          await page.emulateMedia({ colorScheme: scheme });
          await open(page, path);
          await tap(page, 'Mercedes-Benz');

          const sideways = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(sideways).toBe(false);
          const heights = await step(page)
            .locator('.chips button')
            .evaluateAll((buttons) =>
              buttons.map((b) => b.getBoundingClientRect().height),
            );
          expect(heights.length).toBeGreaterThanOrEqual(12);
          for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
        });
      }
    }
  }
});

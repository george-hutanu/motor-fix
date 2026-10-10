import { expect, type Page } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';

// @traces 040-FR-013
// @traces 412-FR-012

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
    // The catalogue ships the twelve popular brands and two unranked ones,
    // so the search for a brand outside them is answered here, shaped like
    // the API's page.
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

  test('unticks a job for Dacia, keeps it unticked after a reload, and ticks all again after a refusal', async ({
    page,
  }) => {
    const OIL = 'Schimb de ulei și filtre';
    const prices = page.locator('mf-prices-step');
    // A `has` locator is resolved inside each row, so it starts at the row's
    // own chip button, not at mf-brands-step.
    const dacia = step(page)
      .locator('.chips > li')
      .filter({ has: page.locator('button', { hasText: 'Dacia' }) });
    const row = dacia.locator('details.jobs');
    const box = (name: string) =>
      row.getByRole('checkbox', { exact: true, name: `Dacia, ${name}` });

    await open(page);
    await tap(page, 'Dacia');
    // The step-3 job list reaches the draft with its first change.
    await expect(prices.locator('li.job .name').first()).toBeVisible();
    await prices
      .getByRole('textbox', { exact: true, name: `${OIL}, de la` })
      .fill('300');
    await expect(row.locator('summary')).toHaveText('Lucrări: 3 din 3');

    await row.locator('summary').click();
    await box(OIL).uncheck();
    await expect(row.locator('summary')).toHaveText('Lucrări: 2 din 3');
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).some((key) =>
            (localStorage.getItem(key) ?? '').includes('"unticked"'),
          ),
        ),
      )
      .toBe(true);

    await page.reload();
    await settled(page);

    await expect(row.locator('summary')).toHaveText('Lucrări: 2 din 3');
    await row.locator('summary').click();
    await expect(box(OIL)).not.toBeChecked();
    await expect(row.getByRole('checkbox', { checked: true })).toHaveCount(2);

    await tap(page, 'Dacia', 3);
    await expect(row.locator('summary')).toHaveText('Lucrări: 3 din 3');
  });
});

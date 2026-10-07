import { expect, type Locator, type Page, test } from '@playwright/test';

import { ready } from './accounts.js';

// @traces 109-FR-010 109-FR-012 109-FR-020 109-SC-001

const details = (page: Page) => page.locator('mf-details-step');
const prices = (page: Page) => page.locator('mf-prices-step');
const mechanics = (page: Page) => page.locator('mf-mechanics-step');
const DIAGNOSIS = 'Diagnoză și citire coduri de eroare';
const OIL = 'Schimb de ulei și filtre';
const BRAKES = 'Plăcuțe și discuri de frână față';

const ends = (scope: Locator, name: string) => [
  scope.getByRole('textbox', { exact: true, name: `${name}, de la` }),
  scope.getByRole('textbox', { exact: true, name: `${name}, până la` }),
];

async function range(scope: Locator, name: string, from: string, to: string) {
  const [low, high] = ends(scope, name);
  await low.fill(from);
  await high.fill(to);
}

const ticked = (page: Page) =>
  page
    .locator('nav ol li')
    .evaluateAll((items) =>
      items.flatMap((li, i) => (li.querySelector('.done') ? [i + 1] : [])),
    );

// The browser copy is written a moment after the last change.
async function kept(page: Page, text: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (wanted) =>
          Object.keys(localStorage).some((key) =>
            (localStorage.getItem(key) ?? '').includes(wanted),
          ),
        text,
      ),
    )
    .toBe(true);
}

test.describe('steps 1, 3 and 4 of list your garage', () => {
  test('the details, the prices with a brand range and a new job, and a mechanic come back after a reload', async ({
    page,
  }) => {
    await ready(page, '/ro/list-your-garage');
    await expect(prices(page).locator('li.job .name').first()).toHaveText(
      DIAGNOSIS,
    );

    await details(page).locator('[name="name"]').fill('Service Popescu');
    await details(page).locator('[name="phone"]').fill('0722 123 456');
    await details(page).locator('[name="knownFor"]').fill('Frâne și diesel');
    await details(page).getByRole('button', { name: 'Mecanic mobil' }).click();
    await details(page).getByRole('button', { name: 'PFA' }).click();

    await page
      .locator('mf-brands-step .chips button', { hasText: 'BMW' })
      .click();

    await range(prices(page), 'Manoperă, pe oră', '120', '200');
    await range(prices(page), DIAGNOSIS, '100', '250');
    await range(prices(page), OIL, '300', '600');
    await range(prices(page), BRAKES, '400', '900');

    const brakes = prices(page).locator('li.job', { hasText: BRAKES });
    await brakes.locator('summary').click();
    await brakes.getByRole('button', { exact: true, name: 'BMW' }).click();
    await range(brakes, `${BRAKES} · BMW`, '700', '1400');

    await prices(page).locator('input[type="search"]').fill('Reglaj faruri');
    await prices(page)
      .getByRole('button', { name: 'Adaugă „Reglaj faruri” ca lucrare nouă' })
      .click();
    await range(prices(page), 'Reglaj faruri', '80', '150');

    await mechanics(page)
      .getByRole('button', { name: 'Adaugă un mecanic' })
      .click();
    await mechanics(page).locator('input[name="name"]').fill('Ion Marin');
    await mechanics(page).locator('input[name="speciality"]').fill('Diagnoză');
    await kept(page, 'Ion Marin');
    expect(await ticked(page)).toEqual([1, 3, 4]);

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(details(page).locator('[name="name"]')).toHaveValue(
      'Service Popescu',
    );
    await expect(details(page).locator('[name="phone"]')).toHaveValue(
      '0722 123 456',
    );
    await expect(
      details(page).getByRole('button', { name: 'Mecanic mobil' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(ends(prices(page), 'Manoperă, pe oră')[1]).toHaveValue('200');
    await expect(ends(prices(page), `${BRAKES} · BMW`)[1]).toHaveValue('1400');
    const proposed = prices(page).locator('li.job', {
      hasText: 'Reglaj faruri',
    });
    await expect(proposed.locator('.pending')).toHaveText('Așteaptă aprobare');
    await expect(ends(prices(page), 'Reglaj faruri')[0]).toHaveValue('80');
    await expect(mechanics(page).locator('input[name="name"]')).toHaveValue(
      'Ion Marin',
    );
    await expect.poll(() => ticked(page)).toEqual([1, 3, 4]);
  });
});

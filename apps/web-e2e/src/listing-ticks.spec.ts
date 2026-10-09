import { expect, type Page } from '@playwright/test';

import { ready, settled } from './accounts.js';
import { test } from './fixtures.js';

const brands = (page: Page) => page.locator('mf-brands-step');
const hours = (page: Page) => page.locator('mf-hours-step');
const brand = (page: Page, name: string) =>
  brands(page).locator('.chips button', { hasText: name }).first();
const fuel = (page: Page, name: string) =>
  brands(page).locator('.fuels button').and(page.getByRole('button', { name }));
const payment = (page: Page, name: string) =>
  hours(page).locator('.payments button', { hasText: name });
const facility = (page: Page, name: string) =>
  hours(page).locator('.facilities button', { hasText: name });
const price = (page: Page) =>
  hours(page).locator('input[name="courtesyPrice"]');

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

test.describe('list your garage, the payment, fuel and courtesy car ticks', () => {
  test('at 320 px: a brand without electric, cash and card, a courtesy car at 120 lei a day come back after a reload', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, '/ro/list-your-garage');

    await brand(page, 'Dacia').click();
    await expect(brand(page, 'Dacia')).toHaveText(/lucrezi pe ea/);
    await fuel(page, 'Dacia, Electric').click();
    await expect(fuel(page, 'Dacia, Electric')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await payment(page, 'Numerar').click();
    await payment(page, 'Card').click();
    await facility(page, 'Mașină la schimb').click();
    await hours(page).getByRole('radio', { name: 'Contra cost' }).check();
    await price(page).fill('120');
    await kept(page, '"pricePerDayBani":12000');

    const sideways = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(sideways).toBe(false);

    await page.reload();
    await settled(page);

    await expect(brand(page, 'Dacia')).toHaveText(/lucrezi pe ea/);
    for (const name of ['Benzină', 'Diesel', 'Hibrid'])
      await expect(fuel(page, `Dacia, ${name}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    await expect(fuel(page, 'Dacia, Electric')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(payment(page, 'Numerar')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(payment(page, 'Card')).toHaveAttribute('aria-pressed', 'true');
    await expect(payment(page, 'Transfer bancar')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(facility(page, 'Mașină la schimb')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      hours(page).getByRole('radio', { name: 'Contra cost' }),
    ).toBeChecked();
    await expect(price(page)).toHaveValue('120');
  });
});

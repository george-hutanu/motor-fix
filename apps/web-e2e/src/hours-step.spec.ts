import { expect, type Page } from '@playwright/test';

import { ready, settled } from './accounts.js';
import { test } from './fixtures.js';

const step = (page: Page) => page.locator('mf-hours-step');
const select = (page: Page, name: string) =>
  step(page).locator(`select[name="${name}"]`);
const tick = (page: Page, name: string) =>
  step(page).locator(`input[type="checkbox"][name="${name}"]`);
const chip = (page: Page, name: string) =>
  step(page).locator('.facilities button', { hasText: name });
const closedDays = (page: Page) => step(page).locator('.closed-days li');

async function open(page: Page, path = '/ro/list-your-garage') {
  // The closed-day window and the holiday list count from today.
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'));
  await ready(page, path);
  await expect(select(page, 'weekdays-open')).toBeVisible();
}

// The days open by themselves when the weekdays differ.
async function byDay(page: Page) {
  const days = step(page).locator('details');
  if (!(await days.evaluate((d) => (d as HTMLDetailsElement).open)))
    await step(page).locator('details summary').click();
  await expect(step(page).locator('[data-day="sun"]')).toBeVisible();
}

async function addClosedDay(page: Page, day: string, note = '') {
  await step(page).locator('input[name="closedDay"]').fill(day);
  await step(page).locator('input[name="closedNote"]').fill(note);
  await step(page).locator('button.add-closed').click();
}

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

test.describe('step 5 of list your garage, the hours and facilities', () => {
  for (const [width, height] of [
    [320, 640],
    [390, 844],
  ]) {
    test(`at ${width} px: a week with a lunch break, Sunday open, a closed day and two facilities come back after a reload`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await open(page);

      await select(page, 'weekdays-open').selectOption('08:30');
      await select(page, 'weekdays-close').selectOption('18:00');
      await tick(page, 'sat-closed').uncheck();
      await select(page, 'sat-open').selectOption('09:00');
      await select(page, 'sat-close').selectOption('13:00');

      await byDay(page);
      await step(page)
        .locator('[data-day="mon"]')
        .getByRole('button', { name: 'Adaugă pauză' })
        .click();
      await select(page, 'mon-0-close').selectOption('12:00');
      await select(page, 'mon-1-open').selectOption('13:00');
      await tick(page, 'sun-closed').uncheck();
      await select(page, 'sun-0-open').selectOption('10:00');
      await select(page, 'sun-0-close').selectOption('14:00');
      await expect(step(page).locator('[data-row="weekdays"]')).toContainText(
        'Program diferit pe zile',
      );

      await addClosedDay(page, '2026-12-27', 'Inventar');
      await expect(closedDays(page)).toHaveCount(1);
      await addClosedDay(page, '2026-12-01');
      await expect(step(page).locator('.closed-error')).toHaveText(
        'E deja zi liberă legală',
      );
      await expect(closedDays(page)).toHaveCount(1);

      await chip(page, 'Sală de așteptare').click();
      await chip(page, 'Mașină la schimb').click();
      await kept(page, 'courtesy_car');

      await page.reload();
      await settled(page);

      await byDay(page);
      await expect(select(page, 'mon-0-open')).toHaveValue('08:30');
      await expect(select(page, 'mon-0-close')).toHaveValue('12:00');
      await expect(select(page, 'mon-1-open')).toHaveValue('13:00');
      await expect(select(page, 'mon-1-close')).toHaveValue('18:00');
      await expect(select(page, 'tue-0-close')).toHaveValue('18:00');
      await expect(select(page, 'sat-0-open')).toHaveValue('09:00');
      await expect(select(page, 'sun-0-close')).toHaveValue('14:00');
      await expect(closedDays(page)).toHaveCount(1);
      await expect(closedDays(page)).toContainText('Inventar');
      await expect(chip(page, 'Sală de așteptare')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(chip(page, 'Mașină la schimb')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(chip(page, 'Preluare și predare')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  }

  test('refuses a closing time before the opening time and keeps the last valid one', async ({
    page,
  }) => {
    await open(page);

    await select(page, 'weekdays-close').selectOption('07:00');

    await expect(step(page).locator('[data-row="weekdays"] .error')).toHaveText(
      'Ora de închidere trebuie să fie după deschidere',
    );
    await chip(page, 'Sală de așteptare').click();
    await kept(page, 'waiting_area');

    await page.reload();
    await settled(page);
    await expect(select(page, 'weekdays-close')).toHaveValue('17:00');
    await expect(
      step(page).locator('[data-row="weekdays"] .error'),
    ).toHaveCount(0);
  });

  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [820, 1180],
    [1280, 800],
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      for (const path of ['/ro/list-your-garage', '/en/list-your-garage']) {
        test(`${path} at ${width} px, ${scheme}: no sideways scroll, ticks, chips and buttons at least 44 px tall`, async ({
          page,
        }) => {
          await page.setViewportSize({ height, width });
          await page.emulateMedia({ colorScheme: scheme });
          await open(page, path);
          await byDay(page);
          await step(page).locator('[data-day="mon"] button').first().click();
          await addClosedDay(page, '2026-12-27', 'Inventar');
          await expect(closedDays(page)).toHaveCount(1);

          const sideways = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(sideways).toBe(false);
          const heights = await step(page)
            .locator('button, label:has(input[type="checkbox"])')
            .evaluateAll((targets) =>
              targets.map((t) => t.getBoundingClientRect().height),
            );
          expect(heights.length).toBeGreaterThanOrEqual(12);
          for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
          const sizes = await step(page)
            .locator('select, input')
            .evaluateAll((fields) =>
              fields
                .filter((f) => (f as HTMLInputElement).type !== 'checkbox')
                .map((f) => Number.parseFloat(getComputedStyle(f).fontSize)),
            );
          for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
        });
      }
    }
  }
});

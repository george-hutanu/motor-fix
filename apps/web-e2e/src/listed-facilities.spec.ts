import { expect, type Page } from '@playwright/test';

import { ready, settled } from './accounts.js';
import { test } from './fixtures.js';

const hours = (page: Page) => page.locator('mf-hours-step');
const facility = (page: Page, name: string) =>
  hours(page).locator('.facilities button', { hasText: name });
const note = (page: Page) =>
  hours(page).locator('input[name="facilitiesNote"]');
const NOTE = 'Mașina la schimb se cere la programare';

// @traces 330-FR-001 330-FR-002
test.describe('list your garage, the facilities note', () => {
  test('at 320 px: two facilities and a note come back after a reload, and a note too long says so', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, '/ro/list-your-garage');

    await facility(page, 'Mașină la schimb').click();
    await facility(page, 'Sală de așteptare').click();
    await note(page).fill(NOTE);
    await expect
      .poll(() =>
        page.evaluate(
          (wanted) =>
            Object.keys(localStorage).some((key) =>
              (localStorage.getItem(key) ?? '').includes(wanted),
            ),
          `"facilitiesNote":"${NOTE}"`,
        ),
      )
      .toBe(true);

    await page.reload();
    await settled(page);

    await expect(note(page)).toHaveValue(NOTE);
    await expect(facility(page, 'Sală de așteptare')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await note(page).fill('a'.repeat(201));
    await note(page).blur();
    await expect(note(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(hours(page)).toContainText(
      'Nota poate avea cel mult 200 de caractere',
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });
});

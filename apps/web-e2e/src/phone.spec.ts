import { expect, type Page, test } from '@playwright/test';

import { signInAs } from './sign-in.js';

const routes = [
  // Home lives at its language addresses; `/` moves to one of them.
  { path: '/ro' },
  { path: '/en' },
  { path: '/cockpit' },
  { path: '/app/driver', role: 'driver' },
  { path: '/app/garage', role: 'garage' },
  { path: '/app/admin', role: 'admin' },
];

async function open(page: Page, path: string, role?: string) {
  if (role) await signInAs(page, role, path);
  await page.goto(path);
  await expect(page).toHaveURL(path);
  await page.waitForLoadState('networkidle');
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth);

for (const { path, role } of routes) {
  test.describe(`${path} on a phone`, () => {
    test('does not scroll sideways at 320 px', async ({ page }) => {
      await page.setViewportSize({ height: 640, width: 320 });
      await open(page, path, role);

      expect(await sideways(page)).toBeLessThanOrEqual(320);
    });

    test('has no text under 12 px, no target under 44 px and 16 px fields at 375 px', async ({
      page,
    }) => {
      await page.setViewportSize({ height: 812, width: 375 });
      await open(page, path, role);

      const shown = (selector: string) =>
        page.evaluate(
          (css) =>
            [...document.body.querySelectorAll(css)]
              .filter(
                (el) =>
                  el.getClientRects().length > 0 &&
                  getComputedStyle(el).visibility !== 'hidden',
              )
              .map((el) => ({
                height: el.getBoundingClientRect().height,
                inText: el.closest('p, li') !== null,
                label: `${el.tagName} "${el.textContent?.trim()}"`,
                size: Number.parseFloat(getComputedStyle(el).fontSize),
                text: [...el.childNodes].some(
                  (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
                ),
              })),
          selector,
        );

      const texts = (await shown('*:not(script, style)')).filter((e) => e.text);
      const targets = (
        await shown(
          'a, button, select, textarea, summary, [role="button"], [role="tab"], [role="switch"], input:not([type="checkbox"], [type="radio"], [type="hidden"], [type="range"])',
        )
      ).filter((e) => !e.inText || !e.label.startsWith('A '));
      const fields = await shown('input, select, textarea');

      expect(texts.length).toBeGreaterThan(0);
      expect(targets.length).toBeGreaterThan(0);
      expect(texts.filter((e) => e.size < 12).map((e) => e.label)).toEqual([]);
      expect(targets.filter((e) => e.height < 44).map((e) => e.label)).toEqual(
        [],
      );
      expect(fields.filter((e) => e.size < 16).map((e) => e.label)).toEqual([]);
    });

    test('wraps rather than cuts at 200 % text size at 375 px', async ({
      page,
    }) => {
      await page.setViewportSize({ height: 812, width: 375 });
      await open(page, path, role);
      // A 200 % text size doubles a px type scale; nothing else changes.
      await page.addStyleTag({
        content: `:root {
          --mf-size-label: 24px; --mf-size-small: 26px;
          --mf-size-body: 30px; --mf-size-field: 32px;
        }
        h1 { font-size: 64px; }`,
      });

      expect(await sideways(page)).toBeLessThanOrEqual(375);
      const cut = await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .filter((b) => b.getBoundingClientRect().width > 0)
          .filter((b) => b.scrollWidth > b.clientWidth + 1)
          .map((b) => b.textContent?.trim()),
      );
      expect(cut).toEqual([]);
    });
  });
}

test.describe('the shared table', () => {
  const cells = (page: Page) =>
    page
      .getByRole('row')
      .filter({ hasText: 'Atelier Dinamo' })
      .getByRole('cell');

  test('shows each row as the main text, then the key value, on a phone', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    await open(page, '/cockpit');

    await expect(
      page.getByRole('columnheader', { name: 'Service' }),
    ).toBeHidden();
    await expect(cells(page).filter({ hasText: 'Militari' })).toBeHidden();
    const name = await cells(page)
      .filter({ hasText: 'Atelier Dinamo' })
      .boundingBox();
    const rating = await cells(page).filter({ hasText: '4,9' }).boundingBox();
    expect(name && rating).toBeTruthy();
    expect(rating!.x).toBeGreaterThan(name!.x + name!.width - 1);
    expect(Math.abs(rating!.y - name!.y)).toBeLessThan(name!.height);
  });

  test('shows every column and the header from a tablet up', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1024 });
    await open(page, '/cockpit');

    await expect(
      page.getByRole('columnheader', { name: 'Service' }),
    ).toBeVisible();
    await expect(cells(page)).toHaveCount(3);
    for (const text of ['Atelier Dinamo', 'Militari', '4,9']) {
      await expect(cells(page).filter({ hasText: text })).toBeVisible();
    }
  });

  test('switches at once on a resize, keeping what was typed', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    await open(page, '/cockpit');
    const field = page.locator('#car-brand');
    await field.fill('Dacia Logan');
    const area = cells(page).filter({ hasText: 'Militari' });

    await page.setViewportSize({ height: 800, width: 1024 });
    await expect(area).toBeVisible();
    await page.setViewportSize({ height: 812, width: 375 });
    await expect(area).toBeHidden();

    await expect(field).toHaveValue('Dacia Logan');
  });
});

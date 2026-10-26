// @traces 1263-admin-dashboard-customise-FR-010
// @traces 1263-admin-dashboard-customise-FR-012
// @traces 1263-admin-dashboard-customise-FR-013
// @traces 1263-admin-dashboard-customise-FR-015
import { expect, type Locator, type Page } from '@playwright/test';

import { ACCOUNTS } from './accounts.js';
import { test } from './fixtures.js';

// jsdom does no layout: the boxes below are measured in a real browser.

const ADMIN_CAPABILITIES = [
  'admin.garages',
  'admin.users',
  'admin.reviews',
  'admin.catalogue',
  'admin.settings',
  'admin.audit_history',
];

type Box = { x: number; y: number; width: number; height: number };

const box = async (locator: Locator): Promise<Box> => {
  const measured = await locator.boundingBox();
  if (!measured) throw new Error('the element has no box');
  return measured;
};

// Two boxes overlap when they share any area; touching edges do not.
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// A signed-in admin whose platform figures fail to load.
const stubFailedAdmin = async (page: Page) => {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ json: { accessToken: 'stubbed' } }),
  );
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        capabilities: ADMIN_CAPABILITIES,
        email: ACCOUNTS.admin,
        garageAccess: [],
        garageId: null,
        id: 'admin-1',
        landing: '/app/admin',
        language: 'ro',
        name: 'Admin MotorFix',
        role: 'admin',
        roles: ['admin'],
      },
    }),
  );
  await page.route('**/api/v1/admin/overview', (route) =>
    route.fulfill({ json: { code: 'unavailable' }, status: 503 }),
  );
};

const panel = (page: Page) => page.locator('mf-admin-panel');
const header = (page: Page) => page.locator('header:has(.tools)');

test.describe('the admin panel layout', () => {
  for (const width of [320, 768, 1280]) {
    test(`opens a failed tile's reason clear of its button and number at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 900, width });
      await stubFailedAdmin(page);
      await page.goto('/app/admin');

      const tile = panel(page)
        .getByRole('group')
        .filter({ has: page.getByRole('button', { name: 'De ce?' }) })
        .first();
      const why = tile.getByRole('button', { name: 'De ce?' });
      await expect(why).toBeVisible();
      const tip = tile.getByRole('tooltip', { includeHidden: true });
      await expect(tip).toBeHidden();

      await why.click();
      await expect(tip).toBeVisible();
      await expect(why).toHaveAttribute('aria-expanded', 'true');
      const tipBox = await box(tip);
      expect(overlap(tipBox, await box(why))).toBe(0);
      expect(overlap(tipBox, await box(tile.locator('.number')))).toBe(0);
      if (width === 320) expect(await sideways(page)).toBeLessThanOrEqual(0);

      // The button stays pressable while the tip shows: the second press closes it.
      await why.click();
      await expect(tip).toBeHidden();
      await expect(why).toHaveAttribute('aria-expanded', 'false');
    });
  }

  test('lines the six tiles up with the header controls at 1280 px', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1280 });
    await stubFailedAdmin(page);
    await page.goto('/app/admin');
    await expect(
      panel(page).getByRole('button', { name: 'De ce?' }).first(),
    ).toBeVisible();

    const edges = await panel(page)
      .getByRole('group')
      .evaluateAll((all) => {
        const boxes = all.map((t) => t.getBoundingClientRect());
        return {
          left: Math.min(...boxes.map((b) => b.left)),
          right: Math.max(...boxes.map((b) => b.right)),
        };
      });
    const title = await box(header(page).locator('.title'));
    const tools = await box(header(page).locator('.tools'));
    expect(Math.abs(edges.left - title.x)).toBeLessThan(1);
    expect(Math.abs(edges.right - (tools.x + tools.width))).toBeLessThan(1);
  });

  test('keeps the language switch and the bell on the first header row at 768 px', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ height: 1024, width: 768 });
    await stubFailedAdmin(page);
    await page.goto('/app/admin');
    const tools = header(page).locator('.tools');
    await expect(tools.locator('mf-bell')).toBeVisible();

    const title = await box(header(page).locator('.title'));
    const filters = await box(header(page).locator('mf-admin-filters'));
    const toolsBox = await box(tools);
    // Beside the title, right of the filters, never wrapped under them.
    expect(toolsBox.x).toBeGreaterThanOrEqual(filters.x + filters.width - 1);
    expect(toolsBox.x).toBeGreaterThanOrEqual(title.x + title.width - 1);
    expect(toolsBox.y).toBeLessThan(title.y + title.height);
  });
});

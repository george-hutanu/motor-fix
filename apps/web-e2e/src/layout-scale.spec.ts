import { expect, type Locator, type Page } from '@playwright/test';

import { test } from './fixtures.js';

// The layout rules the PR tester measures (ST-953): text on the Cockpit type
// scale, phone text that is read or tapped at 16 px or more, and padding and
// gaps on the 4 px grid.
const SCALE = [12, 13, 16, 20, 24, 32, 40];

interface Measured {
  label: string;
  size: number;
  spacing: number[];
}

const measure = (locator: Locator) =>
  locator.evaluateAll((all) =>
    all.map((el): Measured => {
      const style = getComputedStyle(el);
      const px = (value: string) =>
        value === 'normal' ? 0 : Number.parseFloat(value);
      const laidOut = /flex|grid/.test(style.display);
      return {
        label: `${el.tagName.toLowerCase()}.${el.className} "${el.textContent?.trim()}"`,
        size: px(style.fontSize),
        spacing: [
          style.paddingTop,
          style.paddingRight,
          style.paddingBottom,
          style.paddingLeft,
          ...(laidOut ? [style.rowGap, style.columnGap] : []),
        ].map(px),
      };
    }),
  );

const offGrid = (all: Measured[]) =>
  all
    .filter((m) => m.spacing.some((v) => v % 4 !== 0))
    .map((m) => `${m.label}: ${m.spacing.join(' ')}`);
const under16 = (all: Measured[]) =>
  all.filter((m) => m.size < 16).map((m) => `${m.label}: ${m.size}px`);
const offScale = (all: Measured[]) =>
  all
    .filter((m) => !SCALE.includes(m.size))
    .map((m) => `${m.label}: ${m.size}px`);

async function stubAdmin(page: Page) {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ json: { accessToken: 'stubbed' } }),
  );
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        capabilities: ['admin.garages', 'admin.settings'],
        email: 'admin@example.ro',
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
    route.fulfill({
      json: {
        activeDrivers: 12480,
        activeDriversMonthStart: 12168,
        garagesApprovedThisMonth: 9,
        garagesListed: 214,
        garagesWaiting: 2,
      },
    }),
  );
  await page.route('**/api/v1/admin/growth', (route) =>
    route.fulfill({
      json: {
        months: [
          { activeDrivers: 12168, garagesListed: 205, month: '2026-09' },
          { activeDrivers: 12480, garagesListed: 214, month: '2026-10' },
        ],
      },
    }),
  );
}

async function openAdmin(page: Page, width: number) {
  await page.setViewportSize({ height: 800, width });
  await stubAdmin(page);
  await page.goto('/app/admin');
  await expect(page.locator('mf-admin-panel .number').first()).toBeVisible();
  await expect(page.locator('mf-admin-growth .range').first()).toBeVisible();
}

test.describe('the type scale and the 4 px grid', () => {
  test('the language switch reads at 16 px on the grid on a 390 px phone', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto('/ro');
    const buttons = await measure(page.locator('mf-language-switch button'));

    expect(buttons.length).toBeGreaterThan(0);
    expect(under16(buttons)).toEqual([]);
    expect(offGrid(buttons)).toEqual([]);
  });

  test('the public tab bar sits on the grid on a 390 px phone', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto('/ro');
    const bar = page.locator('mf-public-tab-bar');

    expect(offGrid(await measure(bar.locator('nav, nav > a')))).toEqual([]);
  });

  test('the admin frame reads at 16 px on the grid on a 390 px phone', async ({
    page,
  }) => {
    await openAdmin(page, 390);

    const read = await measure(
      page.locator('.account > button, .admin-line, mf-admin-growth .range'),
    );
    expect(read.length).toBeGreaterThanOrEqual(4);
    expect(under16(read)).toEqual([]);
    expect(offGrid(read.filter((m) => m.label.startsWith('button')))).toEqual(
      [],
    );
    const bar = page.locator('mf-dashboard-tab-bar');
    expect(
      offGrid(await measure(bar.locator('nav, nav > a, .name, .chip'))),
    ).toEqual([]);
  });

  test('the admin figures keep to the type scale on a 320 px phone', async ({
    page,
  }) => {
    await openAdmin(page, 320);

    expect(
      offScale(
        await measure(
          page.locator('mf-admin-panel .number, mf-admin-growth .latest'),
        ),
      ),
    ).toEqual([]);
  });

  test('the admin menu chip sits on the grid on a desktop', async ({
    page,
  }) => {
    await openAdmin(page, 1280);
    const chip = page.locator('aside nav .chip');

    await expect(chip).toBeVisible();
    expect(offGrid(await measure(chip))).toEqual([]);
  });
});

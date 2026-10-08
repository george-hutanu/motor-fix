import { expect, type Page } from '@playwright/test';

import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

const OWNER = [
  'garage.requests',
  'garage.schedule',
  'garage.final_price',
  'garage.own_jobs',
  'garage.reviews',
  'garage.team',
  'garage.prices',
  'garage.profile',
  'garage.feature_switches',
  'garage.audit_history',
];

// The capabilities "who am I" gives each seeded role (libs/domain/src/auth/capabilities.ts).
const DASHBOARDS = [
  {
    capabilities: [
      'driver.requests',
      'driver.cars',
      'driver.reviews',
      'driver.saved_garages',
      'driver.settings',
    ],
    landing: '/app/driver',
    name: 'Panou șofer',
    role: 'driver',
    tabs: [
      ['Panou', ''],
      ['Cereri', '/requests'],
      ['Mașini', '/cars'],
      ['Recenzii', '/reviews'],
      ['Salvate', '/saved'],
      ['Setări', '/settings'],
    ],
  },
  {
    capabilities: OWNER,
    landing: '/app/garage',
    name: 'Panou service',
    role: 'garage',
    tabs: [
      ['Panou', ''],
      ['Cereri', '/requests'],
      ['Program', '/schedule'],
      ['Mecanici', '/team'],
      ['Prețuri', '/prices'],
      ['Recenzii', '/reviews'],
      ['Profil', '/profile'],
      ['Setări', '/settings'],
      ['Istoric', '/history'],
    ],
  },
  {
    capabilities: [
      'garage.requests',
      'garage.schedule',
      'garage.final_price',
      'garage.own_jobs',
    ],
    landing: '/app/garage',
    name: 'Panou service',
    role: 'receptionist',
    tabs: [
      ['Panou', ''],
      ['Cereri', '/requests'],
      ['Program', '/schedule'],
      ['Setări', '/settings'],
    ],
  },
  {
    capabilities: ['garage.own_jobs', 'garage.requests'],
    landing: '/app/garage',
    name: 'Panou service',
    role: 'mechanic',
    tabs: [
      ['Panou', ''],
      ['Cereri', '/requests'],
      ['Setări', '/settings'],
    ],
  },
  {
    capabilities: [
      'admin.garages',
      'admin.users',
      'admin.reviews',
      'admin.catalogue',
      'admin.settings',
    ],
    landing: '/app/admin',
    name: 'Panou admin',
    role: 'admin',
    tabs: [
      ['Panou', ''],
      ['Service‑uri', '/garages'],
      ['Setări', '/settings'],
    ],
  },
] as const;

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth);

// @traces 097-FR-001
test.describe('the dashboard tab bar on a 375 px phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ height: 812, width: 375 });
  });

  for (const { capabilities, landing, name, role, tabs } of DASHBOARDS) {
    test(`takes a ${role} to every view of the dashboard`, async ({ page }) => {
      await signInAs(page, role, landing, [...capabilities]);
      await open(page, landing);
      const bar = page.getByRole('navigation', { name });

      await expect(
        page.getByRole('navigation', { name: 'Meniu' }),
      ).toBeHidden();
      await expect(bar.getByRole('link')).toHaveText(tabs.map(([tab]) => tab));
      for (const [tab, path] of tabs) {
        await bar.getByRole('link', { exact: true, name: tab }).click();
        await expect(page).toHaveURL(`${landing}${path}`);
        await expect(
          bar.getByRole('link', { exact: true, name: tab }),
        ).toHaveAttribute('aria-current', 'page');
        await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
        expect(await sideways(page)).toBeLessThanOrEqual(375);
      }
    });
  }

  test('keeps the name and "Ieși din cont" reachable without the side menu', async ({
    page,
  }) => {
    await signInAs(page, 'driver', '/app/driver', ['driver.cars']);
    await open(page, '/app/driver');

    await expect(page.getByText('Test driver')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Ieși din cont' }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Limba' })).toBeVisible();
  });
});

test.describe('the side menu and the bar', () => {
  test('swap at 768 px and list the same views', async ({ page }) => {
    await signInAs(page, 'garage', '/app/garage', OWNER);
    await page.setViewportSize({ height: 1024, width: 768 });
    await open(page, '/app/garage');

    const menu = page.getByRole('navigation', { name: 'Meniu' });
    await expect(menu).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Panou service' }),
    ).toBeHidden();
    const hrefs = await menu
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(
      DASHBOARDS[1].tabs.map(([, path]) => `/app/garage${path}`),
    );

    await page.setViewportSize({ height: 812, width: 767 });
    await expect(menu).toBeHidden();
    const bar = page.getByRole('navigation', { name: 'Panou service' });
    await expect(bar).toBeVisible();
    expect(
      await bar
        .getByRole('link')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
    ).toEqual(hrefs);
  });

  test('send a receptionist who types the team address to the dashboard', async ({
    page,
  }) => {
    await signInAs(page, 'receptionist', '/app/garage', [
      'garage.requests',
      'garage.schedule',
    ]);

    await open(page, '/app/garage/team');

    await expect(page).toHaveURL('/app/garage');
  });

  test('send an unknown view address to the dashboard', async ({ page }) => {
    await signInAs(page, 'driver', '/app/driver', ['driver.cars']);

    await open(page, '/app/driver/nope');

    await expect(page).toHaveURL('/app/driver');
  });
});

test.describe('the bar on the smallest phones', () => {
  for (const width of [320, 390]) {
    test(`shows whole labels and scrolls itself, not the page, at ${width} px`, async ({
      page,
    }) => {
      await signInAs(page, 'garage', '/app/garage', OWNER);
      await page.setViewportSize({ height: 640, width });
      await open(page, '/app/garage/profile');
      const bar = page.getByRole('navigation', { name: 'Panou service' });

      expect(await sideways(page)).toBeLessThanOrEqual(width);
      const tabs = await bar.getByRole('link').evaluateAll((links) =>
        links.map((a) => {
          const label = a.lastElementChild as HTMLElement;
          return {
            cut: label.scrollWidth > label.clientWidth,
            height: a.getBoundingClientRect().height,
            size: Number.parseFloat(getComputedStyle(label).fontSize),
          };
        }),
      );
      expect(tabs).toHaveLength(9);
      expect(tabs.filter((t) => t.cut)).toEqual([]);
      expect(tabs.filter((t) => t.height < 44)).toEqual([]);
      expect(tabs.filter((t) => t.size < 12)).toEqual([]);
      const scroller = await bar.evaluate((nav) => ({
        client: nav.clientWidth,
        scroll: nav.scrollWidth,
      }));
      expect(scroller.scroll).toBeGreaterThan(scroller.client);
      await expect(
        bar.getByRole('link', { exact: true, name: 'Profil' }),
      ).toBeInViewport();
    });
  }

  test('sits above the home indicator', async ({ page }) => {
    await signInAs(page, 'driver', '/app/driver', ['driver.cars']);
    await page.setViewportSize({ height: 812, width: 375 });
    await open(page, '/app/driver');

    const padding = await page
      .getByRole('navigation', { name: 'Panou șofer' })
      .evaluate((nav) =>
        Number.parseFloat(getComputedStyle(nav).paddingBottom),
      );
    expect(padding).toBeGreaterThanOrEqual(14);
  });
});

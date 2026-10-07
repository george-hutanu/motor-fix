import { expect, type Page, test } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';

const ADMIN_CAPABILITIES = [
  'admin.garages',
  'admin.users',
  'admin.reviews',
  'admin.catalogue',
  'admin.settings',
  'admin.audit_history',
];

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signInAsAdmin(page: Page) {
  await ready(page, '/ro/garages');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
}

test.describe('the admin dashboard @seeded', () => {
  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`shows the seeded admin the garages waiting on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await signInAsAdmin(page);

      await expect(
        page.getByText(
          'MotorFix · București · 2 service‑uri așteaptă verificarea',
        ),
      ).toBeVisible();
      await expect(
        page.getByText('ADMINISTRATOR', { exact: true }),
      ).toBeVisible();
      const menu =
        width < 768
          ? page.locator('mf-dashboard-tab-bar')
          : page.getByRole('navigation', { name: 'Meniu' });
      await expect(
        menu.getByRole('link', { name: 'Service‑uri, 2 în așteptare' }),
      ).toBeVisible();
      await expect(menu.getByRole('link', { name: /Utilizatori/ })).toHaveCount(
        0,
      );
    });
  }

  test('keeps the header line on screen without sideways scroll at 320 px', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await signInAsAdmin(page);

    await expect(
      page.getByText(/2 service‑uri așteaptă verificarea/),
    ).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('sends a driver who types the admin address to their own dashboard', async ({
    page,
  }) => {
    await ready(page, '/ro/garages');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');

    await page.goto('/app/admin');

    await expect(page).toHaveURL('/app/driver');
  });

  test('sends a visitor who types the admin address home, with the sign-in dialog', async ({
    page,
  }) => {
    await page.goto('/app/admin');

    await expect(page).toHaveURL(/\/ro\/?$/);
    await expect(
      page
        .getByRole('dialog', { name: 'Autentificare' })
        .locator('mf-overlay-panel'),
    ).toBeVisible();
  });
});

test.describe('the admin dashboard in English', () => {
  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`reads the garages waiting in English on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await page.route('**/api/v1/auth/refresh', (route) =>
        route.fulfill({ json: { accessToken: 'stubbed' } }),
      );
      await page.route('**/api/v1/me', (route) =>
        route.fulfill({
          json: {
            capabilities: ADMIN_CAPABILITIES,
            email: ACCOUNTS.admin,
            garageId: null,
            id: 'admin-1',
            landing: '/app/admin',
            language: 'en',
            name: 'Admin MotorFix',
            role: 'admin',
            roles: ['admin'],
          },
        }),
      );
      await page.route('**/api/v1/admin/overview', (route) =>
        route.fulfill({ json: { garagesWaiting: 2 } }),
      );

      await page.goto('/app/admin');

      await expect(
        page.getByText(
          'MotorFix · Bucharest · 2 garages are waiting for verification',
        ),
      ).toBeVisible();
      await expect(
        page.getByText('ADMINISTRATOR', { exact: true }),
      ).toBeVisible();
      const menu =
        width < 768
          ? page.locator('mf-dashboard-tab-bar')
          : page.getByRole('navigation', { name: 'Menu' });
      await expect(
        menu.getByRole('link', { name: 'Garages, 2 waiting' }),
      ).toBeVisible();
    });
  }
});

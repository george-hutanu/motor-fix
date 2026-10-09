import { expect, type Page } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const PANELS = [
  {
    capabilities: ['driver.settings'],
    landing: '/app/driver',
    path: '/app/driver/settings',
    role: 'driver',
  },
  {
    capabilities: ['admin.settings'],
    landing: '/app/admin',
    path: '/app/admin/settings',
    role: 'admin',
  },
  {
    capabilities: ['garage.requests'],
    landing: '/app/garage',
    path: '/app/garage/settings',
    role: 'garage',
  },
];

for (const { capabilities, landing, path, role } of PANELS) {
  test.describe(`the notifications panel of the ${role} dashboard`, () => {
    for (const width of [320, 390]) {
      test(`shows its state and fits a ${width} px phone`, async ({ page }) => {
        await page.setViewportSize({ height: 800, width });
        await signInAs(page, role, landing, capabilities);
        // The server has no keys: push is not available yet, and nothing asks
        // the browser for permission.
        await page.route('**/api/v1/push-subscriptions/key', (route) =>
          route.fulfill({ json: { publicKey: null } }),
        );
        await page.goto(path);
        await settled(page);
        await expect(
          page.getByRole('heading', { name: 'Notificări pe acest dispozitiv' }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: /Activează/ }),
        ).toHaveCount(0);
        expect(await noSideScroll(page)).toBe(true);
      });
    }
  });
}

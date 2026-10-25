import { expect } from '@playwright/test';

import { hydrated } from './accounts.js';
import { test } from './fixtures.js';

// @traces 1204-FR-011
test.describe('the legal pages', () => {
  for (const [path, title, version] of [
    ['/ro/terms', 'Termeni de utilizare · MotorFix', 'Versiunea'],
    [
      '/ro/privacy',
      'Nota de informare privind datele personale · MotorFix',
      'Versiunea',
    ],
    ['/en/terms', 'Terms of use · MotorFix', 'Version'],
    ['/en/privacy', 'Privacy notice · MotorFix', 'Version'],
  ] as const) {
    test(`${path} names the page in its language`, async ({ page }) => {
      await hydrated(page, path);

      await expect(page).toHaveTitle(title);
      await expect(page.locator('article .meta')).toContainText(
        new RegExp(`^${version} \\d{4}-\\d{2}-\\d{2}$`),
      );
    });
  }
});

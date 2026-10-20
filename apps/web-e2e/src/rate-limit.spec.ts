import { expect, type Page } from '@playwright/test';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

// The API refuses the sign-in past its limit; the browser never trips a
// real one here.
async function refusedPastTheLimit(page: Page) {
  const calls: string[] = [];
  await page.route('**/api/v1/auth/sign-in', (route) => {
    calls.push(route.request().url());
    return route.fulfill({
      headers: { 'Retry-After': '60' },
      json: { code: 'rate_limited', retryAfterSeconds: 60, status: 429 },
      status: 429,
    });
  });
  return calls;
}

// @traces 1181-FR-006
// @traces 1181-FR-007
test.describe('a refusal past a limit', () => {
  for (const [path, open, name, email, password, button, message] of [
    [
      '/ro',
      'Autentificare',
      'Autentificare',
      'E‑mail',
      'Parolă',
      'Intră în cont',
      'Prea multe încercări. Încearcă din nou peste aproximativ un minut.',
    ],
    [
      '/en',
      'Sign in',
      'Sign in',
      'E-mail',
      'Password',
      'Sign in',
      'Too many attempts. Try again in about 1 minute.',
    ],
  ] as const) {
    test(`shows the calm message at ${path}, keeps what was typed and sends nothing again`, async ({
      page,
    }) => {
      const calls = await refusedPastTheLimit(page);
      await ready(page, path);
      await page
        .getByRole('banner')
        .getByRole('button', { exact: true, name: open })
        .click();
      const dialog = page.getByRole('dialog', { name });
      await expect(dialog.locator('mf-overlay-panel')).toBeVisible();

      await dialog.getByLabel(email).fill('andrei@example.ro');
      await dialog.getByLabel(password).fill('parola-de-test');
      await dialog.getByRole('button', { name: button }).click();

      await expect(dialog.getByRole('alert')).toHaveText(message);
      await expect(dialog.getByLabel(email)).toHaveValue('andrei@example.ro');
      // Nothing retries on its own in the time a retry would take.
      await page.waitForTimeout(1500);
      expect(calls).toHaveLength(1);
    });
  }
});

import { expect, type Page } from '@playwright/test';

import { test } from './fixtures.js';

const driver = {
  capabilities: [],
  email: 'andrei@example.ro',
  garageId: null,
  id: 'driver-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei',
  role: 'driver',
  roles: ['driver'],
};

const refused = {
  json: { code: 'sign_in_required', status: 401 },
  status: 401,
};

// A signed-in dashboard whose session the server then stops accepting: the
// first renewal succeeds (the page load), every later one is refused, and the
// first language save is refused. Each save that gets through is recorded with
// the token it carried.
async function sessionEndsWhileWorking(page: Page) {
  const saves: (string | undefined)[] = [];
  let renewals = 0;
  let refusedSaves = 0;
  await page.route('**/api/v1/auth/refresh', (route) =>
    renewals++ === 0
      ? route.fulfill({ json: { accessToken: 'before' } })
      : route.fulfill(refused),
  );
  // The stubbed token means nothing to the real stream, which would refuse it
  // and renew on its own; this test is about the save.
  await page.route('**/api/v1/live', (route) => route.abort());
  // The bell counts on load with the stubbed token; only the save may be refused.
  await page.route('**/api/v1/notifications/unread-count', (route) =>
    route.fulfill({ json: { count: 0 } }),
  );
  await page.route('**/api/v1/auth/sign-in', (route) =>
    route.fulfill({ json: { accessToken: 'after-sign-in' } }),
  );
  await page.route('**/api/v1/me', async (route) => {
    const req = route.request();
    if (req.method() !== 'PATCH') return route.fulfill({ json: driver });
    if (refusedSaves++ === 0) return route.fulfill(refused);
    saves.push(req.headers()['authorization']);
    return route.fulfill({ json: { ...driver, language: 'en' } });
  });
  return saves;
}

async function tapEnglish(page: Page) {
  await page.goto('/app/driver');
  await expect(
    page.getByRole('button', { name: 'Ieși din cont' }),
  ).toBeVisible();
  await page
    .getByRole('group', { name: 'Limba' })
    .getByRole('button', { name: 'EN' })
    .click();
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Sign in' });
// On a phone the dialog opens as a sheet; its container has no box.
const panel = (page: Page) => dialog(page).locator('mf-overlay-panel');

test.describe('the sign-in gate', () => {
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [1280, 800],
  ] as const) {
    test(`at ${width} px a refused account call asks to sign in over the screen, then goes on`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      const saves = await sessionEndsWhileWorking(page);

      await tapEnglish(page);

      await expect(panel(page)).toBeVisible();
      await expect(dialog(page)).toContainText('Sign in to continue.');
      await expect(page).toHaveURL('/app/driver');
      const scroll = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scroll).toBeLessThanOrEqual(width);

      await dialog(page).getByLabel('E-mail').fill(driver.email);
      await dialog(page).getByLabel('Password').fill('parola-de-test');
      await dialog(page).getByRole('button', { name: 'Sign in' }).click();

      await expect(panel(page)).toBeHidden();
      await expect(page).toHaveURL('/app/driver');
      await expect.poll(() => saves).toEqual(['Bearer after-sign-in']);
      // The account's old language comes back with the sign-in; the save wins.
      await expect(
        page
          .getByRole('group', { name: 'Language' })
          .getByRole('button', { name: 'EN' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });
  }

  test('closing the dialog keeps the screen and sends nothing more', async ({
    page,
  }) => {
    const saves = await sessionEndsWhileWorking(page);

    await tapEnglish(page);
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(panel(page)).toBeHidden();
    await expect(page).toHaveURL('/app/driver');
    await page.waitForLoadState('networkidle');
    expect(saves).toEqual([]);
  });
});

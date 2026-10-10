import { expect, type Page } from '@playwright/test';

import { test } from './fixtures.js';

// ST-536 FR-001: behind the gate dialog a failed renewal opened, the frame
// keeps the account it showed; closing the dialog lets it go, and a sign-in
// shows the account the sign-in loaded. The session is stubbed as in
// sign-in-gate.spec.ts: the page load renews, every later renewal is refused.
const driver = {
  capabilities: ['driver.requests', 'driver.cars', 'driver.reviews'],
  email: 'andrei@example.ro',
  garageAccess: [],
  garageId: null,
  id: 'driver-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei Marin',
  role: 'driver',
  roles: ['driver', 'garage'],
};
const loaded = { ...driver, id: 'driver-2', name: 'Ioana Pop' };

const refused = {
  json: { code: 'sign_in_required', status: 401 },
  status: 401,
};

async function sessionEndsWhileWorking(page: Page) {
  let renewals = 0;
  let signedIn = false;
  let refusedSaves = 0;
  await page.route('**/api/v1/auth/refresh', (route) =>
    renewals++ === 0
      ? route.fulfill({ json: { accessToken: 'before' } })
      : route.fulfill(refused),
  );
  await page.route('**/api/v1/live', (route) => route.abort());
  // A production build reads the push key on load (the service worker is
  // off in dev): answer it here, or the real API refuses the stubbed token.
  await page.route('**/api/v1/push-subscriptions/key', (route) =>
    route.fulfill({ json: { publicKey: null } }),
  );
  await page.route('**/api/v1/notifications/unread-count', (route) =>
    route.fulfill({ json: { count: 0 } }),
  );
  // Panou lists the cars and requests on load: an empty list for each.
  await page.route(/\/api\/v1\/(cars|requests)(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route('**/api/v1/auth/sign-in', (route) => {
    signedIn = true;
    return route.fulfill({ json: { accessToken: 'after-sign-in' } });
  });
  await page.route('**/api/v1/me', (route) => {
    const me = signedIn ? loaded : driver;
    if (route.request().method() !== 'PATCH')
      return route.fulfill({ json: me });
    if (refusedSaves++ === 0) return route.fulfill(refused);
    return route.fulfill({ json: { ...me, language: 'en' } });
  });
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Sign in' });
const panel = (page: Page) => dialog(page).locator('mf-overlay-panel');
const menu = (page: Page) =>
  page.locator('a[href^="/app/driver/"]:visible').count();

async function openGate(page: Page) {
  await sessionEndsWhileWorking(page);
  await page.goto('/app/driver');
  await expect(
    page.getByRole('button', { name: 'Ieși din cont' }),
  ).toBeVisible();
  const before = await menu(page);
  expect(before).toBeGreaterThanOrEqual(3);
  await page
    .getByRole('group', { name: 'Limba' })
    .getByRole('button', { name: 'EN' })
    .click();
  await expect(panel(page)).toBeVisible();
  return before;
}

test.describe('the frame behind the sign-in gate', () => {
  for (const [width, height] of [
    [390, 844],
    [1280, 800],
  ] as const) {
    test(`at ${width} px keeps the account while the dialog is open, then shows the one the sign-in loaded`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      const before = await openGate(page);

      expect(await menu(page)).toBe(before);
      if (width >= 768)
        await expect(page.getByText('Andrei Marin')).toBeVisible();

      await dialog(page).getByLabel('E-mail').fill(loaded.email);
      await dialog(page).getByLabel('Password').fill('parola-de-test');
      await dialog(page).getByRole('button', { name: 'Sign in' }).click();

      await expect(panel(page)).toBeHidden();
      if (width >= 768) {
        await expect(page.getByText('Ioana Pop')).toBeVisible();
        await expect(page.getByText('Andrei Marin')).toHaveCount(0);
      }
      expect(await menu(page)).toBe(before);
    });
  }

  test('lets the kept account go when the dialog closes without a sign-in', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    const before = await openGate(page);
    await expect(page.getByText('Andrei Marin')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(panel(page)).toBeHidden();
    await expect(page.getByText('Andrei Marin')).toHaveCount(0);
    await expect.poll(() => menu(page)).toBeLessThan(before);
  });
});

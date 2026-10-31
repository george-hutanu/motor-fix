import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';

import {
  ACCOUNTS,
  headers,
  openSignIn,
  PASSWORD,
  ready,
  signIn,
} from './accounts.js';
import { test } from './fixtures.js';

// @traces 003-FR-008 003-FR-017 003-FR-018 003-FR-023

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// A driver of the test's own, so suspending it never touches a seeded account
// another spec signs in with; newest first puts it on the list's first page.
async function freshDriver(request: APIRequestContext) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = `Cont Suspendat ${tag}`;
  const email = `suspend-${tag}@example.test`;
  const res = await request.post('/api/v1/auth/sign-up', {
    data: {
      consent: CURRENT_CONSENT,
      email,
      language: 'ro',
      name,
      password: PASSWORD,
    },
    headers: {
      'x-forwarded-for': `198.18.${Math.floor(Math.random() * 250)}.${Date.now() % 250}`,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { email, name };
}

async function signInAsAdmin(page: Page) {
  await ready(page, '/ro/garages');
  await openSignIn(page);
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
}

const drawer = (page: Page) => page.getByRole('dialog', { name: 'Detalii' });

test.describe('the account drawer @seeded', () => {
  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`suspends a driver, who cannot sign in, then restores them on ${device}`, async ({
      browser,
      page,
      request,
    }) => {
      const driver = await freshDriver(request);
      await page.setViewportSize({ height, width });
      await signInAsAdmin(page);
      await page.goto('/app/admin/users');

      await page
        .getByRole('button', { name: `Deschide contul ${driver.name}` })
        .click();
      await expect(page).toHaveURL(/\/app\/admin\/users\/[0-9a-f-]{36}$/);
      await expect(drawer(page).getByText(driver.email)).toBeVisible();

      // Reloaded at its address, the drawer opens again over the list.
      await page.reload();
      await expect(drawer(page).getByText(driver.email)).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      // Three steps: Suspendă, the reason, Suspendă.
      await drawer(page).getByRole('button', { name: 'Suspendă' }).click();
      const suspend = page.getByRole('dialog', { name: 'Suspendă contul' });
      await suspend
        .getByLabel('Motivul')
        .fill('Cereri false, repetate în ultima săptămână.');
      await suspend.getByRole('button', { name: 'Suspendă' }).click();
      await expect(drawer(page).locator('[data-part="said"]')).toHaveText(
        'Contul a fost suspendat',
        { timeout: 5000 },
      );
      await expect(drawer(page).locator('dd.reason')).toHaveText(
        'Cereri false, repetate în ultima săptămână.',
      );

      const context = await browser.newContext({ viewport: { height, width } });
      const person = await context.newPage();
      await ready(person, '/ro');
      await openSignIn(person);
      await signIn(person, driver.email);
      await expect(
        person
          .getByRole('dialog', { name: 'Autentificare' })
          .getByRole('alert'),
      ).toHaveText('Contul tău este suspendat. Scrie‑ne la suport.');

      await drawer(page).getByRole('button', { name: 'Reactivează' }).click();
      const restore = page.getByRole('dialog', { name: 'Reactivează contul' });
      await restore.getByRole('button', { name: 'Reactivează' }).click();
      await expect(drawer(page).locator('[data-part="said"]')).toHaveText(
        'Contul a fost reactivat',
        { timeout: 5000 },
      );

      // The refusal cleared the password: the form is filled again.
      await signIn(person, driver.email);
      await expect(person).toHaveURL(/\/app(\/|$)/);
      await context.close();
    });
  }

  test('keeps the search under the drawer and returns focus to its row', async ({
    page,
    request,
  }) => {
    const driver = await freshDriver(request);
    await signInAsAdmin(page);
    // Opened from a search: the list under the drawer must not change.
    const search = `/app/admin/users?q=${encodeURIComponent(driver.email)}`;
    await page.goto(search);

    const row = page.getByRole('button', {
      name: `Deschide contul ${driver.name}`,
    });
    await row.click();
    await expect(drawer(page).getByText(driver.email)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        ),
      )
      .toBe(true);

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeHidden();
    await expect(page).toHaveURL(/\/app\/admin\/users\?q=/);
    await expect(row).toBeFocused();
  });

  // The person's side in English; the admin's screens in English are the
  // drawer's and the dialogs' own specs.
  test('tells a suspended driver in English, then lets them back in', async ({
    page,
    request,
  }) => {
    const driver = await freshDriver(request);
    const auth = await headers(request, ACCOUNTS.admin);
    const found = await request.get('/api/v1/admin/accounts', {
      headers: auth,
      params: { q: driver.name },
    });
    const { items } = (await found.json()) as { items: { id: string }[] };
    const id = items[0]?.id;
    expect(id).toBeTruthy();
    const suspend = await request.post(`/api/v1/admin/accounts/${id}/suspend`, {
      data: { reason: 'Repeated false requests to garages.' },
      headers: auth,
    });
    expect(suspend.status()).toBe(200);

    await ready(page, '/en/garages');
    await openSignIn(page, 'en');
    const dialog = page.getByRole('dialog', { name: 'Sign in' });
    await dialog.getByLabel('E-mail').fill(driver.email);
    await dialog.getByLabel('Password').fill(PASSWORD);
    await dialog.getByRole('button', { exact: true, name: 'Sign in' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Your account is suspended. Write to support.',
    );

    const restore = await request.post(`/api/v1/admin/accounts/${id}/restore`, {
      data: {},
      headers: auth,
    });
    expect(restore.status()).toBe(200);
    await dialog.getByLabel('Password').fill(PASSWORD);
    await dialog.getByRole('button', { exact: true, name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/app(\/|$)/);
  });
});

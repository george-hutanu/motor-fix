import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';

async function accessToken(
  request: APIRequestContext,
  email: string,
  password = PASSWORD,
) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function accountId(request: APIRequestContext, email: string) {
  const res = await request.get('/api/v1/me', {
    headers: { Authorization: `Bearer ${await accessToken(request, email)}` },
  });
  return ((await res.json()) as { id: string }).id;
}

async function openDashboard(
  page: Page,
  email: string,
  landing: string,
  password = PASSWORD,
) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  const live = page.waitForResponse((r) => r.url().endsWith('/api/v1/live'));
  await signIn(page, email, { password });
  await expect(page).toHaveURL(landing);
  expect((await live).status()).toBe(200);
}

test.describe('the live connection @seeded', () => {
  test('a test update from an admin shows on the driver and the garage dashboards within 2 seconds, without a reload', async ({
    browser,
    request,
  }) => {
    const driverContext = await browser.newContext();
    const garageContext = await browser.newContext();
    const driver = await driverContext.newPage();
    const garage = await garageContext.newPage();
    await openDashboard(driver, ACCOUNTS.driver, '/app/driver');
    await openDashboard(garage, ACCOUNTS.garage, '/app/garage');
    let reloads = 0;
    for (const page of [driver, garage]) {
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) reloads++;
      });
    }
    const admin = await accessToken(request, ACCOUNTS.admin);

    for (const [page, email] of [
      [driver, ACCOUNTS.driver],
      [garage, ACCOUNTS.garage],
    ] as const) {
      const id = await accountId(request, email);
      const sent = await request.post('/api/v1/admin/live/test', {
        data: { accountId: id },
        headers: { Authorization: `Bearer ${admin}` },
      });
      expect(sent.status()).toBe(202);
      await expect(page.getByText('Actualizare de test în direct')).toBeVisible(
        {
          timeout: 2_000,
        },
      );
    }

    expect(reloads).toBe(0);
    await driverContext.close();
    await garageContext.close();
  });

  test('a test update changes the dashboard in place while an open dialog keeps the focus', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openDashboard(page, ACCOUNTS.driver, '/app/driver');
    let reloads = 0;
    // A document load, not a same-address history entry (an open task adds
    // one, so Back closes it).
    page.on('load', () => reloads++);
    await page
      .getByRole('button', { name: 'Ieși de pe toate dispozitivele' })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Ieși de pe toate dispozitivele?',
    });
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'Renunță' });
    await cancel.focus();
    const admin = await accessToken(request, ACCOUNTS.admin);

    const sent = await request.post('/api/v1/admin/live/test', {
      data: { accountId: await accountId(request, ACCOUNTS.driver) },
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(sent.status()).toBe(202);

    // The open modal hides the page behind it from the accessibility tree,
    // so the line is found by its role attribute, not by getByRole.
    await expect(
      page.locator('[role="status"]', {
        hasText: 'Actualizare de test în direct',
      }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(dialog).toBeVisible();
    await expect(cancel).toBeFocused();
    expect(reloads).toBe(0);
    await context.close();
  });

  test('a test update changes the dashboard in place while a half-filled form dialog keeps its text and focus', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openDashboard(page, ACCOUNTS.garage, '/app/garage');
    let reloads = 0;
    page.on('load', () => reloads++);
    // The dialog is a real invite form: nothing may send one.
    const invites: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/garages\/[^/]+\/invites$/.test(r.url()))
        invites.push(r.url());
    });
    await page.getByRole('button', { name: 'Invită în echipă' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invită în echipă' });
    await expect(dialog).toBeVisible();
    const name = dialog.getByLabel('Nume');
    await name.click();
    await name.pressSequentially('Elena Stan');
    await expect(name).toBeFocused();
    const admin = await accessToken(request, ACCOUNTS.admin);

    const sent = await request.post('/api/v1/admin/live/test', {
      data: { accountId: await accountId(request, ACCOUNTS.garage) },
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(sent.status()).toBe(202);

    await expect(
      page.locator('[role="status"]', {
        hasText: 'Actualizare de test în direct',
      }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Elena Stan');
    await expect(name).toBeFocused();
    expect(reloads).toBe(0);
    expect(invites).toEqual([]);
    await context.close();
  });

  test("a test update sent to one driver never shows on another driver's dashboard", async ({
    browser,
    request,
  }) => {
    const oneContext = await browser.newContext();
    const otherContext = await browser.newContext();
    const one = await oneContext.newPage();
    const other = await otherContext.newPage();
    await openDashboard(one, ACCOUNTS.driver, '/app/driver');
    await openDashboard(other, ACCOUNTS.otherDriver, '/app/driver');
    const admin = await accessToken(request, ACCOUNTS.admin);

    const sent = await request.post('/api/v1/admin/live/test', {
      data: { accountId: await accountId(request, ACCOUNTS.driver) },
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(sent.status()).toBe(202);
    await expect(one.getByText('Actualizare de test în direct')).toBeVisible({
      timeout: 2_000,
    });
    // The other dashboard has had the same time and more to receive it.
    await one.waitForTimeout(1_000);

    await expect(other.getByText('Actualizare de test în direct')).toHaveCount(
      0,
    );
    await oneContext.close();
    await otherContext.close();
  });

  test('after a minute without network the dashboard gets back in step within 5 seconds, and says so while it is out', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    // The test changes the account's language for most of a minute, and the
    // account's language wins at sign-in: on a seeded account, a flow signing
    // in beside it in another worker would land in English.
    const email = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = 'fara-retea-un-minut-2026';
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email,
        language: 'ro',
        name: 'Ioana Offline',
        password,
      },
      headers: { 'x-forwarded-for': `203.0.113.${Date.now() % 250}` },
    });
    expect(signUp.status()).toBe(201);
    const context = await browser.newContext();
    const page = await context.newPage();
    await openDashboard(page, email, '/app/driver', password);
    const token = await accessToken(request, email, password);
    const setLanguage = (language: 'ro' | 'en') =>
      request.patch('/api/v1/me', {
        data: { language },
        headers: { Authorization: `Bearer ${token}` },
      });
    const bar = page.locator('.live-offline');

    try {
      await context.setOffline(true);
      await expect(bar).toHaveText('Fără conexiune. Ce vezi poate fi vechi.', {
        timeout: 15_000,
      });
      // Changed elsewhere while this tab cannot hear about it.
      expect((await setLanguage('en')).ok()).toBe(true);
      await page.waitForTimeout(50_000);

      const live = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/live') && r.status() === 200,
        { timeout: 5_000 },
      );
      const me = page.waitForResponse(
        async (r) =>
          r.url().endsWith('/api/v1/me') &&
          r.request().method() === 'GET' &&
          r.ok() &&
          ((await r.json()) as { language: string }).language === 'en',
        { timeout: 5_000 },
      );
      await context.setOffline(false);

      await live;
      await me;
      await expect(bar).toHaveText('');
    } finally {
      await context.setOffline(false);
      await context.close();
    }
  });
});

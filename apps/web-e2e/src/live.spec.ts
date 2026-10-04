import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
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

async function openDashboard(page: Page, email: string, landing: string) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  const live = page.waitForResponse((r) => r.url().endsWith('/api/v1/live'));
  await signIn(page, email);
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
});

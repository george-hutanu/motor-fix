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

// The mechanic: no other suite sends this account messages.
test.describe('the notification bell @seeded', () => {
  test("an admin's test message shows on an open dashboard as a toast and a badge, and reading it clears the badge", async ({
    browser,
    request,
  }) => {
    const own = await accessToken(request, ACCOUNTS.mechanic);
    const headers = { Authorization: `Bearer ${own}` };
    expect(
      (
        await request.post('/api/v1/notifications/read-all', { headers })
      ).status(),
    ).toBe(204);
    const me = await request.get('/api/v1/me', { headers });
    const { id } = (await me.json()) as { id: string };

    const context = await browser.newContext();
    const page = await context.newPage();
    await openDashboard(page, ACCOUNTS.mechanic, '/app/garage');
    const bell = page.getByRole('button', { name: /^Notificări/ });
    await expect(bell).toHaveAccessibleName('Notificări');
    let reloads = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads++;
    });

    const admin = await accessToken(request, ACCOUNTS.admin);
    const sent = await request.post('/api/v1/admin/notifications/test', {
      data: { accountIds: [id] },
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(sent.status()).toBe(202);

    const text = 'Mesaj de test: notificările funcționează.';
    await expect(page.getByText(text)).toBeVisible({ timeout: 2_000 });
    await expect(bell).toHaveAccessibleName(
      'Notificări, o notificare necitită',
    );

    await bell.click();
    const list = page.getByRole('dialog', { name: 'Notificări' });
    await list
      .getByRole('button', { name: new RegExp(text) })
      .first()
      .click();

    await expect(bell).toHaveAccessibleName('Notificări');
    expect(reloads).toBe(0);
    await context.close();
  });
});

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const LIVE = /\/api\/v1\/live$/;

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

async function signedIn(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.driver);
  await expect(page).toHaveURL('/app/driver');
}

// @traces 1190-FR-007
// @traces 1190-FR-015
test.describe('one live stream for every tab of a browser @seeded', () => {
  test('two tabs share one stream, both show a test update, and the other tab takes over when the holder closes', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const streams: string[] = [];
    context.on('request', (r) => {
      if (LIVE.test(r.url())) streams.push(r.url());
    });
    const first = await context.newPage();
    await signedIn(first);
    await expect.poll(() => streams.length, { timeout: 5_000 }).toBe(1);

    const second = await context.newPage();
    await second.goto('/app/driver');
    await expect(second).toHaveURL('/app/driver');
    await second.waitForTimeout(1_500);
    expect(streams).toHaveLength(1);

    const admin = await accessToken(request, ACCOUNTS.admin);
    const sent = await request.post('/api/v1/admin/live/test', {
      data: { accountId: await accountId(request, ACCOUNTS.driver) },
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(sent.status()).toBe(202);
    for (const page of [first, second]) {
      await expect(page.getByText('Actualizare de test în direct')).toBeVisible(
        { timeout: 2_000 },
      );
    }

    await first.close();
    await expect.poll(() => streams.length, { timeout: 3_000 }).toBe(2);
    await context.close();
  });
});

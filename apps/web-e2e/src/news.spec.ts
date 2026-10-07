import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready } from './accounts.js';
import { test } from './fixtures.js';

// A link of the right shape whose signature MotorFix never made.
const FORGED =
  '0b9d6a52-6f3e-4d55-9a57-2f1a3c1b7e10.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test.describe('the stop-news page', () => {
  test('says a forged link is not valid, in Romanian and in English', async ({
    page,
  }) => {
    await ready(page, `/ro/unsubscribe/${FORGED}`);
    await expect(
      page.getByRole('heading', { name: 'Linkul nu este valid' }),
    ).toBeVisible();

    await ready(page, `/en/unsubscribe/${FORGED}`);
    await expect(
      page.getByRole('heading', { name: 'This link is not valid' }),
    ).toBeVisible();
  });

  for (const width of [320, 390]) {
    test(`fits a ${width} px phone`, async ({ page }) => {
      await page.setViewportSize({ height: 700, width });
      await ready(page, `/ro/unsubscribe/${FORGED}`);
      await expect(
        page.getByRole('heading', { name: 'Linkul nu este valid' }),
      ).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });
  }
});

test.describe('news consent @seeded', () => {
  test('a driver turns news on with the consent text version and off again', async ({
    request,
  }) => {
    const auth = {
      Authorization: `Bearer ${await accessToken(request, ACCOUNTS.driver)}`,
    };
    const before = await request.get('/api/v1/notification-preferences', {
      headers: auth,
    });
    const version = (
      (await before.json()) as { newsConsent: { currentTextVersion: string } }
    ).newsConsent.currentTextVersion;

    const refused = await request.put('/api/v1/notification-preferences', {
      data: { groups: [{ enabled: true, key: 'news' }] },
      headers: auth,
    });
    expect(refused.status()).toBe(422);

    const on = await request.put('/api/v1/notification-preferences', {
      data: {
        groups: [{ enabled: true, key: 'news' }],
        newsConsentTextVersion: version,
      },
      headers: auth,
    });
    expect(on.ok()).toBe(true);
    expect(
      ((await on.json()) as { newsConsent: { state: string } }).newsConsent
        .state,
    ).toBe('given');

    const off = await request.put('/api/v1/notification-preferences', {
      data: { groups: [{ enabled: false, key: 'news' }] },
      headers: auth,
    });
    expect(
      ((await off.json()) as { newsConsent: { state: string } }).newsConsent
        .state,
    ).toBe('withdrawn');
  });
});

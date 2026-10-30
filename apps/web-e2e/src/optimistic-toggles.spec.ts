import { expect, type Locator, type Page } from '@playwright/test';

import { ACCOUNTS, openSignIn, ready, settled, signIn } from './accounts.js';
import { test } from './fixtures.js';

// @traces 1315-optimistic-toggles-FR-010 1315-optimistic-toggles-FR-011

// What a press must show within, measured in the page from the pointer going
// down to the first change of the control, while the network is Slow 3G.
const WITHIN_MS = 100;
const FAILED_AFTER_MS = 1_000;

type Stamps = { pressedAt?: number; changedAt?: number };

// Chrome DevTools' Slow 3G: 400 ms latency, 500 kbit/s each way.
async function slow3g(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    downloadThroughput: 62_500,
    latency: 400,
    offline: false,
    uploadThroughput: 62_500,
  });
}

// Stamps the next pointer press and the first change under the node after it.
async function watch(node: Locator) {
  await node.evaluate((target) => {
    const stamps: Stamps = {};
    (window as unknown as { mfStamps: Stamps }).mfStamps = stamps;
    addEventListener(
      'pointerdown',
      () => {
        stamps.pressedAt ??= performance.now();
      },
      { capture: true, once: true },
    );
    const observer = new MutationObserver(() => {
      if (stamps.pressedAt === undefined) return;
      stamps.changedAt = performance.now();
      observer.disconnect();
    });
    observer.observe(target, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
}

async function shownWithin(page: Page) {
  const stamps = () =>
    page.evaluate(() => (window as unknown as { mfStamps: Stamps }).mfStamps);
  await expect.poll(async () => (await stamps()).changedAt).toBeDefined();
  const { changedAt = Number.POSITIVE_INFINITY, pressedAt = 0 } =
    await stamps();
  expect(changedAt - pressedAt).toBeLessThan(WITHIN_MS);
}

async function failLater(page: Page, url: string | RegExp, method: string) {
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, FAILED_AFTER_MS));
    await route.fulfill({ json: {}, status: 500 });
  });
}

async function signedIn(page: Page, email: string) {
  await ready(page, '/ro');
  await openSignIn(page);
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
}

const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]', { hasText: text });

test.describe('a toggle shows before the server answers @seeded', () => {
  test.skip(({ browserName }) => browserName !== 'chromium');

  test('a notification switch flips at once, then comes back with a message when the save fails', async ({
    page,
  }) => {
    await signedIn(page, ACCOUNTS.garage);
    await page.goto('/app/garage/settings');
    const push = page.getByRole('switch', {
      exact: true,
      name: 'Cerere de ofertă nouă, Push',
    });
    await expect(push).toBeVisible();
    const before = await push.getAttribute('aria-checked');
    await failLater(page, '**/api/v1/notification-preferences', 'PUT');
    await slow3g(page);
    await watch(push);

    await push.click();

    await shownWithin(page);
    await expect(toast(page, 'Setarea nu a putut fi salvată')).toBeVisible();
    await expect(push).toHaveAttribute('aria-checked', before ?? 'false');
  });

  test('a bell row reads at once, then is unread again with a message when the read fails', async ({
    page,
  }) => {
    const text = 'Mesaj de probă pentru citire';
    await page.route(
      (url) => url.pathname === '/api/v1/notifications',
      (route) =>
        route.fulfill({
          json: {
            items: [
              {
                at: new Date().toISOString(),
                id: 'optimistic-row',
                kind: 'TEST_MESSAGE',
                readAt: null,
                subjectId: null,
                text,
              },
            ],
            nextCursor: null,
          },
        }),
    );
    await page.route('**/api/v1/notifications/unread-count', (route) =>
      route.fulfill({ json: { count: 1 } }),
    );
    await failLater(page, '**/api/v1/notifications/*/read', 'POST');
    await signedIn(page, ACCOUNTS.garage);
    await page.getByRole('button', { name: /^Notificări/ }).click();
    const list = page.getByRole('dialog', { name: 'Notificări' });
    const row = list.locator('li', { hasText: text });
    await expect(row).toHaveClass(/unread/);
    await slow3g(page);
    await watch(row);

    await row.getByRole('button').click();

    await shownWithin(page);
    await expect(
      toast(page, 'Notificarea nu a putut fi marcată ca citită.'),
    ).toBeVisible();
    await expect(row).toHaveClass(/unread/);
  });

  test('a price-list job hides at once, then is back on the profile with a line saying so when the save fails', async ({
    page,
  }) => {
    await signedIn(page, 'militari@example.test');
    await page.goto('/app/garage/prices');
    const row = page.locator('[data-row]').filter({
      has: page.locator('[data-name]', {
        hasText: 'Diagnoză și citire coduri de eroare',
      }),
    });
    await expect(row).toBeVisible();
    await page
      .getByRole('button', { exact: true, name: 'Modifică prețurile' })
      .click();
    const state = row.locator('[data-state]');
    const before = await state.textContent();
    await failLater(page, '**/api/v1/garages/*/prices/*', 'PATCH');
    await slow3g(page);
    await watch(state);

    await row.getByRole('button', { exact: true, name: 'Ascunde' }).click();

    await shownWithin(page);
    await expect(row.getByRole('alert')).toHaveText(
      'Nu s‑a salvat. Încearcă din nou.',
    );
    await expect(state).toHaveText(before ?? '');
  });

  test('a brand tick on the listing form shows at once', async ({ page }) => {
    await page.goto('/ro/list-your-garage');
    await settled(page);
    const bmw = page
      .locator('mf-brands-step')
      .locator('.chips > li > button', { hasText: 'BMW' });
    await expect(bmw).toBeVisible();
    await slow3g(page);
    await watch(bmw);

    await bmw.click();

    await shownWithin(page);
    await expect(bmw).toHaveAttribute('aria-pressed', 'true');
  });
});

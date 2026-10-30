import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  ACCOUNTS,
  openSignIn,
  PASSWORD,
  ready,
  settled,
  signIn,
} from './accounts.js';
import { test } from './fixtures.js';

// @traces 1315-FR-010 1315-FR-011 1315-FR-015

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

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]', { hasText: text });

test.describe('a toggle shows before the server answers @seeded', () => {
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
    request,
  }) => {
    const own = await accessToken(request, ACCOUNTS.garage);
    const headers = { Authorization: `Bearer ${own}` };
    expect(
      (
        await request.post('/api/v1/notifications/read-all', { headers })
      ).status(),
    ).toBe(204);
    const { id } = (await (
      await request.get('/api/v1/me', { headers })
    ).json()) as { id: string };
    const admin = await accessToken(request, ACCOUNTS.admin);
    const sent = await request.post('/api/v1/admin/notifications/test', {
      data: { accountIds: [id] },
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(sent.status()).toBe(202);
    await failLater(page, '**/api/v1/notifications/*/read', 'POST');
    await signedIn(page, ACCOUNTS.garage);
    await page.getByRole('button', { name: /^Notificări/ }).click();
    const list = page.getByRole('dialog', { name: 'Notificări' });
    const row = list
      .locator('li', { hasText: 'Mesaj de test: notificările funcționează.' })
      .first();
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
    const job = 'Diagnoză și citire coduri de eroare';
    const row = page
      .locator('[data-row]')
      .filter({ has: page.locator('[data-name]', { hasText: job }) });
    await expect(row).toBeVisible();
    await page
      .getByRole('button', { exact: true, name: 'Modifică prețurile' })
      .click();
    await expect(
      page.getByRole('button', { exact: true, name: 'Gata' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const state = row.locator('[data-state]');
    const before = await state.textContent();
    await failLater(page, '**/api/v1/garages/*/prices/*', 'PATCH');
    await slow3g(page);
    await watch(state);

    await row
      .getByRole('button', { exact: true, name: `Ascunde ${job}` })
      .click();

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

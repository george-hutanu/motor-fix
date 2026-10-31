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

// Stamps the next pointer press and the first change the options name on the
// node after it: the one attribute or text that carries the optimistic state,
// never any change under the node.
async function watch(node: Locator, options: MutationObserverInit) {
  await node.evaluate((target, init) => {
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
    observer.observe(target, init);
  }, options);
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

// Holds every matching call until the test lets it fail, so what the screen
// shows before the server answers can be read without a race.
async function holdThenFail(page: Page, url: string | RegExp, method: string) {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    await released;
    await route.fulfill({ json: {}, status: 500 });
  });
  return release;
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

const TEST_MESSAGE = 'Mesaj de test: notificările funcționează.';

// The garage owner's bell with every row read, then `count` new test rows.
async function unread(request: APIRequestContext, count: number) {
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
  for (let sent = 0; sent < count; sent++) {
    const res = await request.post('/api/v1/admin/notifications/test', {
      data: { accountIds: [id] },
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(res.status()).toBe(202);
  }
}

const bell = (page: Page) => page.getByRole('button', { name: /^Notificări/ });
// By its element, not its role: an open bell list hides the page behind it,
// the bell too, from the accessibility tree.
const badge = (page: Page) => page.locator('mf-bell .badge');

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
    await watch(push, { attributeFilter: ['aria-checked'] });

    await push.click();

    await shownWithin(page);
    // @traces 1411-FR-003
    await expect(push).toHaveAttribute(
      'aria-checked',
      before === 'true' ? 'false' : 'true',
    );
    await expect(toast(page, 'Setarea nu a putut fi salvată')).toHaveCount(1);
    await expect(push).toHaveAttribute('aria-checked', before ?? 'false');
  });

  // @traces 1411-FR-003
  test('a bell row reads at once and the count drops before the answer, then both come back with one message when the read fails', async ({
    page,
    request,
  }) => {
    await unread(request, 3);
    const release = await holdThenFail(
      page,
      '**/api/v1/notifications/*/read',
      'POST',
    );
    await signedIn(page, ACCOUNTS.garage);
    await expect(badge(page)).toHaveText('3');
    await bell(page).click();
    const list = page.getByRole('dialog', { name: 'Notificări' });
    const row = list.locator('li', { hasText: TEST_MESSAGE }).first();
    await expect(row).toHaveClass(/unread/);
    await slow3g(page);
    await watch(row, { attributeFilter: ['class'] });

    await row.getByRole('button').click();

    await shownWithin(page);
    await expect(row).not.toHaveClass(/unread/);
    await expect(badge(page)).toHaveText('2');
    release();
    await expect(row).toHaveClass(/unread/);
    await expect(badge(page)).toHaveText('3');
    await expect(
      toast(page, 'Notificarea nu a putut fi marcată ca citită.'),
    ).toHaveCount(1);
  });

  // @traces 1411-FR-002 1411-FR-003
  test('mark all reads every row at once, then every row is unread again with one message when it is refused', async ({
    page,
    request,
  }) => {
    await unread(request, 3);
    const release = await holdThenFail(
      page,
      '**/api/v1/notifications/read-all',
      'POST',
    );
    await signedIn(page, ACCOUNTS.garage);
    await expect(badge(page)).toHaveText('3');
    await bell(page).click();
    const list = page.getByRole('dialog', { name: 'Notificări' });
    // Only this test's three are unread: earlier runs leave their rows, read.
    const unreadRows = list.locator('li.unread', { hasText: TEST_MESSAGE });
    await expect(unreadRows).toHaveCount(3);

    await list
      .getByRole('button', { exact: true, name: 'Marchează tot ca citit' })
      .click();

    await expect(list.locator('li.unread')).toHaveCount(0);
    await expect(badge(page)).toHaveCount(0);
    release();
    await expect(unreadRows).toHaveCount(3);
    await expect(badge(page)).toHaveText('3');
    await expect(
      toast(page, 'Notificarea nu a putut fi marcată ca citită.'),
    ).toHaveCount(1);
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
    const release = await holdThenFail(
      page,
      '**/api/v1/garages/*/prices/*',
      'PATCH',
    );
    await slow3g(page);
    await watch(state.locator('.said'), {
      characterData: true,
      childList: true,
      subtree: true,
    });

    await row
      .getByRole('button', { exact: true, name: `Ascunde ${job}` })
      .click();

    await shownWithin(page);
    // @traces 1411-FR-003
    await expect(state).toHaveText('ascuns de tine');
    for (const name of [`Modifică ${job}`, `Arată ${job}`, `Șterge ${job}`]) {
      await expect(
        row.getByRole('button', { exact: true, name }),
      ).toBeDisabled();
    }
    release();
    await expect(row.getByRole('alert')).toHaveText(
      'Nu s‑a salvat. Încearcă din nou.',
    );
    await expect(row.getByRole('alert')).toHaveCount(1);
    await expect(state).toHaveText(before ?? '');
  });

  // @traces 1411-FR-004 1411-FR-008
  test('a fuel tick on a brand already taken shows at once', async ({
    page,
  }) => {
    await page.goto('/ro/list-your-garage');
    await settled(page);
    const step = page.locator('mf-brands-step');
    const bmw = step.locator('.chips > li > button', { hasText: 'BMW' });
    await expect(bmw).toBeVisible();
    await bmw.click();
    await expect(bmw).toHaveAttribute('aria-pressed', 'true');
    const petrol = step.getByRole('button', { name: /^BMW, Benzină/ });
    await expect(petrol).toBeVisible();
    const before = await petrol.getAttribute('aria-pressed');
    await slow3g(page);
    await watch(petrol, { attributeFilter: ['aria-pressed'] });

    await petrol.click();

    await shownWithin(page);
    await expect(petrol).toHaveAttribute(
      'aria-pressed',
      before === 'true' ? 'false' : 'true',
    );
  });
});

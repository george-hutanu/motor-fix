import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const SETTINGS = '/app/garage/settings';
const OUTSIDE = ['email', 'push'] as const;
// The restore runs after a test has left the request's keep-alive socket idle
// for longer than the server keeps it, so a call can meet a reset socket
// (ECONNRESET); only that is retried, never an answer.
const RESET = { maxRetries: 2 };

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    ...RESET,
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

// The owner's quote requests go out by e-mail and push again, so the suite can
// run twice against the same database.
async function restore(request: APIRequestContext) {
  const headers = {
    Authorization: `Bearer ${await accessToken(request, ACCOUNTS.garage)}`,
  };
  const read = await request.get('/api/v1/notification-preferences', {
    ...RESET,
    headers,
  });
  const { staff } = (await read.json()) as {
    staff: { garageId: string | null; role: string }[];
  };
  const garageId = staff.find((entry) => entry.role === 'owner')?.garageId;
  const saved = await request.put('/api/v1/notification-preferences', {
    ...RESET,
    data: {
      preferences: OUTSIDE.map((channel) => ({
        channel,
        enabled: true,
        garageId,
        type: 'REQUEST_RECEIVED',
      })),
    },
    headers,
  });
  expect(saved.ok()).toBe(true);
}

const switchOf = (page: Page, channel: string) =>
  page.getByRole('switch', {
    exact: true,
    name: `Cerere de ofertă nouă, ${channel}`,
  });

async function openSettings(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.garage);
  await expect(page).toHaveURL('/app/garage');
  // The live stream stays open, so the page never goes network-idle.
  await page.goto(SETTINGS);
  await expect(switchOf(page, 'E‑mail')).toBeVisible();
}

test.describe("the garage owner's message choices @seeded", () => {
  // Both tests sign in as the owner and reset the same rows.
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ request }) => restore(request));
  test.afterEach(async ({ request }) => restore(request));

  test('keeps E‑mail and Push off for new quote requests after a reload, and explains the closed WhatsApp switch', async ({
    page,
  }) => {
    await openSettings(page);
    await expect(
      page.getByRole('heading', { exact: true, level: 2, name: 'Notificări' }),
    ).toBeVisible();

    for (const channel of ['E‑mail', 'Push']) {
      const toggle = switchOf(page, channel);
      await expect(toggle).toBeChecked();
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/v1/notification-preferences') &&
          r.request().method() === 'PUT',
      );
      await toggle.click();
      expect((await saved).ok()).toBe(true);
      await expect(toggle).not.toBeChecked();
    }

    await page.reload();
    await expect(switchOf(page, 'E‑mail')).not.toBeChecked();
    await expect(switchOf(page, 'Push')).not.toBeChecked();

    const whatsapp = switchOf(page, 'WhatsApp');
    await expect(whatsapp).toBeDisabled();
    await expect(whatsapp).not.toBeChecked();
    await expect(whatsapp).toHaveAccessibleDescription(
      'Adaugă un număr de telefon verificat',
    );
  });

  test('fits a 320 px phone without scrolling sideways', async ({ page }) => {
    // The header's sign-in button shows from the tablet width up.
    await openSettings(page);
    await page.setViewportSize({ height: 640, width: 320 });
    await expect(switchOf(page, 'E‑mail')).toBeVisible();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});

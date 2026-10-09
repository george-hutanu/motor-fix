import { expect, type Locator, type Page } from '@playwright/test';

import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

const UPDATE = `data: ${JSON.stringify({
  at: '2026-10-05T11:03:00.000Z',
  id: 'test-1',
  kind: 'live.test',
})}\n\n`;

// A confirmed e-mail keeps the e-mail banner out from between the header and
// the line. The first stream carries one test update; with `thenDrop` every
// later try fails, so the offline bar comes up under the header.
async function openWithUpdate(
  page: Page,
  { emailConfirmed = true, thenDrop = false } = {},
) {
  await signInAs(page, 'driver', '/app/driver');
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        capabilities: [],
        email: 'driver@example.ro',
        emailConfirmed,
        garageAccess: [],
        garageId: null,
        id: 'driver-1',
        landing: '/app/driver',
        language: 'ro',
        name: 'Test driver',
        role: 'driver',
        roles: ['driver'],
      },
    }),
  );
  let streams = 0;
  await page.route('**/api/v1/live', (route) => {
    streams++;
    if (thenDrop && streams > 1) return route.abort();
    return route.fulfill({
      body: UPDATE,
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  await page.goto('/app/driver');
  const line = page.locator('.live-status');
  await expect(line).toContainText('Actualizare de test în direct');
  return line;
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('not laid out');
  return found;
}

for (const [name, width, height] of [
  ['a 320 px phone', 320, 640],
  ['a 390 px phone', 390, 844],
  ['a tablet', 768, 1024],
  ['a desktop', 1280, 800],
] as const) {
  test(`on ${name}, the live status line keeps 8 px clear of the RO/EN switch and lines up with the header`, async ({
    page,
  }) => {
    await page.setViewportSize({ height, width });
    const line = await openWithUpdate(page);
    const header = await box(page.locator('.view > header'));
    const toggle = await box(page.locator('mf-language-switch'));
    const status = await box(line);

    expect(status.y - (toggle.y + toggle.height)).toBeGreaterThanOrEqual(8);
    expect(status.y - (header.y + header.height)).toBeGreaterThanOrEqual(8);
    expect(status.x).toBe(header.x);
    expect(
      await line.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.marginLeft, s.marginRight, s.paddingLeft, s.paddingRight];
      }),
    ).toEqual(['0px', '0px', '0px', '0px']);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("under the offline bar, the live status line adds its own 8 px to the bar's 12 px", async ({
  page,
}) => {
  await page.setViewportSize({ height: 640, width: 320 });
  const line = await openWithUpdate(page, { thenDrop: true });
  const bar = page.locator('.live-offline');
  await expect(bar).toHaveText('Fără conexiune. Ce vezi poate fi vechi.', {
    // OFFLINE_AFTER is 10 s; twice that.
    timeout: 20_000,
  });
  const offline = await box(bar);
  const status = await box(line);

  expect(status.y - (offline.y + offline.height)).toBeGreaterThanOrEqual(20);
  expect(status.x).toBe((await box(page.locator('.view > header'))).x);
});

test('under the e-mail banner, the live status line keeps 8 px clear of it', async ({
  page,
}) => {
  await page.setViewportSize({ height: 640, width: 320 });
  const line = await openWithUpdate(page, { emailConfirmed: false });
  const banner = await box(page.locator('mf-email-banner [role="status"]'));
  const status = await box(line);

  expect(status.y - (banner.y + banner.height)).toBeGreaterThanOrEqual(8);
});

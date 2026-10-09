import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, an approved garage that works on Dacia petrol cars.
const DRIVER = 'cerere@example.test';
const OWNER = 'militari@example.test';
const DESCRIPTION = 'Scârțâie roata din față la frânare';

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// The driver sends a request with no job, straight to the owner's garage.
async function send(request: APIRequestContext) {
  const owner = await accessToken(request, OWNER);
  const me = await request.get('/api/v1/me', { headers: bearer(owner) });
  const { garageId } = (await me.json()) as { garageId: string };
  const driver = await accessToken(request, DRIVER);
  const cars = await request.get('/api/v1/cars', { headers: bearer(driver) });
  const { items } = (await cars.json()) as {
    items: { id: string; model: string }[];
  };
  const car = items.find((item) => item.model === 'Logan') ?? items[0];
  const res = await request.post('/api/v1/quote-requests', {
    data: {
      carId: car.id,
      description: DESCRIPTION,
      garageIds: [garageId],
      jobTypeIds: [],
      sources: ['profile_direct'],
    },
    headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
  });
  expect(res.status()).toBe(201);
  return { id: ((await res.json()) as { id: string }).id, owner };
}

// What the server counts as waiting for the garage right now.
async function waiting(request: APIRequestContext, token: string) {
  const res = await request.get('/api/v1/garage/requests?status=waiting', {
    headers: bearer(token),
  });
  return ((await res.json()) as { total: number }).total;
}

async function signedIn(page: Page, email: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
}

const panel = (page: Page) => page.locator('mf-garage-requests-panel');
const entry = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Meniu' })
    .getByRole('link', { name: /^Cereri de ofertă/ });
const tab = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Panou service' })
    .getByRole('link', { name: /^Cereri/ });
const count = (label: string | null) =>
  Number(/, (\d+) în așteptare$/.exec(label ?? '')?.[1] ?? Number.NaN);

// @seeded: a driver's request reaches a signed-in garage without a reload.
test.describe('a garage’s quote requests, live @seeded', () => {
  // @traces 343-live-quote-requests-FR-001
  // @traces 343-live-quote-requests-FR-006
  // @traces 343-live-quote-requests-FR-007
  // @traces 343-live-quote-requests-FR-009
  // @traces 343-live-quote-requests-FR-010
  test('a new request reaches Panou, its counter, the menu and the bar within seconds, and Cereri de ofertă lists it', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, OWNER);
    await expect(
      panel(page).getByRole('heading', { name: 'Cereri de ofertă' }),
    ).toBeVisible();
    await expect(panel(page).locator('.counter')).toBeVisible();

    const { id, owner } = await send(request);

    const row = panel(page).locator(`[data-live-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });
    await expect(row).toContainText('Dacia Logan');
    await expect(row).toContainText(DESCRIPTION);
    await expect(
      page.getByText(`Cerere nouă: Dacia Logan · ${DESCRIPTION}`),
    ).toBeVisible({ timeout: 5_000 });
    // Other workers send to the same garage: the screen follows the server.
    await expect
      .poll(
        async () =>
          (await panel(page).locator('.counter').textContent())?.trim() ===
          `${await waiting(request, owner)} fără răspuns`,
        { timeout: 5_000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          count(await entry(page).getAttribute('aria-label')) ===
          (await waiting(request, owner)),
        { timeout: 5_000 },
      )
      .toBe(true);

    await entry(page).click();
    await expect(page).toHaveURL('/app/garage/requests');
    await expect(page.locator(`[data-live-id="${id}"]`)).toBeVisible();

    await page.setViewportSize({ height: 844, width: 390 });
    await expect
      .poll(
        async () =>
          count(await tab(page).getAttribute('aria-label')) ===
          (await waiting(request, owner)),
        { timeout: 5_000 },
      )
      .toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });

  // @traces 343-live-quote-requests-FR-015
  test('a mechanic who may not answer quotes sees no requests panel and no Cereri de ofertă', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, ACCOUNTS.mechanic);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Panou service',
    );
    await expect(
      page.getByRole('navigation', { name: 'Meniu' }).getByRole('link').first(),
    ).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(entry(page)).toHaveCount(0);
  });
});

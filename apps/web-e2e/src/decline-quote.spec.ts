import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver and the owner of Service Auto Militari, the one approved
// seeded garage with staff.
const DRIVER = 'cerere@example.test';
const MILITARI = 'militari@example.test';

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// One of the driver's requests for an oil service, quoted by Militari.
async function quoted(request: APIRequestContext) {
  const militari = await accessToken(request, MILITARI);
  const me = await request.get('/api/v1/me', { headers: bearer(militari) });
  const { garageId } = (await me.json()) as { garageId: string };
  const jobs = await request.get('/api/v1/job-types?keys=oil-service');
  const [oil] = ((await jobs.json()) as { items: { id: string }[] }).items;
  const driver = await accessToken(request, DRIVER);
  const cars = await request.get('/api/v1/cars', { headers: bearer(driver) });
  const { items } = (await cars.json()) as {
    items: { id: string; model: string }[];
  };
  const car = items.find((item) => item.model === 'Logan') ?? items[0];
  const sent = await request.post('/api/v1/quote-requests', {
    data: {
      carId: car.id,
      description: `Plăcuțe de frână ${randomUUID().slice(0, 8)}`,
      garageIds: [garageId],
      jobTypeIds: [oil.id],
      sources: ['profile_direct'],
    },
    headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
  });
  expect(sent.status()).toBe(201);
  const requestId = ((await sent.json()) as { id: string }).id;
  const quote = await request.post('/api/v1/quotes', {
    data: {
      durationMinutes: 60,
      fromLei: 300,
      requestId,
      slot: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      toLei: 400,
    },
    headers: { ...bearer(militari), 'Idempotency-Key': randomUUID() },
  });
  expect(quote.status()).toBe(201);
  return { quoteId: ((await quote.json()) as { id: string }).id, requestId };
}

async function signedIn(page: Page, email: string, landing: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL(landing);
}

// @seeded: the seeded driver declines Militari's quote.
test.describe('declining a quote @seeded', () => {
  // @traces 314-accept-quote-FR-010
  // @traces 314-accept-quote-FR-013
  // @traces 314-accept-quote-FR-015
  test('the driver declines one quote: the row greys out and the owner’s Oferte trimise says the customer declined it', async ({
    browser,
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const { quoteId, requestId } = await quoted(request);
    await signedIn(page, DRIVER, '/app/driver');
    await page.goto(`/app/driver/requests?request=${requestId}`);
    const row = page
      .locator('mf-quotes-compare')
      .locator(`li[data-quote="${quoteId}"]`);

    await row.getByRole('button', { exact: true, name: 'Refuză' }).click();
    const dialog = page.getByRole('dialog', {
      name: /^Refuzi oferta Service Auto Militari\?$/,
    });
    await dialog.getByRole('button', { exact: true, name: 'Confirmă' }).click();
    await expect(dialog).toBeHidden();

    await expect(row).toHaveClass(/greyed/);
    await expect(row.locator('[data-part="action"]')).toHaveText(
      'Refuzată de tine',
    );
    await expect(row.getByRole('button')).toHaveCount(0);

    const context = await browser.newContext();
    try {
      const owner = await context.newPage();
      await owner.setViewportSize({ height: 900, width: 1440 });
      await signedIn(owner, MILITARI, '/app/garage');
      await owner.goto('/app/garage/requests');
      const sent = owner
        .locator('mf-quotes-sent-panel')
        .locator(`[data-live-id="${requestId}"]`);
      await expect(sent.locator('.status')).toHaveText('Refuzată de client');
    } finally {
      await context.close();
    }
  });
});

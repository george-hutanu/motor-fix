import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver with a Dacia Logan and a phone, and the owner of
// Service Auto Militari, the one approved seeded garage with staff (the test
// workshop is a draft, which no request reaches).
const DRIVER = 'cerere@example.test';
const DRIVER_PHONE = '+40700000102';
const MILITARI = 'militari@example.test';

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const garageOf = async (request: APIRequestContext, token: string) => {
  const me = await request.get('/api/v1/me', { headers: bearer(token) });
  return ((await me.json()) as { garageId: string }).garageId;
};

// Two of the driver's own requests for an oil service, each quoted by
// Militari, so the driver holds two quotes and no other flow's request is the
// one accepted.
async function twoQuotes(request: APIRequestContext) {
  const militari = await accessToken(request, MILITARI);
  const garageId = await garageOf(request, militari);
  const jobs = await request.get('/api/v1/job-types?keys=oil-service');
  const [oil] = ((await jobs.json()) as { items: { id: string }[] }).items;
  const driver = await accessToken(request, DRIVER);
  const cars = await request.get('/api/v1/cars', { headers: bearer(driver) });
  const { items } = (await cars.json()) as {
    items: { id: string; model: string }[];
  };
  const car = items.find((item) => item.model === 'Logan') ?? items[0];
  const slot = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const requestIds: string[] = [];
  const quoteIds: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const sent = await request.post('/api/v1/quote-requests', {
      data: {
        carId: car.id,
        description: `Schimb de ulei înainte de drum ${randomUUID().slice(0, 8)}`,
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
        slot,
        toLei: 400,
      },
      headers: { ...bearer(militari), 'Idempotency-Key': randomUUID() },
    });
    expect(quote.status()).toBe(201);
    requestIds.push(requestId);
    quoteIds.push(((await quote.json()) as { id: string }).id);
  }
  return { driver, quoteIds, requestIds };
}

async function signedIn(page: Page, email: string, landing: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL(landing);
}

// @seeded: the seeded driver accepts one of two quotes.
test.describe('accepting a quote @seeded', () => {
  // @traces 222-FR-016
  // @traces 222-SC-003
  // @traces 222-SC-004
  test('the driver accepts Militari’s quote: Cererile mele shows it booked and waiting, and the owner sees the accepted row with the phone @core', async ({
    browser,
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const { driver, quoteIds, requestIds } = await twoQuotes(request);
    const [requestId, otherId] = requestIds;
    await signedIn(page, DRIVER, '/app/driver');
    await page.goto('/app/driver/requests');
    const row = page.locator(`li[data-request="${requestId}"]`);
    await expect(row).toContainText('Ofertă');

    const accepted = await request.post(
      `/api/v1/quotes/${quoteIds[0]}/accept`,
      {
        data: { historyShared: false },
        headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
      },
    );
    expect(accepted.status()).toBe(201);
    expect(await accepted.json()).toMatchObject({
      quoteId: quoteIds[0],
      status: 'awaiting_confirmation',
    });

    // The live re-read, with no reload, within the brief's 5 seconds.
    await expect(row).toContainText('Programată', { timeout: 5_000 });
    await expect(row.locator('.waiting')).toHaveText(
      /^Așteaptă confirmarea service‑ului · încă 2[34] h$/,
    );
    // The driver's other quote is untouched by this acceptance.
    const other = page.locator(`li[data-request="${otherId}"]`);
    await expect(other).toContainText('Ofertă');
    await expect(other.locator('.waiting')).toHaveCount(0);

    const context = await browser.newContext();
    try {
      const owner = await context.newPage();
      await owner.setViewportSize({ height: 900, width: 1440 });
      await signedIn(owner, MILITARI, '/app/garage');
      await owner.goto('/app/garage/requests');
      const sent = owner
        .locator('mf-quotes-sent-panel')
        .locator(`[data-live-id="${requestId}"]`);
      await expect(sent).toContainText('Acceptată · așteaptă confirmarea ta');
      await expect(sent).toContainText(/încă 2[34] h/);
      await expect(sent.locator(`a[href="tel:${DRIVER_PHONE}"]`)).toHaveText(
        DRIVER_PHONE,
      );
    } finally {
      await context.close();
    }
  });
});

import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import { accessToken, bearer, DRIVER, freeSlot, MILITARI } from './booking.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

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

// One request of the driver's for an oil service, quoted by Militari.
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
      description: `Schimb de ulei de urmărit ${randomUUID().slice(0, 8)}`,
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
      slot: await freeSlot(request),
      toLei: 400,
    },
    headers: { ...bearer(militari), 'Idempotency-Key': randomUUID() },
  });
  expect(quote.status()).toBe(201);
  const quoteId = ((await quote.json()) as { id: string }).id;
  return { driver, quoteId, requestId };
}

// @seeded: Militari follows a quote it sent from waiting to booked.
test.describe('following the outcome of a quote sent @seeded', () => {
  // @traces 346-FR-003
  // @traces 346-FR-004
  test('the owner’s row turns from waiting to accepted live when the driver accepts, then to booked once confirmed from the row', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const { driver, quoteId, requestId } = await quoted(request);
    await signedIn(page, MILITARI, '/app/garage');
    await page.goto('/app/garage/requests');
    const row = page
      .locator('mf-quotes-sent-panel')
      .locator(`[data-live-id="${requestId}"]`);
    await expect(row.locator('.status')).toHaveText(
      'Așteaptă răspunsul clientului',
    );
    await expect(row.locator('.expires')).toHaveText(/^expiră în \d+ zile$/);

    const accepted = await request.post(`/api/v1/quotes/${quoteId}/accept`, {
      data: { historyShared: false },
      headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
    });
    expect(accepted.status()).toBe(201);

    // The live re-read, with no navigation, within the brief's 5 seconds.
    await expect(row.locator('.status')).toHaveText(
      /^Acceptată · confirmă până la (mâine, )?\d{2}:\d{2}$/,
      { timeout: 5_000 },
    );
    await expect(row).toHaveAttribute('data-tone', 'amber');

    await row.getByRole('button', { name: 'Confirmă programarea' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirmă programarea' });
    const mechanic = dialog.getByLabel('Mecanic');
    await expect(mechanic).toBeVisible();
    const [, first] = await mechanic.locator('option').allTextContents();
    await mechanic.selectOption({ label: first });
    await dialog.getByRole('button', { exact: true, name: 'Confirmă' }).click();
    await expect(dialog).toBeHidden();

    await expect(row.locator('.status')).toContainText(
      'Acceptată · programată',
    );
    await expect(row).toHaveAttribute('data-tone', 'green');
    await expect(
      row.getByRole('button', { name: 'Confirmă programarea' }),
    ).toHaveCount(0);
  });
});

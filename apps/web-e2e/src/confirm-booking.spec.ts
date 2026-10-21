import { randomInt, randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, the approved seeded garage with mechanics and two lifts.
const DRIVER = 'cerere@example.test';
const MILITARI = 'militari@example.test';
const MINUTE = 60_000;

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// A slot days ahead, drawn from 300 days of minutes, so a run on a database
// an earlier run left (or a parallel one) finds the mechanic and the lift
// free: two hour-long slots overlap about once in 3,600 draws. A Bucharest
// public holiday is drawn again: confirming refuses it as outside the hours.
async function freeSlot(request: APIRequestContext) {
  const year = new Date().getFullYear();
  const holidays = new Set<string>();
  for (const one of [year, year + 1, year + 2]) {
    const res = await request.get(`/api/v1/public-holidays?year=${one}`);
    expect(res.ok()).toBe(true);
    for (const { day } of (await res.json()) as { day: string }[])
      holidays.add(day);
  }
  const bucharestDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
  });
  const minute = Math.floor(Date.now() / MINUTE);
  for (;;) {
    const ahead = 3 * 24 * 60 + randomInt(300 * 24 * 60);
    const slot = new Date((minute + ahead) * MINUTE);
    if (!holidays.has(bucharestDay.format(slot))) return slot.toISOString();
  }
}

// One request of the driver's, quoted by Militari and accepted by the driver,
// so its booking waits for the garage's confirmation.
async function accepted(request: APIRequestContext) {
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
      description: `Schimb de ulei și filtre ${randomUUID().slice(0, 8)}`,
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
  const accept = await request.post(`/api/v1/quotes/${quoteId}/accept`, {
    data: { historyShared: false },
    headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
  });
  expect(accept.status()).toBe(201);
  return requestId;
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

// @seeded: the seeded driver's accepted booking is confirmed by Militari.
test.describe('confirming a booking @seeded', () => {
  // @traces 389-FR-002
  // @traces 389-FR-014
  // @traces 389-FR-015
  // @traces 389-FR-016
  // @traces 389-FR-020
  test('the owner confirms with a mechanic and Elevator 1, and the driver’s Cererile mele shows it booked without a reload', async ({
    browser,
    page,
    request,
  }) => {
    const requestId = await accepted(request);
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, DRIVER, '/app/driver');
    await page.goto('/app/driver/requests');
    const row = page.locator(`li[data-request="${requestId}"]`);
    await expect(row.locator('.waiting')).toBeVisible();
    await expect(row.locator('.booked')).toHaveCount(0);

    const context = await browser.newContext();
    try {
      const owner = await context.newPage();
      await owner.setViewportSize({ height: 900, width: 1440 });
      await signedIn(owner, MILITARI, '/app/garage');
      await owner.goto('/app/garage/requests');
      const sent = owner
        .locator('mf-quotes-sent-panel')
        .locator(`[data-live-id="${requestId}"]`);
      await sent.getByRole('button', { name: 'Confirmă programarea' }).click();

      const dialog = owner.getByRole('dialog', {
        name: 'Confirmă programarea',
      });
      const mechanic = dialog.getByLabel('Mecanic');
      // The choices arrive after the dialog opens.
      await expect(mechanic).toBeVisible();
      const [, first] = await mechanic.locator('option').allTextContents();
      await mechanic.selectOption({ label: first });
      await dialog.getByLabel('Elevator').selectOption({ label: 'Elevator 1' });
      await dialog
        .getByRole('button', { exact: true, name: 'Confirmă' })
        .click();
      await expect(owner.getByText('Programare confirmată')).toBeVisible();
      await expect(dialog).toBeHidden();

      await expect(sent).toContainText('Acceptată · programată');
      await expect(sent.locator('.mechanic')).toHaveText(first);
      await expect(sent.locator('.lift')).toHaveText('Elevator 1');
      await expect(
        sent.getByRole('button', { name: 'Confirmă programarea' }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }

    await expect(row.locator('.booked')).toContainText('Programată ·', {
      timeout: 5_000,
    });
    await expect(row.locator('.waiting')).toHaveCount(0);
  });
});

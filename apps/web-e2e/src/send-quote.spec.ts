import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, which ticks the oil service for Dacia and lists it at 250–400 lei
// and 1 hour on its price list.
const DRIVER = 'cerere@example.test';
const OWNER = 'militari@example.test';
const OIL = 'Schimb de ulei și filtre';

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// The driver sends its own request for an oil service to the owner's garage,
// so no other flow's request is the one answered.
async function sendRequest(request: APIRequestContext) {
  const owner = await accessToken(request, OWNER);
  const me = await request.get('/api/v1/me', { headers: bearer(owner) });
  const { garageId } = (await me.json()) as { garageId: string };
  const jobs = await request.get('/api/v1/job-types?keys=oil-service');
  const [oil] = ((await jobs.json()) as { items: { id: string }[] }).items;
  const driver = await accessToken(request, DRIVER);
  const cars = await request.get('/api/v1/cars', { headers: bearer(driver) });
  const { items } = (await cars.json()) as {
    items: { id: string; model: string }[];
  };
  const car = items.find((item) => item.model === 'Logan') ?? items[0];
  const res = await request.post('/api/v1/quote-requests', {
    data: {
      carId: car.id,
      description: `Schimb de ulei înainte de drum ${randomUUID().slice(0, 8)}`,
      garageIds: [garageId],
      jobTypeIds: [oil.id],
      sources: ['profile_direct'],
    },
    headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
  });
  expect(res.status()).toBe(201);
  return { driver, id: ((await res.json()) as { id: string }).id };
}

// Tomorrow's date in Bucharest, as a date field takes it, and an instant's
// Bucharest wall time.
const BUCHAREST = { timeZone: 'Europe/Bucharest' } as const;
const tomorrow = () =>
  new Intl.DateTimeFormat('en-CA', BUCHAREST).format(
    new Date(Date.now() + 24 * 60 * 60 * 1000),
  );
const wallTime = (instant: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    ...BUCHAREST,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(instant));

async function signedIn(page: Page, email: string, landing: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL(landing);
}

// @seeded: the seeded owner answers a driver's request with a quote.
test.describe('sending a quote @seeded', () => {
  // @traces 344-FR-010
  // @traces 344-FR-011
  // @traces 344-FR-014
  // @traces 344-FR-015
  // @traces 344-FR-019
  test('the owner sends 650–800 lei, 2 h, tomorrow 09:00 from the pre-filled dialog; the row moves to Oferte trimise and the driver sees the quote', async ({
    browser,
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const { driver, id } = await sendRequest(request);
    await signedIn(page, OWNER, '/app/garage');
    await page
      .getByRole('navigation', { name: 'Meniu' })
      .getByRole('link', { name: /^Cereri de ofertă/ })
      .click();
    await expect(page).toHaveURL('/app/garage/requests');

    const waiting = page
      .locator('mf-garage-requests-panel')
      .locator(`[data-live-id="${id}"]`);
    await expect(waiting).toContainText(OIL);
    await waiting.getByRole('button', { name: 'Trimite oferta' }).click();

    const dialog = page.getByRole('dialog', { name: 'Trimite oferta' });
    await expect(dialog).toContainText(OIL);
    const from = dialog.getByLabel('Preț de la (lei)');
    const to = dialog.getByLabel('până la (lei)');
    const hours = dialog.getByLabel('Ore');
    const minutes = dialog.getByLabel('Minute');
    // The price list's range and duration for the oil service.
    await expect(from).toHaveValue('250');
    await expect(to).toHaveValue('400');
    await expect(hours).toHaveValue('1');
    await expect(minutes).toHaveValue('0');

    await from.fill('650');
    await to.fill('800');
    await hours.fill('2');
    await dialog.getByLabel('Ziua').fill(tomorrow());
    await dialog.getByLabel('Ora', { exact: true }).fill('09:00');
    await dialog
      .getByLabel('Mesaj pentru client')
      .fill('Include filtrul de aer');
    await dialog.getByRole('button', { exact: true, name: 'Trimite' }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByText('Ofertă trimisă', { exact: true }),
    ).toBeVisible();
    // The live re-read, with no reload: out of the waiting list, under
    // Oferte trimise within the brief's 5 seconds.
    const sent = page
      .locator('mf-quotes-sent-panel')
      .locator(`[data-live-id="${id}"]`);
    await expect(sent).toBeVisible({ timeout: 5_000 });
    await expect(waiting).toHaveCount(0, { timeout: 5_000 });
    await expect(sent).toContainText('650–800 lei');
    await expect(sent).toContainText('mâine, 09:00');
    await expect(sent).toContainText('Așteaptă răspunsul clientului');

    // The driver's request read holds the quote as sent.
    const read = await request.get(`/api/v1/requests/${id}`, {
      headers: bearer(driver),
    });
    expect(read.ok()).toBe(true);
    const { quotes, status } = (await read.json()) as {
      quotes: {
        durationMinutes: number;
        fromBani: number;
        note: string | null;
        slot: string;
        status: string;
        toBani: number;
      }[];
      status: string;
    };
    expect(status).toBe('quoted');
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      durationMinutes: 120,
      fromBani: 65_000,
      note: 'Include filtrul de aer',
      status: 'waiting',
      toBani: 80_000,
    });
    expect(wallTime(quotes[0].slot)).toBe(`${tomorrow()} 09:00`);

    // Signed in as the driver, the request shows it has a quote.
    const context = await browser.newContext();
    try {
      const own = await context.newPage();
      await own.setViewportSize({ height: 900, width: 1440 });
      await signedIn(own, DRIVER, '/app/driver');
      await own.goto('/app/driver/requests');
      await expect(
        own
          .locator('li[data-request]')
          .filter({ hasText: 'Dacia Logan' })
          .filter({ hasText: OIL })
          .filter({ hasText: 'Ofertă' }),
      ).not.toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

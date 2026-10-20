import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { accessToken, bearer } from './quoted-request.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, which ticks the oil service for Dacia.
const DRIVER = 'cerere@example.test';
const OWNER = 'militari@example.test';
const OIL = 'Schimb de ulei și filtre';

// The driver's own request for an oil service, with a two-line description,
// sent to the owner's garage.
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
  const tag = randomUUID().slice(0, 8);
  const description = `Scârțâie la frânare ${tag}\nSunați după ora 18`;
  const res = await request.post('/api/v1/quote-requests', {
    data: {
      carId: car.id,
      description,
      garageIds: [garageId],
      jobTypeIds: [oil.id],
      sources: ['profile_direct'],
    },
    headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
  });
  expect(res.status()).toBe(201);
  return { id: ((await res.json()) as { id: string }).id, tag };
}

const BUCHAREST = { timeZone: 'Europe/Bucharest' } as const;
const DAY = 24 * 60 * 60 * 1000;
const day = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', BUCHAREST).format(at);
const tomorrow = () =>
  new Intl.DateTimeFormat('en-CA', BUCHAREST).format(
    new Date(Date.now() + 24 * 60 * 60 * 1000),
  );

async function signedIn(page: Page) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, OWNER);
  await expect(page).toHaveURL('/app/garage');
}

// @seeded: the seeded owner opens a driver's request to read it.
test.describe('reading a request @seeded', () => {
  // @traces 347-FR-001 347-FR-002 347-FR-003 347-FR-006 347-FR-007
  test('the owner opens a waiting request from Panou and from the view, reads it whole and sends a quote from the drawer', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const { id, tag } = await sendRequest(request);
    await signedIn(page);

    const onPanou = page
      .locator('mf-garage-requests-panel')
      .locator(`[data-live-id="${id}"]`);
    await onPanou.getByRole('button', { name: /^Deschide cererea / }).click();
    await expect(page).toHaveURL(`/app/garage/requests/${id}`);
    const drawer = page.getByRole('dialog', { name: 'Cerere de ofertă' });
    await expect(drawer).toContainText('Dacia Logan');
    await expect(drawer).toContainText(OIL);
    await expect(drawer).toContainText(`Scârțâie la frânare ${tag}`);
    await expect(drawer).toContainText('Sunați după ora 18');
    await expect(drawer).toContainText('orice mecanic');
    // Seven Bucharest days on, in whole days left: 6 most weeks, 7 when the
    // clocks go back an hour before it expires.
    const expires = drawer.locator('.times time').nth(1);
    const until = new Date((await expires.getAttribute('datetime')) ?? '');
    const sevenOn = new Date(`${day(new Date())}T12:00:00Z`);
    sevenOn.setUTCDate(sevenOn.getUTCDate() + 7);
    expect(day(until)).toBe(sevenOn.toISOString().slice(0, 10));
    const left = Math.floor((until.getTime() - Date.now()) / DAY);
    await expect(expires).toHaveText(`expiră în ${left} zile`);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL('/app/garage');

    await page
      .getByRole('navigation', { name: 'Meniu' })
      .getByRole('link', { name: /^Cereri de ofertă/ })
      .click();
    await expect(page).toHaveURL('/app/garage/requests');
    const waiting = page
      .locator('mf-garage-requests-panel')
      .locator(`[data-live-id="${id}"]`);
    await waiting.getByRole('button', { name: /^Deschide cererea / }).click();
    await expect(drawer).toContainText(`Scârțâie la frânare ${tag}`);
    await drawer.getByRole('button', { name: 'Trimite oferta' }).click();

    const dialog = page.getByRole('dialog', { name: 'Trimite oferta' });
    await dialog.getByLabel('Ziua').fill(tomorrow());
    await dialog.getByLabel('Ora', { exact: true }).fill('09:00');
    await dialog.getByRole('button', { exact: true, name: 'Trimite' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL('/app/garage/requests');
    await expect(waiting).toHaveCount(0, { timeout: 5_000 });
  });

  // @traces 347-FR-007
  test('the request’s address opens the drawer, and Back closes it', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const { id, tag } = await sendRequest(request);
    await signedIn(page);

    await page.goto(`/app/garage/requests/${id}`);
    const drawer = page.getByRole('dialog', { name: 'Cerere de ofertă' });
    await expect(drawer).toContainText(`Scârțâie la frânare ${tag}`);
    await expect(page.locator('mf-garage-requests-panel')).toBeVisible();

    await page.goBack();
    await expect(drawer).toHaveCount(0);
  });
});

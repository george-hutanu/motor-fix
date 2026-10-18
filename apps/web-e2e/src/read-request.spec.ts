import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, which ticks the oil service for Dacia.
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
const tomorrow = () =>
  new Intl.DateTimeFormat('en-CA', BUCHAREST).format(
    new Date(Date.now() + DAY),
  );

// An instant as Bucharest reads it: its day and its wall-clock time.
const wall = (at: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...BUCHAREST,
    day: '2-digit',
    fractionalSecondDigits: 3,
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value;
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}:${part('second')}.${part('fractionalSecond')}`,
  };
};
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

async function signedIn(page: Page) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
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
    const detail = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/garage/requests/${id}`) &&
        response.request().method() === 'GET',
    );
    await onPanou.getByRole('button', { name: /^Deschide cererea / }).click();
    await expect(page).toHaveURL(`/app/garage/requests/${id}`);
    const { createdAt, expiresAt } = (await (await detail).json()) as {
      createdAt: string;
      expiresAt: string;
    };
    // Seven Bucharest days at the same wall-clock time (221-FR-010), so 169 h
    // over the autumn clock change; the drawer rounds the time left down to
    // whole days (347-FR-003): 6 in most weeks, 7 in the week before it.
    expect(wall(expiresAt)).toEqual({
      day: plusDays(wall(createdAt).day, 7),
      time: wall(createdAt).time,
    });
    const daysLeft = Math.floor((Date.parse(expiresAt) - Date.now()) / DAY);
    const drawer = page.getByRole('dialog', { name: 'Cerere de ofertă' });
    await expect(drawer).toContainText('Dacia Logan');
    await expect(drawer).toContainText(OIL);
    await expect(drawer).toContainText(`Scârțâie la frânare ${tag}`);
    await expect(drawer).toContainText('Sunați după ora 18');
    await expect(drawer).toContainText('orice mecanic');
    await expect(drawer).toContainText(`expiră în ${daysLeft} zile`);
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

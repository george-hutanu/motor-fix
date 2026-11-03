import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { openSignIn, PASSWORD, ready, signIn } from './accounts.js';
import { bucharestDay } from './bucharest-day.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// @traces 1431-FR-001 1431-FR-002 1431-FR-004 1431-FR-005 1431-FR-009

// The owner of Service Auto Militari, and the seeded driver with a Dacia Logan.
const OWNER = 'militari@example.test';
const DRIVER = 'cerere@example.test';

const MONTHS = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  ro: [
    'ianuarie',
    'februarie',
    'martie',
    'aprilie',
    'mai',
    'iunie',
    'iulie',
    'august',
    'septembrie',
    'octombrie',
    'noiembrie',
    'decembrie',
  ],
} as const;

const LABELS = {
  en: [
    'New requests today',
    'Bookings this week',
    'Garage rating',
    'Estimated work',
  ],
  ro: [
    'Cereri noi azi',
    'Programări săptămâna asta',
    'Nota service‑ului',
    'Lucrări estimate',
  ],
} as const;

// Whole numbers as each language groups them: 1.530 and 1,530.
const NUMBER = { en: /^\d{1,3}(,\d{3})*$/, ro: /^\d{1,3}(\.\d{3})*$/ };
const RATING = { en: /^(\d\.\d|—)$/, ro: /^(\d,\d|—)$/ };

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signedIn(page: Page) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await openSignIn(page);
  await signIn(page, OWNER);
  await expect(page).toHaveURL('/app/garage');
}

const panel = (page: Page) => page.locator('[data-section="kpi"]');
const card = (page: Page, key: string) =>
  panel(page).locator(`[data-card="${key}"]`);
const value = (page: Page, key: string) =>
  card(page, key).locator('[data-value]');
const whole = (text: string) => Number(text.replace(/[.,]/g, ''));

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
      description: 'Bate ceva la roata din spate',
      garageIds: [garageId],
      jobTypeIds: [],
      sources: ['profile_direct'],
    },
    headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
  });
  expect(res.status()).toBe(201);
}

async function expectCards(page: Page, language: 'ro' | 'en') {
  const month = MONTHS[language][Number(bucharestDay().slice(5, 7)) - 1];
  const cards = panel(page).locator('[data-card]');
  await expect(cards).toHaveCount(4);
  const [requests, bookings, rating, work] = LABELS[language];
  await expect(card(page, 'requests').locator('.label')).toHaveText(requests);
  await expect(card(page, 'bookings').locator('.label')).toHaveText(bookings);
  await expect(card(page, 'rating').locator('.label')).toHaveText(rating);
  await expect(card(page, 'work').locator('.label')).toHaveText(
    `${work}, ${month}`,
  );
  for (const key of ['requests', 'bookings', 'work'])
    await expect(value(page, key)).toHaveText(NUMBER[language]);
  await expect(value(page, 'rating')).toHaveText(RATING[language]);
  await expect(card(page, 'requests').locator('[data-note]')).toHaveText(
    language === 'ro'
      ? /^([+−]\d+ față de ieri|la fel ca ieri)$/
      : /^([+−]\d+ vs yesterday|same as yesterday)$/,
  );
  await expect(card(page, 'work').locator('[data-note]')).toHaveText(
    language === 'ro'
      ? 'lei, din prețuri finale și oferte acceptate'
      : 'lei, from final prices and accepted quotes',
  );
}

test.describe("today's four numbers on Panou @seeded", () => {
  test.describe.configure({ mode: 'default' });

  for (const width of [1280, 390]) {
    test(`shows the four cards in Romanian and English at ${width} px, with no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 900, width });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signedIn(page);

      await expectCards(page, 'ro');
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      await page
        .getByRole('group', { name: 'Limba' })
        .getByRole('button', { name: 'EN' })
        .click();
      await expectCards(page, 'en');
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  test('moves the first card within seconds when a request arrives, with no reload', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1280 });
    await signedIn(page);
    await expect(value(page, 'requests')).toHaveText(NUMBER.ro);
    const before = whole(await value(page, 'requests').innerText());
    const url = page.url();

    await send(request);

    // Other workers send to the same garage: the count only grows.
    await expect
      .poll(async () => whole(await value(page, 'requests').innerText()), {
        timeout: 5_000,
      })
      .toBeGreaterThanOrEqual(before + 1);
    expect(page.url()).toBe(url);
  });
});

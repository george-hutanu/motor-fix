import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { type OwnDriver, ownDriver } from './own-driver.js';
import { accessToken, bearer } from './quoted-request.js';
import { keepSeededLanguage } from './seeded-language.js';

// The owner of Service Auto Militari, an approved garage that works on the own
// driver's 2018 Dacia Logan.
const OWNER = 'militari@example.test';
// Sent before the page opens: at 390 × 844 they make the page scroll by more
// than a row, and they all sit on the list's first page of 20.
const FILLERS = 6;
// Where the row being read sits below the top of the window: clear of the
// bar above the page and of the pill.
const READING_AT = 200;

// The driver sends a request with no job, straight to the owner's garage.
async function sender(request: APIRequestContext, own: OwnDriver) {
  const owner = await accessToken(request, OWNER);
  const me = await request.get('/api/v1/me', { headers: bearer(owner) });
  const { garageId } = (await me.json()) as { garageId: string };
  const driver = await accessToken(request, own.email);
  return async () => {
    const res = await request.post('/api/v1/quote-requests', {
      data: {
        carId: own.carId,
        description: `Zgomot la direcție ${randomUUID().slice(0, 8)}`,
        garageIds: [garageId],
        jobTypeIds: [],
        sources: ['profile_direct'],
      },
      headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
}

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

const row = (page: Page, id: string) =>
  page.locator('mf-garage-requests-panel').locator(`[data-live-id="${id}"]`);
const top = (page: Page, id: string) =>
  row(page, id).evaluate((el) => el.getBoundingClientRect().top);

// @seeded: a request that arrives while the owner reads further down the list
// waits behind the pill instead of pushing the list down.
test.describe('a scrolled live list keeps its place @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its driver and car straight to PostgreSQL, which needs DATABASE_URL',
  );
  let own: OwnDriver;
  test.beforeEach(async ({ request }) => {
    own = await ownDriver(request, 'cerere-derulare');
  });
  test.afterEach(async () => {
    await own?.remove();
  });

  // @traces 587-FR-001
  // @traces 587-FR-002
  // @traces 587-FR-003
  // @traces 587-FR-004
  test('a request from another context leaves the row being read in place, shows the pill, and the pill brings the request into view', async ({
    page,
    request,
  }) => {
    const send = await sender(request, own);
    const fillers: string[] = [];
    for (let i = 0; i < FILLERS; i++) fillers.push(await send());

    await page.setViewportSize({ height: 844, width: 390 });
    await signedIn(page);
    await page.goto('/app/garage/requests');
    for (const id of fillers) await expect(row(page, id)).toBeVisible();
    const pill = page.locator('mf-live-pill button');
    await expect(pill).toHaveCount(0);

    // Newest first: the third filler sent sits in the middle of the six.
    const reading = fillers[2];
    await row(page, reading).evaluate((el, at) => {
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - at);
    }, READING_AT);
    await expect
      .poll(async () => Math.abs((await top(page, reading)) - READING_AT))
      .toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const before = await top(page, reading);

    const id = await send();

    // Other workers send to this garage too: the count is at least this one.
    await expect(pill).toBeInViewport({ timeout: 5_000 });
    expect(
      Number(/^(\d+) /.exec((await pill.textContent())?.trim() ?? '')?.[1]),
    ).toBeGreaterThanOrEqual(1);
    await expect(row(page, id)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await top(page, reading)) - before))
      .toBeLessThanOrEqual(1);

    await pill.click();
    await expect(row(page, id)).toBeInViewport();
  });
});

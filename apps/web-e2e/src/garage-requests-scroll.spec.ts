import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { openSignIn, ready, signIn, signUpDriver } from './accounts.js';
import { test } from './fixtures.js';
import { accessToken, bearer } from './quoted-request.js';
import { keepSeededLanguage } from './seeded-language.js';

// The owner of Service Auto Militari, an approved garage that works on Dacia
// petrol cars.
const OWNER = 'militari@example.test';
// Sent before the page opens: at 390 × 844 they make the page scroll by more
// than a row, and they all sit on the list's first page of 20.
const FILLERS = 6;
// Where the row being read sits below the top of the window: clear of the
// bar above the page and of the pill.
const READING_AT = 200;

// A driver of the test's own with a Dacia Logan: a driver may send 20
// requests a day, and the specs beside this one use the seeded driver's up.
// The returned function sends a request with no job, straight to the owner's
// garage.
async function sender(request: APIRequestContext) {
  const owner = await accessToken(request, OWNER);
  const me = await request.get('/api/v1/me', { headers: bearer(owner) });
  const { garageId } = (await me.json()) as { garageId: string };
  const driver = bearer(
    await accessToken(request, await signUpDriver(request, 'cerere-derulare')),
  );
  const brands = await request.get('/api/v1/brands?q=Dacia', {
    headers: driver,
  });
  const [dacia] = ((await brands.json()) as { items: { id: string }[] }).items;
  const car = await request.post('/api/v1/cars', {
    data: {
      brandId: dacia.id,
      fuel: 'petrol',
      model: 'Logan',
      odometerKm: 98_000,
      year: 2018,
    },
    headers: { ...driver, 'Idempotency-Key': randomUUID() },
  });
  expect(car.status(), await car.text()).toBe(201);
  const carId = ((await car.json()) as { id: string }).id;
  return async () => {
    const res = await request.post('/api/v1/quote-requests', {
      data: {
        carId,
        description: `Zgomot la direcție ${randomUUID().slice(0, 8)}`,
        garageIds: [garageId],
        jobTypeIds: [],
        sources: ['profile_direct'],
      },
      headers: { ...driver, 'Idempotency-Key': randomUUID() },
    });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
}

async function signedIn(page: Page) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await openSignIn(page);
  await signIn(page, OWNER);
  await expect(page).toHaveURL('/app/garage');
}

const row = (page: Page, id: string) =>
  page.locator('mf-garage-requests-panel').locator(`[data-live-id="${id}"]`);
const top = (page: Page, id: string) =>
  row(page, id).evaluate((el) => el.getBoundingClientRect().top);

const waiting = async (page: Page) =>
  Number(
    /^(\d+) /.exec(
      (await page.locator('mf-live-pill button').textContent())?.trim() ?? '',
    )?.[1],
  );

// Six fillers on the requests page at 390 × 844, scrolled so the middle one
// sits READING_AT below the top and the top of the list is off screen.
async function scrolled(page: Page, request: APIRequestContext) {
  const send = await sender(request);
  const fillers: string[] = [];
  for (let i = 0; i < FILLERS; i++) fillers.push(await send());

  await page.setViewportSize({ height: 844, width: 390 });
  await signedIn(page);
  await page.goto('/app/garage/requests');
  for (const id of fillers) await expect(row(page, id)).toBeVisible();
  await expect(page.locator('mf-live-pill button')).toHaveCount(0);

  // Newest first: the third filler sent sits in the middle of the six.
  const reading = fillers[2];
  await row(page, reading).evaluate((el, at) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - at);
  }, READING_AT);
  await expect
    .poll(async () => Math.abs((await top(page, reading)) - READING_AT))
    .toBeLessThanOrEqual(1);
  // The top of the list is off screen: the anchor records and the list is
  // not at its top.
  expect(
    await page
      .locator('mf-garage-requests-panel [data-live-id]')
      .first()
      .evaluate((el) => el.getBoundingClientRect().top),
  ).toBeLessThan(0);
  return { before: await top(page, reading), reading, send };
}

// @seeded: a request that arrives while the owner reads further down the list
// waits behind the pill instead of pushing the list down.
test.describe('a scrolled live list keeps its place @seeded', () => {
  // @traces 587-FR-001
  // @traces 587-FR-002
  // @traces 587-FR-003
  // @traces 587-FR-004
  test('a request from another context leaves the row being read in place, shows the pill, and the pill brings the request into view', async ({
    page,
    request,
  }) => {
    const { before, reading, send } = await scrolled(page, request);
    const pill = page.locator('mf-live-pill button');

    const id = await send();

    // Other workers send to this garage too: the count is at least this one.
    await expect(pill).toBeInViewport();
    expect(await waiting(page)).toBeGreaterThanOrEqual(1);
    await expect(row(page, id)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await top(page, reading)) - before))
      .toBeLessThanOrEqual(1);

    await pill.click();
    await expect(row(page, id)).toBeInViewport();
  });

  // @traces 587-FR-001
  // @traces 587-FR-002
  // @traces 587-FR-003
  test('two requests arriving while scrolled are both held back, counted together, and both shown after one click', async ({
    page,
    request,
  }) => {
    const { before, reading, send } = await scrolled(page, request);
    const pill = page.locator('mf-live-pill button');

    const first = await send();
    const second = await send();

    await expect(pill).toBeInViewport();
    await expect.poll(() => waiting(page)).toBeGreaterThanOrEqual(2);
    await expect(row(page, first)).toHaveCount(0);
    await expect(row(page, second)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await top(page, reading)) - before))
      .toBeLessThanOrEqual(1);

    await pill.click();
    await expect(row(page, first)).toHaveCount(1);
    await expect(row(page, second)).toBeInViewport();
    await expect(pill).toHaveCount(0);
  });

  // @traces 587-FR-001
  test('a request arriving while the list is at the top shows at once with no pill', async ({
    page,
    request,
  }) => {
    const send = await sender(request);
    const filler = await send();

    await page.setViewportSize({ height: 844, width: 390 });
    await signedIn(page);
    await page.goto('/app/garage/requests');
    await expect(row(page, filler)).toBeVisible();

    const id = await send();

    await expect(row(page, id)).toBeVisible();
    await expect(page.locator('mf-live-pill button')).toHaveCount(0);
  });
});

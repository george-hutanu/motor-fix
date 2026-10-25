import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { openSignIn, ready, signIn, signUpDriver } from './accounts.js';
import { test } from './fixtures.js';
import { accessToken, bearer } from './quoted-request.js';
import { keepSeededLanguage } from './seeded-language.js';

// The owner of Service Auto Militari, an approved garage that works on Dacia
// petrol cars.
const OWNER = 'militari@example.test';
// Rows the list needs before the check: at 390 × 844 the fifth is read with
// four above it, off screen, and five below. The other specs that send to
// this garage usually leave that many; only the shortfall is sent, since a
// burst of new requests pushes another spec's row out of Panou's four.
const ROWS = 10;
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

// The page's next re-read of its first page that holds every one of `ids`.
// Other workers send to this garage too, so the pill's count can rise by as
// many as were sent before these reach the list; the pill shows only what was
// read before its click.
function readWith(page: Page, ids: () => readonly string[]) {
  return page.waitForResponse(async (res) => {
    const url = new URL(res.url());
    if (url.pathname !== '/api/v1/garage/requests') return false;
    if (url.searchParams.has('cursor') || !res.ok()) return false;
    const body = await res.text();
    const wanted = ids();
    return wanted.length > 0 && wanted.every((id) => body.includes(id));
  });
}

// The count on the pill, 0 while there is none.
async function waiting(page: Page) {
  const pill = page.locator('mf-live-pill button');
  if ((await pill.count()) === 0) return 0;
  return Number(/^(\d+) /.exec((await pill.textContent())?.trim() ?? '')?.[1]);
}

// The requests page at 390 × 844 with at least ROWS rows, scrolled so the
// fifth sits READING_AT below the top and the top of the list is off screen.
async function scrolled(page: Page, request: APIRequestContext) {
  const send = await sender(request);
  await page.setViewportSize({ height: 844, width: 390 });
  await signedIn(page);
  await page.goto('/app/garage/requests');
  const panel = page.locator('mf-garage-requests-panel');
  const rows = panel.locator('[data-live-id]');
  await expect(panel.locator('[data-live-id], .empty').first()).toBeVisible();
  const short = ROWS - (await rows.count());
  for (let i = 0; i < short; i++) await send();
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(ROWS);
  await expect(page.locator('mf-live-pill button')).toHaveCount(0);

  const reading = (await rows.nth(4).getAttribute('data-live-id')) ?? '';
  await expect(row(page, reading)).toBeVisible();
  await row(page, reading).evaluate((el, at) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - at);
  }, READING_AT);
  await expect
    .poll(async () => Math.abs((await top(page, reading)) - READING_AT))
    .toBeLessThanOrEqual(1);
  // The top of the list is off screen: the anchor records and the list is
  // not at its top.
  expect(
    await rows.first().evaluate((el) => el.getBoundingClientRect().top),
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

    // Other workers send to this garage too: the count rises by at least
    // this one.
    const held = await waiting(page);
    let sent: string[] = [];
    const read = readWith(page, () => sent);
    const id = await send();
    sent = [id];
    await read;

    await expect(pill).toBeInViewport();
    await expect.poll(() => waiting(page)).toBeGreaterThanOrEqual(held + 1);
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

    const held = await waiting(page);
    let sent: string[] = [];
    const read = readWith(page, () => sent);
    const first = await send();
    const second = await send();
    sent = [first, second];
    await read;

    await expect(pill).toBeInViewport();
    await expect.poll(() => waiting(page)).toBeGreaterThanOrEqual(held + 2);
    await expect(row(page, first)).toHaveCount(0);
    await expect(row(page, second)).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await top(page, reading)) - before))
      .toBeLessThanOrEqual(1);

    await pill.click();
    await expect(row(page, first)).toHaveCount(1);
    await expect(row(page, second)).toBeInViewport();
  });

  // @traces 587-FR-001
  test('a request arriving while the list is at the top shows at once with no pill', async ({
    page,
    request,
  }) => {
    const send = await sender(request);
    await page.setViewportSize({ height: 844, width: 390 });
    await signedIn(page);
    await page.goto('/app/garage/requests');
    const panel = page.locator('mf-garage-requests-panel');
    await expect(panel.locator('[data-live-id], .empty').first()).toBeVisible();

    const id = await send();

    await expect(row(page, id)).toBeVisible();
    await expect(page.locator('mf-live-pill button')).toHaveCount(0);
  });
});

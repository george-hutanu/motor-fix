import { expect, type Page, type Route } from '@playwright/test';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

const STEFAN = {
  label: 'Strada Ștefan cel Mare 12, Sector 2, București',
  lat: 44.4512,
  lng: 26.1207,
};

const step = (page: Page) => page.locator('mf-place-step');
const address = (page: Page) => step(page).locator('input[name="address"]');
const radius = (page: Page) => step(page).locator('input[name="radiusKm"]');
const pin = (page: Page) => step(page).locator('.maplibregl-marker');

type Answer = { status: number; body: unknown };

// The look-up and the map never leave the app: the look-up is answered here
// and the map reads the app's own empty style. The app's own host is the
// suite's base URL's, a deployed one included.
async function stub(
  page: Page,
  answer: Answer = { body: { items: [STEFAN] }, status: 200 },
) {
  const own = new URL(test.info().project.use.baseURL ?? 'http://localhost')
    .hostname;
  const outside: string[] = [];
  page.on('request', (request) => {
    const { hostname } = new URL(request.url());
    if (
      ![own, 'localhost', '127.0.0.1'].includes(hostname) &&
      !request.url().startsWith('data:')
    )
      outside.push(hostname);
  });
  await page.addInitScript(() => {
    (window as unknown as { __MF_MAP_STYLE: string }).__MF_MAP_STYLE =
      '/map/empty-style.json';
  });
  await page.route('**/api/v1/places?*', (route: Route) =>
    route.fulfill({
      body: JSON.stringify(answer.body),
      contentType: 'application/json',
      status: answer.status,
    }),
  );
  return outside;
}

// The browser copy is written a moment after the last change.
const keptPlace = (page: Page) =>
  page.evaluate(() => {
    // Not every key holds JSON: the language, for one, is a plain string.
    for (const key of Object.keys(localStorage)) {
      let draft: { data?: { steps?: Record<string, { place?: unknown }> } };
      try {
        draft = JSON.parse(localStorage.getItem(key) ?? 'null');
      } catch {
        continue;
      }
      const found = draft?.data?.steps?.['5']?.place;
      if (found) return found as Record<string, unknown>;
    }
    return null;
  });

async function kept(
  page: Page,
  check: (place: Record<string, unknown>) => boolean,
) {
  await expect
    .poll(async () => {
      const place = await keptPlace(page);
      return place !== null && check(place);
    })
    .toBe(true);
  return (await keptPlace(page)) as Record<string, unknown>;
}

async function noSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test.describe('step 5 of list your garage, the place step', () => {
  test('at 320 px: a chosen suggestion drops the pin, a drag moves it, and both come back after a reload', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    const outside = await stub(page);
    await ready(page, '/ro/list-your-garage');

    await address(page).fill('Str. Ștefan cel Mare 12, Sector 2');
    await step(page)
      .locator('.suggestions button', { hasText: STEFAN.label })
      .click();
    await expect(address(page)).toHaveValue(STEFAN.label);
    await expect(pin(page)).toBeVisible();
    const chosen = await kept(page, (p) => p['lat'] === STEFAN.lat);

    const box = await pin(page).boundingBox();
    if (!box) throw new Error('the pin has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 30,
      box.y + box.height / 2 + 20,
      {
        steps: 5,
      },
    );
    await page.mouse.up();
    const moved = await kept(page, (p) => p['lat'] !== chosen['lat']);
    expect(moved['address']).toBe(STEFAN.label);
    await noSidewaysScroll(page);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(address(page)).toHaveValue(STEFAN.label);
    await expect(pin(page)).toBeVisible();
    await kept(
      page,
      (p) => p['lat'] === moved['lat'] && p['lng'] === moved['lng'],
    );
    expect(outside).toEqual([]);
  });

  test('says the address search is down and the manual pin still places the position', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await stub(page, { body: { code: 'search_unavailable' }, status: 503 });
    await ready(page, '/ro/list-your-garage');

    await address(page).fill('Bulevardul Nicăieri 7');
    await expect(step(page)).toContainText('Căutarea adresei nu merge acum');
    await step(page)
      .getByRole('button', { name: 'Pune pinul pe hartă' })
      .click();
    await step(page).locator('.map canvas').click();

    await expect(pin(page)).toBeVisible();
    await kept(
      page,
      (p) =>
        p['address'] === 'Bulevardul Nicăieri 7' &&
        typeof p['lat'] === 'number',
    );
  });

  test('a mobile mechanic gives the seat and 35 km, and finds both after a reload', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await stub(page);
    await ready(page, '/ro/list-your-garage');
    await page
      .locator('mf-details-step')
      .getByRole('group', { name: 'Tipul afacerii' })
      .getByRole('button', { exact: true, name: 'Mecanic mobil' })
      .click();

    await expect(step(page).getByLabel('Sediul înregistrat')).toBeVisible();
    await expect(radius(page)).toHaveValue('20');
    for (const refused of ['0', '101', '12.5']) {
      await radius(page).fill(refused);
      await expect(radius(page)).toHaveAttribute('aria-invalid', 'true');
    }
    await radius(page).fill('35');
    await expect(radius(page)).not.toHaveAttribute('aria-invalid', 'true');
    await kept(page, (p) => p['radiusKm'] === 35);
    await noSidewaysScroll(page);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(step(page).getByLabel('Sediul înregistrat')).toBeVisible();
    await expect(radius(page)).toHaveValue('35');
  });
});

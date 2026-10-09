import { expect, type Page, type Route } from '@playwright/test';

import { ownMap, ready } from './accounts.js';
import { COLLECTOR, test } from './fixtures.js';

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
    // The telemetry collector is answered by the fixture, so it never leaves.
    if (
      ![own, 'localhost', '127.0.0.1'].includes(hostname) &&
      !request.url().startsWith('data:') &&
      !COLLECTOR.test(request.url())
    )
      outside.push(hostname);
  });
  await ownMap(page);
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

// Read from the live map, which the page exposes under the test style only.
const framing = (page: Page, km: number) =>
  page.evaluate(
    ({ km, at }) => {
      type Point = { x: number; y: number };
      const map = (
        window as unknown as {
          __MF_MAP: {
            getBounds(): { contains(at: [number, number]): boolean };
            getContainer(): HTMLElement;
            getZoom(): number;
            project(at: [number, number]): Point;
          };
        }
      ).__MF_MAP;
      const dLat = km / 111.32;
      const dLng = km / (111.32 * Math.cos((at.lat * Math.PI) / 180));
      const corners: [number, number][] = [
        [at.lng - dLng, at.lat - dLat],
        [at.lng + dLng, at.lat + dLat],
      ];
      const [west, east] = corners.map((c) => map.project(c));
      const { clientHeight, clientWidth } = map.getContainer();
      return {
        filled:
          Math.abs(east.x - west.x) >= Math.min(clientWidth, clientHeight) / 2,
        inside: corners.every((c) => map.getBounds().contains(c)),
        zoom: map.getZoom(),
      };
    },
    { at: { lat: STEFAN.lat, lng: STEFAN.lng }, km },
  );

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

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`at 320 px in ${colorScheme} a mobile mechanic sees the whole service circle, refitted when the radius changes, and keeps their own zoom`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ height: 640, width: 320 });
      await stub(page);
      await ready(page, '/ro/list-your-garage');
      await page
        .locator('mf-details-step')
        .getByRole('group', { name: 'Tipul afacerii' })
        .getByRole('button', { exact: true, name: 'Mecanic mobil' })
        .click();

      await address(page).fill('Str. Ștefan cel Mare 12, Sector 2');
      await step(page)
        .locator('.suggestions button', { hasText: STEFAN.label })
        .click();
      await expect(pin(page)).toBeVisible();
      await expect
        .poll(() => framing(page, 20))
        .toMatchObject({ filled: true, inside: true });
      const atDefault = await framing(page, 20);
      expect(atDefault.zoom).toBeLessThan(16);

      await radius(page).fill('100');
      await expect
        .poll(() => framing(page, 100))
        .toMatchObject({ filled: true, inside: true });
      expect((await framing(page, 100)).zoom).toBeLessThan(atDefault.zoom);

      await radius(page).fill('1');
      await expect
        .poll(() => framing(page, 1))
        .toMatchObject({ filled: true, inside: true });
      expect((await framing(page, 1)).zoom).toBeGreaterThan(atDefault.zoom);

      await page.evaluate(() =>
        (
          window as unknown as {
            __MF_MAP: { jumpTo(o: { zoom: number }): void };
          }
        ).__MF_MAP.jumpTo({ zoom: 8 }),
      );
      const box = await pin(page).boundingBox();
      if (!box) throw new Error('the pin has no box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 30,
        box.y + box.height / 2,
        {
          steps: 5,
        },
      );
      await page.mouse.up();
      await kept(page, (p) => p['lng'] !== STEFAN.lng);
      expect((await framing(page, 1)).zoom).toBe(8);
      await noSidewaysScroll(page);
    });
  }
});

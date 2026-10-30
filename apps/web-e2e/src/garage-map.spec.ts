import { expect, type Page } from '@playwright/test';

import { hydrated, ownMap } from './accounts.js';
import { test } from './fixtures.js';

const PROFILE = '/ro/garages/service-auto-militari';

const where = (page: Page) => page.locator('section[data-slot="where"]');
const map = (page: Page) => where(page).locator('mf-garage-map');
const still = (page: Page) => map(page).locator('mf-static-map');
const directions = (page: Page) => where(page).locator('a.directions');

// The garage's point as the public answer carries it.
async function pointOf(page: Page) {
  const answer = await page.request.get(
    '/api/v1/garages/service-auto-militari',
  );
  expect(answer.ok()).toBe(true);
  const { latitude, longitude } = (await answer.json()) as {
    latitude: number;
    longitude: number;
  };
  return { latitude, longitude };
}

// The view the static image was asked for.
async function asked(page: Page) {
  const src = (await still(page).locator('img').getAttribute('src')) ?? '';
  const query = new URL(src, 'http://local').searchParams;
  return {
    lat: Number(query.get('lat')),
    lng: Number(query.get('lng')),
    zoom: Number(query.get('z')),
  };
}

const sideways = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

type Box = { x: number; y: number; width: number; height: number } | null;
const within = (box: Box, part: Box) =>
  !!box &&
  !!part &&
  part.x >= box.x &&
  part.y >= box.y &&
  part.x + part.width <= box.x + box.width + 0.5 &&
  part.y + part.height <= box.y + box.height + 0.5;

// @traces 1366-FR-014
test.describe('the garage on a small map, with directions', () => {
  test.beforeEach(async ({ page }) => {
    await ownMap(page);
  });

  test('links the directions to the garage’s point, on a computer in a new tab', async ({
    page,
  }) => {
    const { latitude, longitude } = await pointOf(page);
    await hydrated(page, PROFILE);

    await expect(directions(page)).toHaveText(/Arată traseul/);
    await expect(directions(page)).toHaveAttribute(
      'href',
      `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
    );
    await expect(directions(page)).toHaveAttribute('target', '_blank');
  });

  test('loads one static image at zoom 15 and no MapLibre until asked', async ({
    page,
  }) => {
    const statics: string[] = [];
    const libre: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/v1/maps/static')) statics.push(url);
      if (/maplibre-gl/i.test(url)) libre.push(url);
    });
    await hydrated(page, PROFILE);

    await expect(still(page).locator('img')).toBeVisible();
    await expect(still(page).locator('.overlay .here')).toHaveCount(1);
    expect(statics).toHaveLength(1);
    expect(new URL(statics[0]).searchParams.get('z')).toBe('15');
    expect(libre).toHaveLength(0);
    await expect(map(page).locator('canvas')).toHaveCount(0);
  });

  test('opens the interactive map on a tap at the garage, zoom 15, with cooperative gestures', async ({
    page,
  }) => {
    await hydrated(page, PROFILE);
    await expect(still(page).locator('img')).toBeVisible();
    const view = await asked(page);

    await still(page).click({ position: { x: 24, y: 100 } });
    await still(page).waitFor({ state: 'detached' });
    await expect
      .poll(() => page.evaluate(() => '__MF_MAP' in window))
      .toBe(true);
    const at = await page.evaluate(() => {
      const live = (
        window as unknown as {
          __MF_MAP: {
            getCenter(): { lat: number; lng: number };
            getZoom(): number;
            cooperativeGestures: { isEnabled(): boolean };
          };
        }
      ).__MF_MAP;
      const { lat, lng } = live.getCenter();
      return {
        cooperative: live.cooperativeGestures.isEnabled(),
        lat,
        lng,
        zoom: live.getZoom(),
      };
    });

    expect(view.zoom).toBe(15);
    expect(at.zoom).toBeCloseTo(15, 5);
    expect(at.lat).toBeCloseTo(view.lat, 4);
    expect(at.lng).toBeCloseTo(view.lng, 4);
    expect(at.cooperative).toBe(true);
  });

  test('scrolls the page under a wheel over the static map, and opens nothing', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 700, width: 390 });
    await hydrated(page, PROFILE);
    await still(page).scrollIntoViewIfNeeded();
    await expect(still(page).locator('img')).toBeVisible();
    const before = await page.evaluate(() => window.scrollY);
    const box = await still(page).boundingBox();

    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    await page.mouse.wheel(0, 200);

    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(before);
    await expect(still(page)).toBeVisible();
    expect(await page.evaluate(() => '__MF_MAP' in window)).toBe(false);
  });

  test('drops the map box when the image cannot load, keeping the directions', async ({
    page,
  }) => {
    const { latitude, longitude } = await pointOf(page);
    await page.route('**/api/v1/maps/static**', (route) => route.abort());
    await hydrated(page, PROFILE);

    await expect(map(page)).toHaveCount(0);
    await expect(directions(page)).toHaveAttribute(
      'href',
      `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
    );
    // The rest of the section stays (the seeded garage has no address line).
    await expect(
      where(page).getByRole('heading', { level: 2, name: 'Unde' }),
    ).toBeVisible();
    await expect(
      where(page).locator('[role="alert"], [role="status"], [aria-live]'),
    ).toHaveCount(0);
  });

  test('keeps the control and the credit inside the box at 320 px, with no sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 320 });
    await hydrated(page, PROFILE);
    await expect(still(page).locator('img')).toBeVisible();
    const box = await map(page).boundingBox();
    const control = await still(page).getByRole('button').boundingBox();
    const credit = await still(page).locator('.attribution').boundingBox();

    expect(box?.height).toBeCloseTo(200, 0);
    for (const part of [control, credit]) expect(within(box, part)).toBe(true);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(
      (await directions(page).boundingBox())?.height ?? 0,
    ).toBeGreaterThanOrEqual(44);
  });
});

const MOBILE = '/ro/garages/mecanic-mobil-cluj';

// The seeded mobile mechanic's area, round its centre in Cluj.
// @traces 1383-FR-010
test.describe('a mobile mechanic’s area on a small map', () => {
  test.beforeEach(async ({ page }) => {
    await ownMap(page);
  });

  test('draws one plain circle in the strip, with no pin, no address and no directions, and no MapLibre until asked', async ({
    page,
  }) => {
    const statics: string[] = [];
    const libre: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/v1/maps/static')) statics.push(url);
      if (/maplibre-gl/i.test(url)) libre.push(url);
    });
    await hydrated(page, MOBILE);

    await expect(still(page).locator('img')).toBeVisible();
    await expect(still(page).locator('.overlay .area')).toHaveCount(1);
    await expect(still(page).locator('.overlay .here')).toHaveCount(0);
    await expect(still(page).locator('.overlay .pin')).toHaveCount(0);
    await expect(directions(page)).toHaveCount(0);
    await expect(where(page).locator('.address')).toHaveCount(0);
    expect(statics).toHaveLength(1);
    expect(libre).toHaveLength(0);
  });

  test('keeps the whole circle inside the box at 320 px, with no sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 320 });
    await hydrated(page, MOBILE);
    await expect(still(page).locator('img')).toBeVisible();
    const box = await map(page).boundingBox();
    const circle = await still(page).locator('.overlay .area').boundingBox();

    expect(within(box, circle)).toBe(true);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

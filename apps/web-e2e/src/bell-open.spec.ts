import { expect, type Page } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

const CAR = '6f1c2a3e-1d4b-4a8e-9c1f-2b3d4e5f6a7b';
const OTHER = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const ITP = 'ITP-ul la Dacia Logan expiră pe 10 dec. 2026';

const car = (id: string, model: string) => ({
  brandId: '11111111-1111-4111-8111-111111111111',
  brandName: 'Dacia',
  createdAt: '2026-01-01T00:00:00.000Z',
  engine: null,
  fuel: 'petrol',
  id,
  itpUntil: '2026-12-10',
  model,
  odometerKm: 90000,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  year: 2018,
});

const row = (id: string, kind: string, text: string, link: string | null) => ({
  at: new Date().toISOString(),
  id,
  kind,
  link,
  readAt: null,
  subjectId: null,
  text,
});

// A driver with two cars, the second one named by an ITP reminder in the
// bell, and a test message that opens nothing.
async function driverWithReminder(page: Page) {
  await signInAs(page, 'driver', '/app/driver', ['driver.cars']);
  const reads: string[] = [];
  await page.route('**/api/v1/cars', (route) =>
    route.fulfill({
      json: { items: [car(OTHER, 'Sandero'), car(CAR, 'Logan')] },
    }),
  );
  await page.route('**/api/v1/notifications/unread-count', (route) =>
    route.fulfill({ json: { count: 2 } }),
  );
  await page.route('**/api/v1/notifications?*', (route) =>
    route.fulfill({
      json: {
        items: [
          row('n-itp', 'DUE_ITP', ITP, `/app/driver/cars/${CAR}`),
          row(
            'n-test',
            'TEST_MESSAGE',
            'Mesaj de test: notificările funcționează.',
            null,
          ),
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route('**/api/v1/notifications/*/read', (route) => {
    const id = route.request().url().split('/').at(-2) ?? '';
    reads.push(id);
    const [kind, text, link] =
      id === 'n-itp'
        ? ['DUE_ITP', ITP, `/app/driver/cars/${CAR}`]
        : ['TEST_MESSAGE', 'Mesaj de test: notificările funcționează.', null];
    return route.fulfill({
      json: { ...row(id, kind, text, link), readAt: new Date().toISOString() },
    });
  });
  return reads;
}

async function openBell(page: Page) {
  await page.goto('/app/driver');
  await settled(page);
  await page.getByRole('button', { name: /^Notificări/ }).click();
  return page.getByRole('dialog', { name: 'Notificări' });
}

// @traces 032-FR-003 032-FR-004 032-FR-008
test.describe('opening a notification from the bell', () => {
  for (const [label, size] of [
    ['a desktop', { height: 900, width: 1280 }],
    ['a 390 px phone', { height: 844, width: 390 }],
    ['a 320 px phone', { height: 640, width: 320 }],
  ] as const) {
    test(`takes the driver to the car an ITP reminder names, on ${label}`, async ({
      page,
    }) => {
      const reads = await driverWithReminder(page);
      await page.setViewportSize(size);
      const list = await openBell(page);
      await expect(list).toBeVisible();

      await list.getByRole('button', { name: new RegExp(ITP) }).click();

      await expect(list).toBeHidden();
      await expect(page).toHaveURL(`/app/driver/cars/${CAR}`);
      const logan = page.locator('[data-car]', { hasText: 'Dacia Logan' });
      await expect(logan).toBeFocused();
      await expect(logan).toBeInViewport();
      expect(reads).toEqual(['n-itp']);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }

  // @traces 032-FR-002
  test('only marks read a row that opens nothing, and keeps the list open', async ({
    page,
  }) => {
    const reads = await driverWithReminder(page);
    await page.setViewportSize({ height: 844, width: 390 });
    const list = await openBell(page);

    await list.getByRole('button', { name: /Mesaj de test/ }).click();

    await expect.poll(() => reads).toEqual(['n-test']);
    await expect(list).toBeVisible();
    await expect(page).toHaveURL('/app/driver');
  });
});

import { expect } from '@playwright/test';

import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

for (const [role, landing] of [
  ['driver', '/app/driver'],
  ['garage', '/app/garage'],
  ['receptionist', '/app/garage'],
  ['mechanic', '/app/garage'],
  ['admin', '/app/admin'],
] as const) {
  test(`a ${role} lands on the ${landing} frame`, async ({ page }) => {
    await signInAs(page, role, landing);

    await page.goto(landing);

    await expect(page).toHaveURL(landing);
    await expect(page.getByRole('navigation', { name: 'Meniu' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Ieși din cont' }),
    ).toBeVisible();
    await expect(page.getByText(/vezi ca/i)).toHaveCount(0);
  });
}

test('a driver who types /app/admin ends on /app/driver', async ({ page }) => {
  await signInAs(page, 'driver', '/app/driver');

  await page.goto('/app/admin');

  await expect(page).toHaveURL('/app/driver');
});

test('a signed-out visitor typing a dashboard address ends on Home', async ({
  page,
}) => {
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: { code: 'sign_in_required', status: 401 },
      status: 401,
    }),
  );

  await page.goto('/app/garage');

  await expect(page).toHaveURL(/\/ro\/?$/);
});

// The view's title keeps the same inset as the view's cards, on a phone and
// on a desktop.
for (const [label, size] of [
  ['a 320 px phone', { height: 640, width: 320 }],
  ['a 390 px phone', { height: 844, width: 390 }],
  ['a desktop', { height: 900, width: 1280 }],
] as const) {
  test(`the driver's title lines up with the cards on ${label}`, async ({
    page,
  }) => {
    await signInAs(page, 'driver', '/app/driver', ['driver.cars']);
    await page.route('**/api/v1/cars', (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    await page.setViewportSize(size);

    await page.goto('/app/driver/cars');

    const title = page.getByRole('heading', { level: 1 });
    const view = page.locator('main > :not(router-outlet)').first();
    await expect(title).toBeVisible();
    const [titleBox, viewBox] = await Promise.all([
      title.boundingBox(),
      view.boundingBox(),
    ]);
    expect(viewBox?.x).toBeGreaterThan(0);
    expect(titleBox?.x).toBeCloseTo(viewBox?.x ?? -1, 0);
  });
}

// A driver with no cars sees the add button centred under the empty state's
// text, as the requests view centres its own.
test('the empty cars view centres its add button under the text', async ({
  page,
}) => {
  await signInAs(page, 'driver', '/app/driver', ['driver.cars']);
  await page.route('**/api/v1/cars', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.setViewportSize({ height: 900, width: 1280 });

  await page.goto('/app/driver/cars');

  const empty = page.locator('mf-empty-state');
  const add = empty.getByRole('button');
  const text = empty.locator('p');
  await expect(add).toBeVisible();
  const [addBox, textBox] = await Promise.all([
    add.boundingBox(),
    text.boundingBox(),
  ]);
  const middle = (b: { x: number; width: number } | null) =>
    b ? b.x + b.width / 2 : -1;
  expect(middle(addBox)).toBeCloseTo(middle(textBox), 0);
});

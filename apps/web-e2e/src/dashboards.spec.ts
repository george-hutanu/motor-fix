import { expect, type Page, test } from '@playwright/test';

// Real sign-in is not built yet, so the API's "who am I" answer is stubbed.
async function signInAs(
  page: Page,
  role: string,
  landing: string,
  capabilities: string[] = [],
) {
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        capabilities,
        email: `${role}@example.ro`,
        garageId: landing === '/app/garage' ? 'garage-1' : null,
        id: `${role}-1`,
        landing,
        language: 'ro',
        name: `Test ${role}`,
        role,
        roles: [role],
      },
    }),
  );
}

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

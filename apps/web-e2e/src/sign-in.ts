import type { Page } from '@playwright/test';

// Real sign-in is not built yet, so the API's "who am I" answer is stubbed.
export async function signInAs(
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

import type { Page } from '@playwright/test';

// For layout tests that only need a signed-in frame: the renewal, the "who
// am I" answer and the admin overview (none waiting) are stubbed. sign-in.spec.ts signs in for real.
export async function signInAs(
  page: Page,
  role: string,
  landing: string,
  capabilities: string[] = [],
) {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ json: { accessToken: 'stubbed' } }),
  );
  await page.route('**/api/v1/admin/overview', (route) =>
    route.fulfill({ json: { garagesWaiting: 0 } }),
  );
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

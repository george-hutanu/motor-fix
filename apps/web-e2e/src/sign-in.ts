import type { Page } from '@playwright/test';

// For layout tests that only need a signed-in frame: the renewal, the "who
// am I" answer, the admin overview (none waiting) and the garage's request
// list (empty) are stubbed. sign-in.spec.ts signs in for real.
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
  await page.route('**/api/v1/garage/requests*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null, total: 0 } }),
  );
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        capabilities,
        email: `${role}@example.ro`,
        garageAccess: [],
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

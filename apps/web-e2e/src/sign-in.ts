import type { Page } from '@playwright/test';

// For layout tests that only need a signed-in frame: the renewal, the "who
// am I" answer, the admin overview (none waiting) and the garage's request
// list (empty) are stubbed. sign-in.spec.ts signs in for real.
export async function signInAs(
  page: Page,
  role: string,
  landing: string,
  capabilities: string[] = [],
  language: 'ro' | 'en' = 'ro',
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
  // The stubbed garage-1 is in no database: its profile read would answer a
  // gone status and the profile view would send the page to /app/garage.
  // Unavailable keeps the view, and the frame around it, where it is.
  await page.route('**/api/v1/garages/*/profile', (route) =>
    route.fulfill({ status: 503 }),
  );
  // A language switch is saved on the account and kept on the next load.
  let current = language;
  await page.route('**/api/v1/me', (route) => {
    if (route.request().method() === 'PATCH')
      current = (route.request().postDataJSON() as { language: 'ro' | 'en' })
        .language;
    return route.fulfill({
      json: {
        capabilities,
        email: `${role}@example.ro`,
        garageAccess: [],
        garageId: landing === '/app/garage' ? 'garage-1' : null,
        id: `${role}-1`,
        landing,
        language: current,
        name: `Test ${role}`,
        role,
        roles: [role],
      },
    });
  });
}

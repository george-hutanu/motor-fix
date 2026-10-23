import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// The seeded driver with a Dacia Logan saves the seeded Service Auto Militari,
// which works on Dacia and has an oil change on its price list, then asks it
// for a quote straight from Service-uri salvate. Each test saves it through
// the API, which is idempotent, and nothing removes it: the tests run in
// parallel, and one test's removal took the row from under another.
const DRIVER = 'cerere@example.test';
const SLUG = 'service-auto-militari';
const GARAGE = 'Service Auto Militari';
const OIL = 'Schimb de ulei și filtre';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signedInDriver(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, DRIVER);
  await expect(page).toHaveURL('/app/driver');
}

async function driverHeaders(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email: DRIVER, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

test.describe('a quote request from a saved garage @seeded', () => {
  let garageId = '';

  test.beforeEach(async ({ request }) => {
    const profile = await request.get(`/api/v1/garages/${SLUG}`);
    expect(profile.ok()).toBe(true);
    garageId = ((await profile.json()) as { id: string }).id;
    const saved = await request.put(`/api/v1/me/saved-garages/${garageId}`, {
      headers: await driverHeaders(request),
    });
    expect(saved.ok()).toBe(true);
  });
  // @traces 292-FR-001 292-FR-004 292-FR-006 292-FR-009
  test('goes out from the saved row to the garage, named saved, and shows in Cererile mele', async ({
    page,
  }) => {
    await signedInDriver(page);
    // The list keeps the live stream open, so networkidle never comes: wait
    // for the row itself.
    await page.goto('/app/driver/saved');
    const row = page.locator('mf-saved-garage-row', { hasText: GARAGE });
    await row
      .getByRole('button', { exact: true, name: `Cere ofertă de la ${GARAGE}` })
      .click();

    const quote = page.getByRole('dialog', { name: 'Cere ofertă' });
    await expect(
      quote.getByRole('combobox', { exact: true, name: 'Mașina' }),
    ).toContainText('Dacia Logan');
    await quote.getByRole('switch', { name: OIL }).click();
    const sent = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/quote-requests') &&
        r.request().method() === 'POST',
    );
    await quote.getByRole('button', { name: 'Trimite' }).click();
    const response = await sent;
    expect(response.status()).toBe(201);
    const body = response.request().postDataJSON() as {
      garageIds: string[];
      sources: string[];
    };
    expect(body.garageIds[0]).toBe(garageId);
    expect(body.sources[0]).toBe('saved');
    await expect(quote.getByText(`Trimis către ${GARAGE}.`)).toBeVisible();

    await quote.getByRole('link', { name: 'Vezi Cererile mele' }).click();
    await expect(page).toHaveURL('/app/driver/requests');
    const newest = page.locator('[data-request]').first();
    await expect(newest).toContainText('Dacia Logan');
    await expect(newest).toContainText(OIL);
  });

  // @traces 292-FR-001 292-FR-008
  for (const scheme of ['light', 'dark'] as const) {
    test(`the row with its button fits a 320 px phone, ${scheme}, with no sideways scroll`, async ({
      page,
    }) => {
      // Signed in at the desktop size, where the header carries Autentificare.
      await signedInDriver(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 800, width: 320 });
      await page.goto('/app/driver/saved');
      const button = page
        .locator('mf-saved-garage-row', { hasText: GARAGE })
        .getByRole('button', {
          exact: true,
          name: `Cere ofertă de la ${GARAGE}`,
        });
      await expect(button).toBeVisible();

      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});

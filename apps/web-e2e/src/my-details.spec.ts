// @traces 139-edit-my-details-FR-001
// @traces 139-edit-my-details-FR-002
// @traces 139-edit-my-details-FR-004
import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const SETTINGS = '/app/driver/settings';
const ME = '/api/v1/me';

async function headers(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email: ACCOUNTS.driver, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

// The seeded driver has no city, so the suite can run twice on one database.
async function restore(request: APIRequestContext) {
  const res = await request.patch(ME, {
    data: { city: null },
    headers: await headers(request),
  });
  expect(res.ok()).toBe(true);
}

async function savedCity(request: APIRequestContext) {
  const res = await request.get(ME, { headers: await headers(request) });
  return ((await res.json()) as { city: string | null }).city;
}

// The seeded driver's language is shared with specs running beside this one.
async function speak(page: Page, language: 'RO' | 'EN') {
  await page
    .getByRole('group', { name: /^(Limba|Language)$/ })
    .getByRole('button', { exact: true, name: language })
    .click();
}

async function signedInSettings(page: Page, language: 'RO' | 'EN') {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.driver);
  await expect(page).toHaveURL('/app/driver');
  // The live stream stays open, so the page never goes network-idle.
  await page.goto(SETTINGS);
  await speak(page, language);
}

const TEXT = {
  EN: {
    cancel: 'Cancel',
    city: 'City',
    edit: 'Edit',
    panel: 'Your details',
    save: 'Save',
    saved: 'Saved.',
  },
  RO: {
    cancel: 'Renunță',
    city: 'Oraș',
    edit: 'Modifică',
    panel: 'Datele tale',
    save: 'Salvează',
    saved: 'Am salvat.',
  },
} as const;

const SIZES = [
  { height: 640, name: '320 px phone', width: 320 },
  { height: 844, name: '390 px phone', width: 390 },
  { height: 900, name: 'desktop', width: 1280 },
] as const;

test.describe("the driver's details @seeded", () => {
  // Every test signs in as the same driver and resets the same row.
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ request }) => restore(request));
  test.afterEach(async ({ request }) => restore(request));

  for (const size of SIZES) {
    for (const language of ['RO', 'EN'] as const) {
      test(`changes the city and shows it at once on a ${size.name}, in ${language}`, async ({
        page,
        request,
      }) => {
        const text = TEXT[language];
        const city = language === 'RO' ? 'Cluj-Napoca' : 'Brașov';
        await page.setViewportSize({ height: size.height, width: size.width });
        await signedInSettings(page, language);

        const panel = page.getByRole('region', {
          exact: true,
          name: text.panel,
        });
        await expect(panel).toBeVisible();
        await panel
          .getByRole('button', { exact: true, name: text.edit })
          .click();
        const field = panel.getByRole('textbox', {
          exact: true,
          name: text.city,
        });
        await field.fill(city);
        await panel
          .getByRole('button', { exact: true, name: text.save })
          .click();

        await expect(page.getByText(text.saved)).toBeVisible();
        await expect(field).toBeHidden();
        await expect(panel.getByText(city, { exact: true })).toBeVisible();
        expect(await savedCity(request)).toBe(city);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          ),
        ).toBeLessThanOrEqual(0);

        await page.reload();
        await expect(panel.getByText(city, { exact: true })).toBeVisible();
        if (language === 'EN') await speak(page, 'RO');
      });
    }
  }

  test('puts the saved city back on Cancel', async ({ page, request }) => {
    await signedInSettings(page, 'RO');
    const panel = page.getByRole('region', {
      exact: true,
      name: 'Datele tale',
    });

    await panel.getByRole('button', { exact: true, name: 'Modifică' }).click();
    await panel
      .getByRole('textbox', { exact: true, name: 'Oraș' })
      .fill('Sibiu');
    await panel.getByRole('button', { exact: true, name: 'Renunță' }).click();

    await expect(panel.getByText('Sibiu', { exact: true })).toBeHidden();
    await expect(
      panel.getByRole('button', { exact: true, name: 'Modifică' }),
    ).toBeFocused();
    expect(await savedCity(request)).toBeNull();
  });
});

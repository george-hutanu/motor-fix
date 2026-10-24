import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { headers, ready, signIn, signUpDriver } from './accounts.js';
import { test } from './fixtures.js';

const SETTINGS = '/app/driver/settings';
const PREFERENCES = '/api/v1/notification-preferences';
// The seeded driver with a confirmed phone, so SMS and WhatsApp can be picked.
const WITH_PHONE = 'cerere@example.test';

// ITP and tyres back on e-mail, so the suite can run twice on one database.
async function restore(request: APIRequestContext) {
  const saved = await request.put(PREFERENCES, {
    data: {
      preferences: ['DUE_ITP', 'TYRES_SEASON'].map((type) => ({
        channel: 'email',
        enabled: true,
        garageId: null,
        type,
      })),
    },
    headers: await headers(request, WITH_PHONE),
  });
  expect(saved.ok(), await saved.text()).toBe(true);
}

async function settings(page: Page, email: string) {
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/driver');
  await page.goto(SETTINGS);
  const language = page.getByRole('group', { name: /^(Limba|Language)$/ });
  await language.getByRole('button', { exact: true, name: 'RO' }).click();
  await page
    .getByRole('button', { name: /Scadențe/ })
    .and(page.locator('[aria-controls="driver-notifications-due_dates-types"]'))
    .click();
}

const picker = (page: Page, name: string) =>
  page.getByRole('radiogroup', { exact: true, name });

const saving = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith(PREFERENCES) && r.request().method() === 'PUT',
  );

// @traces 142-FR-010
test.describe("the channel of each driver's notification type @seeded", () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ request }) => restore(request));
  test.afterEach(async ({ request }) => restore(request));

  test('WhatsApp for ITP and SMS for tyres are saved and read back on a second page', async ({
    browser,
    page,
  }) => {
    await settings(page, WITH_PHONE);

    let saved = saving(page);
    await picker(page, 'ITP').getByText('WhatsApp', { exact: true }).click();
    expect((await saved).ok()).toBe(true);
    saved = saving(page);
    await picker(page, 'Anvelope').getByText('SMS', { exact: true }).click();
    expect((await saved).ok()).toBe(true);

    const other = await browser.newPage();
    await settings(other, WITH_PHONE);
    await expect(
      picker(other, 'ITP').getByRole('radio', { name: 'WhatsApp' }),
    ).toBeChecked({ timeout: 5_000 });
    await expect(
      picker(other, 'Anvelope').getByRole('radio', { name: 'SMS' }),
    ).toBeChecked({ timeout: 5_000 });
    await other.close();
  });

  test('without a confirmed phone SMS and WhatsApp cannot be picked, and the hint says why', async ({
    page,
    request,
  }) => {
    const email = await signUpDriver(request, 'canale');
    await settings(page, email);

    const itp = picker(page, 'ITP');
    await expect(itp.getByRole('radio', { name: 'SMS' })).toBeDisabled();
    await expect(itp.getByRole('radio', { name: 'WhatsApp' })).toBeDisabled();
    await expect(itp.getByRole('radio', { name: 'E‑mail' })).toBeEnabled();
    await expect(
      page.getByText('Adaugă și confirmă numărul de telefon în Datele tale.'),
    ).toBeVisible();
  });
});

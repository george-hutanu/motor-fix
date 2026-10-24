import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

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

// This month in Bucharest, as the SMS counter keys it.
const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', {
    month: '2-digit',
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
  })
    .format(new Date())
    .slice(0, 7);

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

  test("once the month's 5 SMS are used, the panel says the next ones go by WhatsApp", async ({
    page,
    request,
  }) => {
    test.skip(
      !process.env['DATABASE_URL'],
      "writes a driver's SMS count straight to PostgreSQL, which needs DATABASE_URL",
    );
    const email = await signUpDriver(request, 'sms-cinci');
    const db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    try {
      await db.query(
        `INSERT INTO sms_counter (account_id, month, sent_count)
         SELECT id, $2, 5 FROM account WHERE email = $1`,
        [email, thisMonth()],
      );
      await settings(page, email);

      await expect(
        page.getByText(
          'Ai folosit 5 din 5 SMS luna aceasta; următoarele merg pe WhatsApp.',
        ),
      ).toBeVisible();
    } finally {
      await db.query('DELETE FROM account WHERE email = $1', [email]);
      await db.end();
    }
  });
});

// SC-004: every group opened with its pickers, at each size, scheme and
// language, with no sideways scroll; the screenshots go to the report.
async function openedPickers(page: Page, email: string) {
  // Only this panel's disclosures, each awaited open before the next.
  const toggles = page.locator(
    'button[aria-controls^="driver-notifications-"]',
  );
  for (const toggle of await toggles.all()) {
    if ((await toggle.getAttribute('aria-expanded')) === 'true') continue;
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  const itp = picker(page, 'ITP');
  await expect(itp.getByRole('radio', { name: email })).toBeVisible();
  await expect(itp.getByRole('radio', { name: 'WhatsApp' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

test.describe('the opened channel pickers at every size @seeded', () => {
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [768, 1024],
    [1280, 800],
  ]) {
    test(`each group opens with its pickers and no sideways scroll at ${width} px`, async ({
      page,
    }, testInfo) => {
      // Four looks, each with a full-page screenshot.
      test.setTimeout(120_000);
      // Signed in on a desktop, where the banner shows the sign-in button.
      await settings(page, WITH_PHONE);
      await page.setViewportSize({ height, width });
      const language = page.getByRole('group', {
        name: /^(Limba|Language)$/,
      });
      for (const [lang, email] of [
        ['RO', 'E‑mail'],
        ['EN', 'E-mail'],
      ] as const) {
        await language.getByRole('button', { exact: true, name: lang }).click();
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme });
          await openedPickers(page, email);
          await testInfo.attach(`pickers-${width}-${colorScheme}-${lang}`, {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
        }
      }
    });
  }
});

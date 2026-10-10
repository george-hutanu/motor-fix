// @traces 139-edit-my-details-FR-001
// @traces 139-edit-my-details-FR-002
// @traces 139-edit-my-details-FR-004
// @traces 139-edit-my-details-FR-006
// @traces 139-edit-my-details-FR-008
import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
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

// The change link as the worker sent it, read from the test mailbox the local
// run starts (mailbox.mjs); a deployed address has none, so the config leaves
// out flows tagged @mailbox there.
const MAILBOX = 'http://127.0.0.1:3025';
const CHANGE_LINK = /https?:\/\/[^\s"<>]+\/confirm-email\/[A-Za-z0-9_-]{43}/;
// A fake password for the accounts these tests create; never a real one.
const OWN_PASSWORD = 'parola-de-test-schimbare';

async function changeLink(page: Page, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILBOX}/messages?to=${encodeURIComponent(email)}`,
        );
        const sent: { textContent: string }[] = await res.json();
        link = sent
          .map((m) => CHANGE_LINK.exec(m.textContent)?.[0])
          .filter(Boolean)
          .at(-1);
        return link;
      },
      { message: 'no change link sent', timeout: 20_000 },
    )
    .toBeDefined();
  return new URL(String(link)).pathname;
}

const unique = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

test.describe('changing the e-mail address @seeded @mailbox', () => {
  for (const size of SIZES) {
    test(`moves the account to the new address through its link on a ${size.name}`, async ({
      browser,
      page,
    }) => {
      const old = unique('schimbare-veche');
      const fresh = unique('schimbare-noua');
      const created = await page.request.post('/api/v1/auth/sign-up', {
        data: {
          consent: CURRENT_CONSENT,
          email: old,
          language: 'ro',
          name: 'Andrei Schimbare',
          password: OWN_PASSWORD,
        },
        headers: { 'x-forwarded-for': `203.0.113.${Date.now() % 250}` },
      });
      expect(created.status()).toBe(201);
      await page.context().clearCookies();
      await page.setViewportSize({ height: size.height, width: size.width });

      await ready(page, '/ro');
      await page
        .getByRole('button', { exact: true, name: 'Autentificare' })
        .click();
      await signIn(page, old, { password: OWN_PASSWORD });
      await expect(page).toHaveURL('/app/driver');
      await page.goto(SETTINGS);
      const panel = page.getByRole('region', {
        exact: true,
        name: 'Datele tale',
      });
      await panel
        .getByRole('button', { exact: true, name: 'Schimbă e‑mailul' })
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'Schimbă adresa de e‑mail',
      });
      await dialog.getByLabel('Adresă de e‑mail nouă').fill(fresh);
      await dialog.getByRole('button', { name: 'Trimite linkul' }).click();
      await expect(dialog).toBeHidden();
      await expect(
        panel.getByText(`În așteptarea confirmării: ${fresh}`),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(0);

      const link = await changeLink(page, fresh);
      expect(link).toMatch(/^\/ro\/confirm-email\/[A-Za-z0-9_-]{43}$/);
      await page.goto(link);
      await expect(
        page.getByText('Adresa ta de e‑mail este confirmată.'),
      ).toBeVisible();

      const other = await browser.newContext();
      const again = await other.newPage();
      await again.setViewportSize({ height: size.height, width: size.width });
      await ready(again, '/ro');
      await again
        .getByRole('button', { exact: true, name: 'Autentificare' })
        .click();
      await signIn(again, old, { password: OWN_PASSWORD });
      await expect(
        again.getByText('E‑mailul sau parola nu sunt corecte.'),
      ).toBeVisible();
      await signIn(again, fresh, { password: OWN_PASSWORD });
      await expect(again).toHaveURL('/app/driver');
      await again.goto(SETTINGS);
      await expect(
        again
          .getByRole('region', { exact: true, name: 'Datele tale' })
          .getByText(fresh, { exact: true }),
      ).toBeVisible();
      await other.close();
    });
  }
});

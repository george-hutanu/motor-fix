// @traces 139-FR-001
// @traces 139-FR-002
// @traces 139-FR-004
// @traces 139-FR-006
// @traces 139-FR-008
// @traces 139-FR-011
// @traces 139-FR-013
// @traces 139-FR-014
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

// Below 768 px the header has no sign-in button; the bottom bar's Cont tab
// opens the dialog.
async function openSignIn(page: Page) {
  await ready(page, '/ro/garages');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { name: 'Cont' })
      .click();
  } else {
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
  }
}

async function signedInSettings(page: Page, language: 'RO' | 'EN') {
  await openSignIn(page);
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

      await openSignIn(page);
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
      await openSignIn(again);
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

// The code the nth WhatsApp message to the number carried, from the same
// test mailbox (Brevo's WhatsApp API as mailbox.mjs records it).
async function whatsAppCode(
  page: Page,
  phone: string,
  nth: number,
): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILBOX}/whatsapp?to=${encodeURIComponent(phone.slice(1))}`,
        );
        const sent: { params: string[] }[] = await res.json();
        code = sent[nth - 1]?.params[0];
        return code;
      },
      { message: `no WhatsApp message ${nth} sent`, timeout: 20_000 },
    )
    .toMatch(/^\d{6}$/);
  return String(code);
}

// A number no account holds, under the allow-listed +4070000 prefix and
// outside the seeded ones and the refused +40700009999, new on every run.
const freshPhone = () =>
  `+4070000${String(1000 + Math.floor(Math.random() * 8999))}`;

test.describe('changing the phone number @seeded @mailbox', () => {
  for (const size of SIZES) {
    test(`confirms the new number with its WhatsApp code and signs in with it on a ${size.name}`, async ({
      browser,
      page,
    }) => {
      const email = unique('telefon-nou');
      const phone = freshPhone();
      // As a Romanian types it: 0700 00x xxx.
      const typed = `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`;
      const created = await page.request.post('/api/v1/auth/sign-up', {
        data: {
          consent: CURRENT_CONSENT,
          email,
          language: 'ro',
          name: 'Andrei Telefon',
          password: OWN_PASSWORD,
        },
        headers: { 'x-forwarded-for': `203.0.113.${Date.now() % 250}` },
      });
      expect(created.status()).toBe(201);
      await page.context().clearCookies();
      await page.setViewportSize({ height: size.height, width: size.width });

      await openSignIn(page);
      await signIn(page, email, { password: OWN_PASSWORD });
      await expect(page).toHaveURL('/app/driver');
      await page.goto(SETTINGS);
      const panel = page.getByRole('region', {
        exact: true,
        name: 'Datele tale',
      });
      await panel
        .getByRole('button', { exact: true, name: 'Schimbă numărul' })
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'Schimbă numărul de telefon',
      });
      await dialog.getByLabel('Număr de telefon').fill(typed);
      await dialog.getByRole('button', { name: 'Trimite codul' }).click();
      await dialog.getByLabel('Cod').fill(await whatsAppCode(page, phone, 1));
      await dialog
        .getByRole('button', { exact: true, name: 'Confirmă' })
        .click();
      await expect(dialog).toBeHidden();
      await expect(panel.getByText(phone, { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(0);

      const other = await browser.newContext();
      const again = await other.newPage();
      await again.setViewportSize({ height: size.height, width: size.width });
      await openSignIn(again);
      const signInDialog = again.getByRole('dialog', { name: 'Autentificare' });
      await signInDialog
        .getByRole('button', { name: 'Continuă cu telefonul' })
        .click();
      await signInDialog.getByLabel('Număr de telefon').fill(phone);
      await signInDialog.getByRole('button', { name: 'Trimite codul' }).click();
      await signInDialog
        .getByLabel('Cod')
        .fill(await whatsAppCode(again, phone, 2));
      await signInDialog.getByRole('button', { name: 'Intră în cont' }).click();
      await expect(again).toHaveURL('/app/driver');
      await again.goto(SETTINGS);
      await expect(
        again
          .getByRole('region', { exact: true, name: 'Datele tale' })
          .getByText(email, { exact: true }),
      ).toBeVisible();
      await other.close();
    });
  }
});

const NEW_PASSWORD = 'alta-parola-de-test-e2e';

test.describe('changing the password @seeded', () => {
  for (const size of SIZES) {
    test(`changes the password, stays signed in, and signs in again only with the new one on a ${size.name}`, async ({
      browser,
      page,
    }) => {
      const email = unique('parola-noua');
      const created = await page.request.post('/api/v1/auth/sign-up', {
        data: {
          consent: CURRENT_CONSENT,
          email,
          language: 'ro',
          name: 'Andrei Parola',
          password: OWN_PASSWORD,
        },
        headers: { 'x-forwarded-for': `203.0.113.${Date.now() % 250}` },
      });
      expect(created.status()).toBe(201);
      await page.context().clearCookies();
      await page.setViewportSize({ height: size.height, width: size.width });

      await openSignIn(page);
      await signIn(page, email, { password: OWN_PASSWORD });
      await expect(page).toHaveURL('/app/driver');
      await page.goto(SETTINGS);
      const panel = page.getByRole('region', {
        exact: true,
        name: 'Datele tale',
      });
      await panel
        .getByRole('button', { exact: true, name: 'Schimbă parola' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Schimbă parola' });
      await dialog.getByLabel('Parola actuală').fill(OWN_PASSWORD);
      await dialog.getByLabel('Parola nouă').fill(NEW_PASSWORD);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await dialog
        .getByRole('button', { exact: true, name: 'Schimbă parola' })
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByText(
          'Parola a fost schimbată. Celelalte dispozitive au fost deconectate.',
        ),
      ).toBeVisible();
      // This device stays signed in.
      await page.reload();
      await expect(panel).toBeVisible();
      await expect(page).toHaveURL(SETTINGS);

      const other = await browser.newContext();
      const again = await other.newPage();
      await again.setViewportSize({ height: size.height, width: size.width });
      await openSignIn(again);
      await signIn(again, email, { password: OWN_PASSWORD });
      await expect(
        again.getByText('E‑mailul sau parola nu sunt corecte.'),
      ).toBeVisible();
      await signIn(again, email, { password: NEW_PASSWORD });
      await expect(again).toHaveURL('/app/driver');
      await other.close();
    });
  }
});

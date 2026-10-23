// @traces 129-FR-014 129-FR-015 129-FR-017
import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';

// Each flow deletes an account of its own, never a seeded one other specs
// sign in with.
const PASSWORD = 'stergere-de-cont-2026';

const TEXT = {
  en: {
    button: 'Delete account',
    dialog: 'Delete your account?',
    done: 'Your account was deleted',
    field: 'Type the e‑mail or phone of the account',
    mismatch: 'This does not match the account',
  },
  ro: {
    button: 'Șterge contul',
    dialog: 'Ștergi contul?',
    done: 'Contul tău a fost șters',
    field: 'Scrie e‑mailul sau telefonul contului',
    mismatch: 'Nu se potrivește cu contul',
  },
} as const;

// The `request` fixture signs up from an address of the test's own, so the
// per-address sign-up limit never refuses the flows that follow.
async function newAccount(request: APIRequestContext, language: 'ro' | 'en') {
  const email = `stergere-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const res = await request.post('/api/v1/auth/sign-up', {
    data: {
      consent: CURRENT_CONSENT,
      email,
      language,
      name: 'Andrei Ștergere',
      password: PASSWORD,
    },
  });
  expect(res.status()).toBe(201);
  return email;
}

async function signedIn(page: Page, email: string, password?: string) {
  await ready(page, '/ro');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { exact: true, name: 'Cont' })
      .click();
  } else {
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
  }
  await signIn(page, email, password ? { password } : {});
  await expect(page).toHaveURL(/\/app\//);
}

// The settings screen keeps the live stream open, so networkidle may never
// come: the row's button being there is what the flow needs.
async function settings(page: Page, path: string, button: string) {
  await page.goto(path);
  await expect(
    page.getByRole('button', { exact: true, name: button }),
  ).toBeVisible();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const [label, viewport] of [
  ['a phone', { height: 844, width: 390 }],
  ['a desktop', { height: 900, width: 1440 }],
] as const) {
  // @seeded: needs the real API and its database, not stubs.
  test.describe(`deleting my account on ${label} @seeded`, () => {
    test.use({ viewport });

    for (const language of ['ro', 'en'] as const) {
      test(`a driver deletes the account in ${language} and lands on Home`, async ({
        page,
        request,
      }) => {
        const text = TEXT[language];
        const email = await newAccount(request, language);
        await signedIn(page, email, PASSWORD);
        await settings(page, '/app/driver/settings', text.button);

        await page
          .getByRole('button', { exact: true, name: text.button })
          .click();
        const dialog = page.getByRole('dialog', { name: text.dialog });
        const field = dialog.getByLabel(text.field);
        const confirm = dialog.getByRole('button', {
          exact: true,
          name: text.button,
        });
        await expect(confirm).toBeDisabled();
        expect(
          await violations(page, {}, { include: [['.cdk-overlay-container']] }),
        ).toEqual([]);

        await field.fill('altcineva@example.test');
        await confirm.click();
        await expect(dialog.getByText(text.mismatch)).toBeVisible();

        await field.fill(email);
        await confirm.click();

        await expect(page).toHaveURL(new RegExp(`/${language}/?$`));
        await expect(page.getByText(text.done)).toBeVisible();

        await page.goto('/app/driver');
        await expect(page).not.toHaveURL(/\/app\//);
        const again = await page.request.post('/api/v1/auth/sign-in', {
          data: { email, password: PASSWORD },
        });
        expect(again.status()).toBe(401);
      });
    }

    test('a garage owner sees the button disabled, with the contact form and the e-mail', async ({
      page,
    }) => {
      // The support address is the API's configuration, unset in CI.
      await page.route('**/api/v1/support/contact', (route) =>
        route.fulfill({ json: { email: 'ajutor@example.test' } }),
      );
      await signedIn(page, ACCOUNTS.garage);
      await settings(page, '/app/garage/settings', TEXT.ro.button);

      await expect(
        page.getByRole('button', { exact: true, name: TEXT.ro.button }),
      ).toBeDisabled();
      await expect(
        page.getByText('Contul tău deține un service.', { exact: false }),
      ).toBeVisible();
      await expect(
        page.locator('mf-delete-account a[href$="/contact"]'),
      ).toBeVisible();
      await expect(
        page.locator('mf-delete-account a[href^="mailto:"]'),
      ).toBeVisible();
    });
  });
}

// @seeded
test.describe('the delete row on the narrowest phone @seeded', () => {
  test.use({ viewport: { height: 640, width: 320 } });

  test('opens the dialog with no sideways scroll at 320 px', async ({
    page,
    request,
  }) => {
    const email = await newAccount(request, 'ro');
    await signedIn(page, email, PASSWORD);
    await settings(page, '/app/driver/settings', TEXT.ro.button);

    await page
      .getByRole('button', { exact: true, name: TEXT.ro.button })
      .click();
    // On a phone the dialog container around the sheet has no box.
    await expect(
      page
        .getByRole('dialog', { name: TEXT.ro.dialog })
        .locator('mf-overlay-panel'),
    ).toBeVisible();

    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

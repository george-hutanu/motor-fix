import { expect, type Page } from '@playwright/test';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

// A fake password for accounts these tests create; never a real one.
const NEW_PASSWORD = 'parola-noua-de-test';

const fresh = () =>
  `confirmare-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

let addresses = 0;
// Sign-up is limited per address per hour: each test signs up from its own.
async function ownAddress(page: Page) {
  const address = `203.0.113.${(Date.now() + ++addresses) % 250}`;
  await page.route('**/api/v1/auth/sign-up', (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': address },
    }),
  );
}

// A token of the right shape that was never issued.
const unknownToken = () =>
  Array.from({ length: 43 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.charAt(
      Math.floor(Math.random() * 64),
    ),
  ).join('');

async function signUp(page: Page) {
  await ownAddress(page);
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await page
    .getByRole('dialog', { name: 'Autentificare' })
    .getByRole('button', { name: 'Creează un cont' })
    .click();
  const form = page.getByRole('dialog', { name: 'Cont nou' });
  await form.getByLabel('Nume').fill('Andrei Marin');
  await form.getByLabel('E‑mail').fill(fresh());
  await form.getByLabel('Parolă', { exact: true }).fill(NEW_PASSWORD);
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Creează contul' }).click();
  await expect(page).toHaveURL('/app/driver');
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.describe('confirming the e-mail address @seeded', () => {
  test('a new account is asked to confirm its e-mail and can ask for a new link', async ({
    page,
  }) => {
    await signUp(page);

    const banner = page.getByRole('status').filter({
      hasText: 'Confirmă‑ți adresa de e‑mail',
    });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Retrimite' }).click();
    await expect(
      page.getByText('Am trimis un link nou pe e‑mail.'),
    ).toBeVisible();

    await banner.getByRole('button', { name: 'Retrimite' }).click();
    await expect(
      page.getByText(
        'Ai cerut deja un link. Încearcă din nou puțin mai târziu.',
      ),
    ).toBeVisible();
  });

  test('the banner fits a 320 px phone', async ({ page }) => {
    // Signed up on the wide page, whose header shows the sign-in button.
    await signUp(page);
    await page.setViewportSize({ height: 640, width: 320 });

    await expect(
      page.getByRole('status').filter({ hasText: 'Confirmă‑ți' }),
    ).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  });
});

test.describe('an expired confirmation link', () => {
  test('says so and cannot send a new link for a link that was never issued', async ({
    page,
  }) => {
    await ready(page, `/ro/confirm-email/${unknownToken()}`);

    await expect(
      page.getByRole('heading', { name: 'Linkul a expirat' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Trimite un link nou' }).click();
    await expect(
      page.getByText(
        'Din acest link nu mai putem trimite altul. Intră în cont și apasă „Retrimite”.',
      ),
    ).toBeVisible();
  });

  test('speaks English on the English address and fits a 320 px phone', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, `/en/confirm-email/${unknownToken()}`);

    await expect(
      page.getByRole('heading', { name: 'The link has expired' }),
    ).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  });
});

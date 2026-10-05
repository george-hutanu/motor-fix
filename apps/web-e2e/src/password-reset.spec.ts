import { expect, type Page, test } from '@playwright/test';

import { ready, signIn } from './accounts.js';

// Fake passwords for an account these tests create; never real ones.
const OLD = 'parola-veche-de-test';
const NEW = 'parola-noua-de-test';

// The reset e-mail as the worker sent it, read from the test mailbox the
// local run starts (mailbox.mjs); a deployed address has none, so the config
// leaves out flows tagged @mailbox there. The API answers before it issues the
// link, so this waits for it to land.
const RESET_LINK = /https?:\/\/[^\s"<>]+\/reset-password\/[A-Za-z0-9_-]{43}/;

async function lastResetLink(page: Page, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `http://127.0.0.1:3025/messages?to=${encodeURIComponent(email)}`,
        );
        const sent: { textContent: string }[] = await res.json();
        link = sent
          .map((m) => RESET_LINK.exec(m.textContent)?.[0])
          .filter(Boolean)
          .at(-1);
        return link;
      },
      { message: 'no reset e-mail sent', timeout: 20_000 },
    )
    .toBeDefined();
  return new URL(String(link)).pathname;
}

// A token of the right shape that was never issued.
const unknownToken = () =>
  Array.from({ length: 43 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.charAt(
      Math.floor(Math.random() * 64),
    ),
  ).join('');

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const openSignIn = (page: Page) =>
  page.getByRole('button', { exact: true, name: 'Autentificare' }).click();

test.describe('resetting a forgotten password @seeded @mailbox', () => {
  test('from the sign-in dialog through the e-mail: the new password works and the old one does not', async ({
    browser,
    page,
  }) => {
    const email = `resetare-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const created = await page.request.post('/api/v1/auth/sign-up', {
      data: { email, language: 'ro', name: 'Andrei Resetare', password: OLD },
      headers: { 'x-forwarded-for': `203.0.113.${Date.now() % 250}` },
    });
    expect(created.status()).toBe(201);
    await page.context().clearCookies();

    await ready(page, '/ro');
    await openSignIn(page);
    const signInDialog = page.getByRole('dialog', { name: 'Autentificare' });
    await signInDialog.getByLabel('E‑mail').fill(email);
    await signInDialog
      .getByRole('button', { name: 'Ai uitat parola?' })
      .click();

    const reset = page.getByRole('dialog', { name: 'Resetează parola' });
    await expect(reset.getByLabel('E‑mail')).toHaveValue(email);
    await reset.getByRole('button', { name: 'Trimite linkul' }).click();
    await expect(
      reset.getByText(
        'Dacă există un cont cu această adresă, ți‑am trimis un link.',
      ),
    ).toBeVisible();

    const link = await lastResetLink(page, email);
    expect(link).toMatch(/^\/ro\/reset-password\/[A-Za-z0-9_-]{43}$/);
    const fresh = await browser.newContext();
    const visitor = await fresh.newPage();
    await ready(visitor, link);
    const choose = visitor.getByRole('dialog', { name: 'Parolă nouă' });
    await choose.getByLabel('Parolă nouă').fill(NEW);
    await choose.getByRole('button', { name: 'Salvează parola' }).click();
    await expect(visitor).toHaveURL('/app/driver');
    await fresh.close();

    const other = await browser.newContext();
    const again = await other.newPage();
    await ready(again, '/ro');
    await openSignIn(again);
    await signIn(again, email, { password: OLD });
    await expect(
      again.getByText('E‑mailul sau parola nu sunt corecte.'),
    ).toBeVisible();
    await signIn(again, email, { password: NEW });
    await expect(again).toHaveURL('/app/driver');
    await other.close();
  });

  test('the same answer for an address no account uses', async ({ page }) => {
    await ready(page, '/ro');
    await openSignIn(page);
    await page
      .getByRole('dialog', { name: 'Autentificare' })
      .getByRole('button', { name: 'Ai uitat parola?' })
      .click();
    const reset = page.getByRole('dialog', { name: 'Resetează parola' });
    await reset.getByLabel('E‑mail').fill('nimeni-niciodata@example.test');
    await reset.getByRole('button', { name: 'Trimite linkul' }).click();
    await expect(
      reset.getByText(
        'Dacă există un cont cu această adresă, ți‑am trimis un link.',
      ),
    ).toBeVisible();
  });
});

test.describe('a reset link that no longer works', () => {
  test('says the link expired and opens the e-mail step from "Cere un link nou"', async ({
    page,
  }) => {
    await ready(page, `/ro/reset-password/${unknownToken()}`);

    const dialog = page.getByRole('dialog', { name: 'Parolă nouă' });
    await expect(dialog.getByText('Linkul a expirat')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cere un link nou' }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'Resetează parola' })
        .getByRole('button', { name: 'Trimite linkul' }),
    ).toBeVisible();
  });

  test('speaks English on the English address and fits a 320 px phone', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, `/en/reset-password/${unknownToken()}`);

    await expect(page.getByText('The link has expired')).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  });

  test('the sign-in dialog with "Ai uitat parola?" fits a 320 px phone', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, '/ro');
    await page.getByRole('link', { name: 'Cont' }).click();
    await expect(
      page.getByRole('button', { name: 'Ai uitat parola?' }),
    ).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  });
});

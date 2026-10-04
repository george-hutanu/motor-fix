import { type Browser, expect, type Page, test } from '@playwright/test';

import { ready, signIn } from './accounts.js';

// Signing out everywhere ends every session of the account, so these flows
// use an account of their own, never a seeded one other specs sign in with:
// one sign-up per run (the API admits 10 an hour from one address), and the
// flows one at a time, so one's "all devices" never ends another's session.
const PASSWORD = 'iesire-de-pe-toate-2026';
let email = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  email = `iesire-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const context = await browser.newContext();
  const res = await context.request.post('/api/v1/auth/sign-up', {
    data: { email, language: 'ro', name: 'Andrei Ieșire', password: PASSWORD },
  });
  expect(res.status()).toBe(201);
  await context.close();
});

async function signedIn(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email, { password: PASSWORD });
  await expect(page).toHaveURL('/app/driver');
  return page;
}

const home = /\/ro\/?$/;

const signedOut = async (page: Page) => {
  await expect(page).toHaveURL(home, { timeout: 5_000 });
  await page.goto('/app/driver');
  await expect(page).toHaveURL(home);
};

// @seeded: needs the real API and its database, not stubs; a deployed address
// runs it only when given E2E_PASSWORD, like the other real-API flows.
test.describe('signing out @seeded', () => {
  test('"Ieși de pe toate dispozitivele" signs the other device out within seconds', async ({
    browser,
  }) => {
    const phone = await signedIn(browser);
    const laptop = await signedIn(browser);

    await phone
      .getByRole('button', { name: 'Ieși de pe toate dispozitivele' })
      .click();
    const confirm = phone.getByRole('dialog', {
      name: 'Ieși de pe toate dispozitivele?',
    });
    await expect(
      confirm.getByText('Va trebui să te autentifici din nou peste tot.'),
    ).toBeVisible();
    await confirm.getByRole('button', { exact: true, name: 'Ieși' }).click();

    await expect(phone).toHaveURL(home);
    await signedOut(laptop);
    await signedOut(phone);
  });

  test('"Renunță" keeps every session', async ({ browser }) => {
    const phone = await signedIn(browser);

    await phone
      .getByRole('button', { name: 'Ieși de pe toate dispozitivele' })
      .click();
    await phone
      .getByRole('dialog', { name: 'Ieși de pe toate dispozitivele?' })
      .getByRole('button', { name: 'Renunță' })
      .click();

    await expect(phone).toHaveURL('/app/driver');
    await phone.reload();
    await expect(phone).toHaveURL('/app/driver');
  });

  test('"Ieși din cont" signs out the other tabs of the browser, and Back shows no dashboard', async ({
    browser,
  }) => {
    const first = await signedIn(browser);
    const second = await first.context().newPage();
    // A dashboard's live stream keeps the network busy: no networkidle here.
    await second.goto('/app/driver');
    await expect(second).toHaveURL('/app/driver');
    // The name shows once the tab has started in the browser and loaded the session.
    await expect(second.getByText('Andrei Ieșire')).toBeVisible();

    await first.getByRole('button', { name: 'Ieși din cont' }).click();
    await expect(first).toHaveURL(home);
    await expect(second).toHaveURL(home, { timeout: 5_000 });

    await first.goBack();
    await expect(first).toHaveURL(home);
  });
});

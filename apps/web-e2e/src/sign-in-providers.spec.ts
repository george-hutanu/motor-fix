import { expect, type Page, test } from '@playwright/test';

import { ACCOUNTS, ready } from './accounts.js';

// The stand-in issuer (openid.mjs, web-e2e:openid) approves at once, as the
// person set here: never the real Google.
const ISSUER = 'http://127.0.0.1:3026';

async function nextPerson(person: Record<string, unknown>) {
  const answer = await fetch(`${ISSUER}/next`, {
    body: JSON.stringify(person),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  expect(answer.status).toBe(204);
}

async function continueWithGoogle(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Autentificare' });
  await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
  await dialog.getByRole('button', { name: 'Continuă cu Google' }).click();
}

test.describe('sign in with Google @openid', () => {
  test.describe.configure({ mode: 'serial' });

  const subject = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${subject}@example.test`;

  test('a new person ticks the consent, gets a driver account, and is signed in', async ({
    page,
  }) => {
    await nextPerson({
      email,
      email_verified: true,
      name: 'Elena Pop',
      sub: subject,
    });

    await continueWithGoogle(page);

    const step = page.getByRole('dialog', { name: 'Cont nou' });
    await expect(step.locator('mf-overlay-panel')).toBeVisible();
    await expect(step).toContainText('Google');
    await expect(step.getByLabel('Nume')).toHaveValue('Elena Pop');
    await step.getByRole('button', { name: 'Creează contul' }).click();
    await expect(step).toContainText('Bifează');
    await step.getByRole('checkbox').check();
    await step.getByRole('button', { name: 'Creează contul' }).click();

    await expect(page).toHaveURL(/\/app\/driver/);
  });

  test('the same person comes back and is signed in at once', async ({
    page,
  }) => {
    await nextPerson({ email, email_verified: true, sub: subject });

    await continueWithGoogle(page);

    await expect(page).toHaveURL(/\/app\/driver/);
  });

  test('a verified e-mail of a seeded account signs into that account', async ({
    page,
  }) => {
    await nextPerson({
      email: ACCOUNTS.otherDriver,
      email_verified: true,
      sub: `seeded-${subject}`,
    });

    await continueWithGoogle(page);

    await expect(page).toHaveURL(/\/app\/driver/);
  });

  test('a cancel at Google brings the sign-in dialog back, with no error', async ({
    page,
  }) => {
    await nextPerson({ deny: true, sub: subject });

    await continueWithGoogle(page);

    await expect(page).toHaveURL(/\/ro\/sign-in\/return/);
    const dialog = page.getByRole('dialog', { name: 'Autentificare' });
    await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
    await expect(dialog.getByText('Nu am putut contacta')).toHaveCount(0);
  });
});

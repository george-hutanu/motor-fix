import { expect, type Page } from '@playwright/test';

// The accounts libs/domain/src/seed.ts adds outside production. Their password
// is a fake default locally and in CI; a deployed address has its own secret.
export const PASSWORD = process.env['E2E_PASSWORD'] || 'parola-de-test';

export const ACCOUNTS = {
  admin: 'admin@example.test',
  driver: 'sofer@example.test',
  garage: 'service@example.test',
  mechanic: 'mecanic@example.test',
  otherDriver: 'sofer2@example.test',
  receptionist: 'receptie@example.test',
  suspended: 'suspendat@example.test',
  switcher: 'comutare@example.test',
  twoRoles: 'doua-roluri@example.test',
} as const;

// Waits for the page to take clicks: the server-rendered HTML arrives first.
export async function ready(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

export async function signIn(
  page: Page,
  email: string,
  { password = PASSWORD, remember = true } = {},
) {
  const dialog = page.getByRole('dialog', { name: 'Autentificare' });
  // The panel: on a phone the dialog container around the sheet has no box.
  await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
  await dialog.getByLabel('E‑mail').fill(email);
  await dialog.getByLabel('Parolă').fill(password);
  if (!remember) await dialog.getByLabel('Ține‑mă autentificat').uncheck();
  await dialog.getByRole('button', { name: 'Intră în cont' }).click();
}

import { type BrowserContext, expect, type Page } from '@playwright/test';

// The accounts libs/domain/src/seed.ts adds outside production. Their password
// is a fake default locally and in CI; a deployed address has its own secret.
export const PASSWORD = process.env['E2E_PASSWORD'] || 'parola-de-test';

export const ACCOUNTS = {
  admin: 'admin@example.test',
  // A second admin, so a rule that needs two can be asked and approved.
  admin2: 'admin2@example.test',
  driver: 'sofer@example.test',
  garage: 'service@example.test',
  // Garage only, with no garage: adding a first car makes it a driver.
  garageOnly: 'masina-noua@example.test',
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
  await settled(page);
}

// Waits for the page to take clicks. A public page is rendered by the server
// and opens the public live stream once quiet, a stream that never ends, so
// networkidle may never come: wait for hydration instead. A dashboard is drawn
// in the browser alone, with no hydration marker, and keeps networkidle.
export async function settled(page: Page) {
  if (new URL(page.url()).pathname.startsWith('/app/')) {
    await page.waitForLoadState('networkidle');
    return;
  }
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !document.querySelector('[ngh]'));
}

// The place step's map reads the app's own empty style: no outside tiles, and
// no software WebGL render holding the page's thread.
export const ownMap = (target: Page | BrowserContext) =>
  target.addInitScript(() => {
    (window as { __MF_MAP_STYLE?: string }).__MF_MAP_STYLE =
      '/map/empty-style.json';
  });

// Angular drops each server-rendered node's ngh marker as it hydrates it, so
// none left means the page answers. Unlike networkidle, it still comes on a
// page that holds a live stream, which never ends. Only for a page the server
// renders: one drawn in the browser alone has no marker to wait for. Without
// a path it waits on the page already there, after a reload. It keeps the
// page's default timeout, the one goto and the networkidle wait it replaces
// use, rather than setting one of its own.
export async function hydrated(page: Page, path?: string) {
  if (path !== undefined) await page.goto(path);
  await page.waitForFunction(() => !document.querySelector('[ngh]'));
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

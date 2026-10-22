import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

import { ready } from './accounts.js';
import { JOBS, jpeg, KEPT } from './listing-kept.js';

// Sending a listing as a visitor, answering the survey and making the account:
// the steps the listing specs share.

// A fake password for the accounts these tests create; never a real one.
const NEW_PASSWORD = 'parola-noua-de-test';

const prices = (page: Page) => page.locator('mf-prices-step');
const photos = (page: Page) => page.locator('mf-photos-step');
export const confirmation = (page: Page) =>
  page.locator('mf-missing-summary .summary');
const survey = (page: Page) => page.locator('mf-signup-survey');
export const panel = (page: Page) =>
  page.getByRole('dialog').locator('mf-overlay-panel');
export const statusView = (page: Page) => page.locator('.status-view');
export const current = (scope: Locator) =>
  scope.locator('mf-verification-stages li[aria-current="step"] .name');

async function range(page: Page, name: string, from: string, to: string) {
  await prices(page)
    .getByRole('textbox', { exact: true, name: `${name}, de la` })
    .fill(from);
  await prices(page)
    .getByRole('textbox', { exact: true, name: `${name}, până la` })
    .fill(to);
}

export const unique = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// A listing with nothing missing, under a name of its own so the admin's
// queue shows its row; the e-mail is the one the sign-up dialog starts with.
export async function fillListing(
  context: BrowserContext,
  page: Page,
  name: string,
  photo: ReturnType<typeof jpeg> = jpeg('fata.jpg'),
) {
  const copy = structuredClone(KEPT);
  copy.data.steps['1'].name = name;
  await context.addInitScript((kept) => {
    if (sessionStorage.getItem('kept')) return;
    localStorage.setItem('mf.listing-draft', kept);
    sessionStorage.setItem('kept', '1');
  }, JSON.stringify(copy));
  await ready(page, '/ro/list-your-garage');
  const email = `trimis-${unique()}@example.test`;
  await page.getByLabel('E‑mail').fill(email);
  await page.getByLabel('E‑mail').blur();
  // The photo picker opens once the draft exists on the server.
  await expect(
    photos(page).getByRole('button', { name: 'Alege fotografii' }),
  ).toBeEnabled();
  // The most popular brand, whichever the catalogue ranks first.
  await page.locator('mf-brands-step .chips > li > button').first().click();
  await range(page, 'Manoperă, pe oră', '120', '200');
  for (const [job, from, to] of JOBS) await range(page, job, from, to);
  await photos(page).locator('input[type="file"]').setInputFiles([photo]);
  // The photo counts only once its upload has a key on the server.
  await expect(photos(page).locator('li.photo').first()).toHaveAttribute(
    'data-key',
    /garage_photo\//,
  );
}

// Five answers, each the first offered, then the starting features.
export async function answerSurvey(page: Page) {
  await confirmation(page).locator('button.tell-us').click();
  const forward = survey(page).locator('button.forward');
  await forward.click();
  for (let question = 0; question < 5; question++) {
    await survey(page).getByRole('radio').first().click();
    await forward.click();
  }
  await expect(survey(page).locator('.features li')).toHaveCount(5);
  await forward.click();
  await expect(panel(page)).toBeVisible();
}

export async function signUp(page: Page, email: string) {
  await expect(panel(page).locator('#mf-sign-up-email')).toHaveValue(email);
  await panel(page).locator('#mf-sign-up-password').fill(NEW_PASSWORD);
  await panel(page).getByRole('checkbox').check();
  await panel(page).locator('button[type="submit"]').click();
  await expect(statusView(page).locator('h1')).toBeFocused();
}

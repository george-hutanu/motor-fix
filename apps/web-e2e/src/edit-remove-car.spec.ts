// @traces 092-FR-009
// @traces 092-FR-010
// @traces 092-FR-011
// @traces 092-FR-014

import { expect, type Page } from '@playwright/test';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

// A fake password for the account this test creates; never a real one.
const NEW_PASSWORD = 'parola-noua-de-test';

const fresh = () =>
  `schimba-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

// Sign-up is limited per address per hour: each run signs up from its own.
async function signUp(page: Page) {
  const address = `198.51.100.${Date.now() % 250}`;
  await page.route('**/api/v1/auth/sign-up', (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': address },
    }),
  );
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

// A calendar day this many days after today in Bucharest, as the app counts.
function daysAhead(days: number) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
  }).format(new Date());
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

const monthYear = (day: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${day}T00:00:00Z`));

// Every text the flows read, in each language.
const TEXTS = {
  en: {
    actions: 'Actions for BMW 320d',
    add: 'Add a car',
    addCar: 'Add the car',
    brand: 'Brand',
    edit: 'Edit',
    editTitle: 'Edit the car',
    emptyHome: 'Add your first car.',
    fuel: 'Diesel',
    itp: 'ITP valid until',
    itpValid: (day: string) => `ITP valid until ${monthYear(day, 'en-GB')}`,
    km: 'Kilometres',
    locale: 'en',
    openRequest:
      'The car has an open request. Finish or cancel the request first.',
    rca: 'RCA valid until',
    rcaMissing: 'RCA: add the date',
    remove: 'Remove the car',
    removeText: 'Remove the BMW 320d? You will get no more reminders for it.',
    save: 'Save',
    year: 'Year',
  },
  ro: {
    actions: 'Acțiuni pentru BMW 320d',
    add: 'Adaugă o mașină',
    addCar: 'Adaugă mașina',
    brand: 'Marcă',
    edit: 'Modifică',
    editTitle: 'Modifică mașina',
    emptyHome: 'Adaugă prima ta mașină.',
    fuel: 'Motorină',
    itp: 'ITP valabil până la',
    itpValid: (day: string) => `ITP valabil până în ${monthYear(day, 'ro-RO')}`,
    km: 'Kilometri',
    locale: 'ro',
    openRequest:
      'Mașina are o cerere deschisă. Încheie sau anulează cererea mai întâi.',
    rca: 'RCA valabilă până la',
    rcaMissing: 'RCA: adaugă data',
    remove: 'Șterge mașina',
    removeText: 'Ștergi BMW 320d? Nu mai primești amintiri pentru ea.',
    save: 'Salvează',
    year: 'An',
  },
};
type Texts = (typeof TEXTS)['ro'];

const card = (page: Page) =>
  page.locator('[data-car]').filter({ hasText: 'BMW 320d' });
const itpLamp = (page: Page) =>
  card(page).locator('mf-due-date-line mf-lamp').first();

async function addBmw(page: Page, t: Texts) {
  await page.getByRole('button', { exact: true, name: t.add }).click();
  const dialog = page.getByRole('dialog', { name: t.add });
  await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
  await dialog.getByLabel(t.brand).fill('BMW');
  await dialog.getByRole('option', { exact: true, name: 'BMW' }).click();
  await dialog.getByLabel('Model').fill('320d');
  await dialog.getByLabel(t.year, { exact: true }).fill('2019');
  await dialog.getByLabel(t.km).fill('148200');
  await dialog.getByRole('radio', { name: t.fuel }).check();
  await dialog.getByLabel(t.itp).fill(daysAhead(36));
  await dialog.getByRole('button', { name: t.addCar }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page)).toBeVisible();
}

async function openMenuItem(page: Page, t: Texts, item: string) {
  await card(page)
    .getByRole('button', { exact: true, name: t.actions })
    .click();
  await page.getByRole('menuitem', { exact: true, name: item }).click();
}

for (const language of ['ro', 'en'] as const) {
  const t = TEXTS[language];

  test.describe(`a driver edits and removes a car, in ${language} @seeded`, () => {
    test('changes the ITP date from the menu, adds RCA from its grey line, is refused while a request is open, then removes the car', async ({
      page,
    }) => {
      await signUp(page);
      await page.goto('/app/driver/cars');
      if (language === 'en') {
        await page.getByRole('button', { exact: true, name: 'EN' }).click();
      }
      await addBmw(page, t);

      // The ITP date changes from the card's menu, without a reload.
      const later = daysAhead(400);
      await openMenuItem(page, t, t.edit);
      const edit = page.getByRole('dialog', { name: t.editTitle });
      await expect(edit.getByLabel('Model')).toHaveValue('320d');
      await edit.getByLabel(t.itp).fill(later);
      await edit.getByRole('button', { name: t.save }).click();
      await expect(edit).toHaveCount(0);
      await expect(itpLamp(page)).toHaveText(t.itpValid(later));

      // The grey RCA line opens the edit dialog at the RCA field.
      await card(page)
        .getByRole('button', { exact: true, name: t.rcaMissing })
        .click();
      const atRca = page.getByRole('dialog', { name: t.editTitle });
      await expect(atRca.getByLabel(t.rca)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(atRca).toHaveCount(0);

      // A refusal shows inside the confirmation, which stays open.
      await page.route('**/api/v1/cars/*', (route) =>
        route.request().method() === 'DELETE'
          ? route.fulfill({
              body: JSON.stringify({
                code: 'open_request',
                status: 409,
                title: 'The car has a request under way',
              }),
              contentType: 'application/problem+json',
              status: 409,
            })
          : route.fallback(),
      );
      await openMenuItem(page, t, t.remove);
      const confirm = page.getByRole('dialog', { name: t.remove });
      await expect(confirm).toContainText(t.removeText);
      await confirm.getByRole('button', { name: t.remove }).click();
      await expect(confirm.getByRole('alert')).toContainText(t.openRequest);
      await expect(confirm).toBeVisible();
      await expect(card(page)).toBeVisible();
      await page.unroute('**/api/v1/cars/*');

      // Removed for real: gone from Mașinile mele and from the home page.
      await confirm.getByRole('button', { name: t.remove }).click();
      await expect(confirm).toHaveCount(0);
      await expect(card(page)).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByRole('button', { exact: true, name: t.add }).first(),
      ).toBeVisible();
      await expect(card(page)).toHaveCount(0);
      await page.goto('/app/driver');
      await expect(page.locator('[data-panel="cars"]')).toContainText(
        t.emptyHome,
      );
    });
  });
}

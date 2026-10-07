import { expect, type Page, test } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';

// A fake password for the account this test creates; never a real one.
const NEW_PASSWORD = 'parola-noua-de-test';

const fresh = () =>
  `masina-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

// Sign-up is limited per address per hour: each run signs up from its own.
async function ownAddress(page: Page) {
  const address = `198.51.100.${Date.now() % 250}`;
  await page.route('**/api/v1/auth/sign-up', (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': address },
    }),
  );
}

async function signUp(page: Page, email: string) {
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
  await form.getByLabel('E‑mail').fill(email);
  await form.getByLabel('Parolă', { exact: true }).fill(NEW_PASSWORD);
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Creează contul' }).click();
  await expect(page).toHaveURL('/app/driver');
}

async function signInFromHome(page: Page, email: string, password?: string) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email, password ? { password } : {});
}

const card = (page: Page, name: string) =>
  page.locator('[data-car]').filter({ hasText: name });

const chip = (page: Page, name: string) =>
  page
    .getByRole('group', { name: 'Rolul tău' })
    .getByRole('button', { exact: true, name });

interface Car {
  brand: string;
  model: string;
  year: string;
  km: string;
  fuel: string;
  itp?: string;
}

async function addCar(
  page: Page,
  car: Car,
  texts = {
    add: 'Adaugă mașina',
    brand: 'Marcă',
    itp: 'ITP valabil până la',
    km: 'Kilometri',
    title: 'Adaugă o mașină',
    year: 'An',
  },
) {
  const dialog = page.getByRole('dialog', { name: texts.title });
  await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
  await dialog.getByLabel(texts.brand).fill(car.brand);
  await dialog.getByRole('option', { exact: true, name: car.brand }).click();
  await dialog.getByLabel('Model').fill(car.model);
  await dialog.getByLabel(texts.year, { exact: true }).fill(car.year);
  await dialog.getByLabel(texts.km).fill(car.km);
  await dialog.getByRole('radio', { name: car.fuel }).check();
  if (car.itp) await dialog.getByLabel(texts.itp).fill(car.itp);
  await dialog.getByRole('button', { name: texts.add }).click();
  await expect(dialog).toHaveCount(0);
}

const nextYear = () => `${new Date().getFullYear() + 1}-03-08`;

test.describe('a driver can add a car @seeded', () => {
  test('a new driver can add a car, finds it after signing in again, and adds another in English', async ({
    page,
  }) => {
    const email = fresh();
    await signUp(page, email);
    await page.goto('/app/driver/cars');

    await page
      .getByRole('button', { exact: true, name: 'Adaugă o mașină' })
      .click();
    await addCar(page, {
      brand: 'BMW',
      fuel: 'Motorină',
      itp: nextYear(),
      km: '148200',
      model: '320d',
      year: '2019',
    });

    const bmw = card(page, 'BMW 320d');
    await expect(bmw).toContainText('2019 · 148.200 km');
    await expect(bmw).toContainText(/ITP valabil până la \d{1,2} mart\. \d{4}/);

    await page
      .getByRole('button', { exact: true, name: 'Ieși din cont' })
      .click();
    await expect(page).toHaveURL(/\/ro\/?$/);
    await signInFromHome(page, email, NEW_PASSWORD);
    await expect(page).toHaveURL('/app/driver');
    await page.goto('/app/driver/cars');
    await expect(card(page, 'BMW 320d')).toContainText('2019 · 148.200 km');

    await page.getByRole('button', { exact: true, name: 'EN' }).click();
    await page.getByRole('button', { exact: true, name: 'Add a car' }).click();
    await addCar(
      page,
      {
        brand: 'Dacia',
        fuel: 'Petrol',
        km: '90000',
        model: 'Logan',
        year: '2018',
      },
      {
        add: 'Add the car',
        brand: 'Brand',
        itp: 'ITP valid until',
        km: 'Kilometres',
        title: 'Add a car',
        year: 'Year',
      },
    );

    await expect(page.locator('[data-car]').first()).toContainText(
      'Dacia Logan',
    );
    await expect(card(page, 'Dacia Logan')).toContainText('2018 · 90,000 km');
    await expect(card(page, 'Dacia Logan')).toContainText(
      'ITP: add the date from the registration',
    );
    await expect(card(page, 'BMW 320d')).toContainText('2019 · 148,200 km');
  });
});

test.describe('a garage account can add a car @seeded @reset', () => {
  test('a garage-only owner adds a car from the account block, becomes a driver and finds it there', async ({
    page,
  }) => {
    await signInFromHome(page, ACCOUNTS.garageOnly);
    await expect(page).toHaveURL(/\/app\/(garage|driver)$/);
    // Only a local run resets the account to garage only first (global-setup.ts);
    // a deployed address leaves @reset flows out.
    await expect(page.getByRole('group', { name: 'Rolul tău' })).toHaveCount(0);

    await page
      .getByRole('button', { exact: true, name: 'Adaugă o mașină' })
      .click();
    await addCar(page, {
      brand: 'BMW',
      fuel: 'Benzină',
      km: '61000',
      model: 'X1',
      year: '2021',
    });

    await expect(chip(page, 'Șofer')).toBeVisible();
    await expect(
      page.getByRole('button', { exact: true, name: 'Adaugă o mașină' }),
    ).toHaveCount(0);
    await chip(page, 'Șofer').click();
    await expect(page).toHaveURL('/app/driver');
    await page
      .getByRole('navigation', { name: 'Meniu' })
      .getByRole('link', { exact: true, name: 'Mașinile mele' })
      .click();
    await expect(card(page, 'BMW X1')).toContainText('2021 · 61.000 km');
  });
});

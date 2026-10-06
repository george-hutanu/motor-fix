import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, type Page, test } from '@playwright/test';

import { ACCOUNTS, ready } from './accounts.js';

type Axe = {
  run: (context: unknown) => Promise<{
    violations: Array<{ id: string; nodes: unknown[] }>;
  }>;
};

const AXE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

// A fake password for accounts these tests create; never a real one.
const NEW_PASSWORD = 'parola-noua-de-test';

const TITLE = {
  en: { signIn: 'Sign in', signUp: 'New account' },
  ro: { signIn: 'Autentificare', signUp: 'Cont nou' },
} as const;

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
// On a phone the dialog element is a 0x0 pane; the panel inside is what shows.
const surface = (page: Page, name: string) =>
  dialog(page, name).locator('mf-overlay-panel');

const fresh = () =>
  `nou-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

let addresses = 0;
// Sign-up is limited per address per hour, and every test here comes from
// this machine: each test signs up from an address of its own (TEST-NET-3).
async function ownAddress(page: Page) {
  const address = `203.0.113.${(Date.now() + ++addresses) % 250}`;
  await page.route('**/api/v1/auth/sign-up', (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': address },
    }),
  );
}

async function openSignUp(page: Page, language: 'ro' | 'en' = 'ro') {
  const titles = TITLE[language];
  await page.getByRole('button', { exact: true, name: titles.signIn }).click();
  await dialog(page, titles.signIn)
    .getByRole('button', {
      name: language === 'ro' ? 'Creează un cont' : 'Create an account',
    })
    .click();
  const form = dialog(page, titles.signUp);
  await expect(form).toBeVisible();
  return form;
}

test.describe('creating an account for real @seeded', () => {
  test('a visitor creates a driver account from Home and lands signed in on the driver dashboard', async ({
    page,
  }) => {
    await ownAddress(page);
    await ready(page, '/ro');
    const form = await openSignUp(page);
    await expect(page).toHaveURL(/\/ro\/?$/);

    await form.getByLabel('Nume').fill('Andrei Marin');
    await form.getByLabel('E‑mail').fill(fresh());
    await form.getByLabel('Parolă', { exact: true }).fill(NEW_PASSWORD);
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Creează contul' }).click();

    await expect(page).toHaveURL('/app/driver');
    await expect(
      page.getByRole('navigation', { name: 'Meniu' }).getByRole('link', {
        exact: true,
        name: 'Mașinile mele',
      }),
    ).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL('/app/driver');
  });

  test('an e-mail that is taken says so next to the button, and the typed name stays', async ({
    page,
  }) => {
    await ownAddress(page);
    await ready(page, '/ro');
    const form = await openSignUp(page);

    await form.getByLabel('Nume').fill('Andrei Marin');
    await form.getByLabel('E‑mail').fill(ACCOUNTS.driver.toUpperCase());
    await form.getByLabel('Parolă', { exact: true }).fill(NEW_PASSWORD);
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Creează contul' }).click();

    await expect(form.getByRole('alert')).toHaveText(
      'Există deja un cont cu acest e‑mail.',
    );
    await expect(form.getByLabel('Nume')).toHaveValue('Andrei Marin');
    await expect(form.getByLabel('E‑mail')).toHaveValue(
      ACCOUNTS.driver.toUpperCase(),
    );
    await expect(page).toHaveURL(/\/ro\/?$/);
  });

  test('a common password is refused under the password field', async ({
    page,
  }) => {
    await ownAddress(page);
    await ready(page, '/ro');
    const form = await openSignUp(page);

    await form.getByLabel('Nume').fill('Andrei Marin');
    await form.getByLabel('E‑mail').fill(fresh());
    await form.getByLabel('Parolă', { exact: true }).fill('password1');
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Creează contul' }).click();

    await expect(
      form.getByText(
        'Alege o parolă mai greu de ghicit: este printre cele mai folosite.',
      ),
    ).toBeVisible();
    await expect(form.getByLabel('Parolă', { exact: true })).toBeFocused();
  });

  test('a double tap creates one account', async ({ page }) => {
    await ownAddress(page);
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/auth/sign-up')) calls.push(r.url());
    });
    await ready(page, '/ro');
    const form = await openSignUp(page);

    await form.getByLabel('Nume').fill('Andrei Marin');
    await form.getByLabel('E‑mail').fill(fresh());
    await form.getByLabel('Parolă', { exact: true }).fill(NEW_PASSWORD);
    await form.getByRole('checkbox').check();
    const create = form.getByRole('button', { name: 'Creează contul' });
    await create.dblclick();

    await expect(page).toHaveURL('/app/driver');
    expect(calls).toHaveLength(1);
  });

  test('the dialog reads English and creates the account in English', async ({
    page,
  }) => {
    await ownAddress(page);
    await ready(page, '/en/garages');
    const form = await openSignUp(page, 'en');

    await form.getByLabel('Name').fill('Andrei Marin');
    await form.getByLabel('E-mail').fill(fresh());
    await form.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/app/driver');
    await expect(
      page.getByRole('navigation', { name: 'Menu' }).getByRole('link', {
        exact: true,
        name: 'My cars',
      }),
    ).toBeVisible();
  });
});

test.describe('the sign-up form', () => {
  test('an empty, invalid or short form is pointed out and nothing is sent', async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/auth/sign-up')) calls.push(r.url());
    });
    await ready(page, '/ro');
    const form = await openSignUp(page);

    await form.getByRole('button', { name: 'Creează contul' }).click();
    await expect(form.getByText('Câmpul este obligatoriu.')).toHaveCount(3);
    await expect(form.getByLabel('Nume')).toBeFocused();

    await form.getByLabel('Nume').fill('Andrei Marin');
    await form.getByLabel('E‑mail').fill('andrei@example');
    await form.getByLabel('Parolă', { exact: true }).fill('scurta7');
    await form.getByRole('button', { name: 'Creează contul' }).click();
    await expect(
      form.getByText('Adresa de e‑mail nu pare corectă.'),
    ).toBeVisible();
    await expect(form.getByText('Scrie cel puțin 8 caractere.')).toBeVisible();

    expect(calls).toEqual([]);
  });

  test('switching between sign-in and sign-up carries the e-mail both ways', async ({
    page,
  }) => {
    await ready(page, '/ro/garages');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    const signIn = dialog(page, 'Autentificare');
    await signIn.getByLabel('E‑mail').fill('andrei@example.test');

    await signIn.getByRole('button', { name: 'Creează un cont' }).click();
    const signUp = dialog(page, 'Cont nou');
    await expect(signUp.getByLabel('E‑mail')).toHaveValue(
      'andrei@example.test',
    );
    await expect(page.getByRole('dialog')).toHaveCount(1);

    await signUp.getByLabel('E‑mail').fill('maria@example.test');
    await signUp.getByRole('button', { name: 'Intră în cont' }).click();
    await expect(
      dialog(page, 'Autentificare').getByLabel('E‑mail'),
    ).toHaveValue('maria@example.test');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page).toHaveURL('/ro/garages');
  });

  test('a phone opens sign-up from the Cont tab', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await ready(page, '/ro/garages');

    await page.getByRole('link', { name: 'Cont' }).click();
    await dialog(page, 'Autentificare')
      .getByRole('button', { name: 'Creează un cont' })
      .click();

    await expect(surface(page, 'Cont nou')).toBeVisible();
    await expect(page).toHaveURL('/ro/garages');
  });

  test('works from the keyboard alone, and Escape returns to the opener', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await ready(page, '/ro/garages');
    const opener = page.getByRole('button', {
      exact: true,
      name: 'Autentificare',
    });
    await opener.focus();
    await page.keyboard.press('Enter');
    const signIn = dialog(page, 'Autentificare');
    await signIn.getByRole('button', { name: 'Creează un cont' }).focus();
    await page.keyboard.press('Enter');

    const form = dialog(page, 'Cont nou');
    await expect(form.getByLabel('Nume')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('E‑mail')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Parolă', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      form.getByRole('button', { name: 'Arată parola' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(form.getByRole('checkbox')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      form.getByRole('link', { name: 'Termenii de utilizare' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      form.getByRole('link', {
        name: 'Nota de informare privind datele personale',
      }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      form.getByRole('button', { name: 'Creează contul' }),
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

const SIZES = [
  ['320 px', 320, 640],
  ['390 px', 390, 844],
  ['a tablet', 820, 1180],
  ['a desktop', 1440, 900],
] as const;

async function openAt(page: Page, width: number, language: 'ro' | 'en') {
  const titles = TITLE[language];
  if (width < 768) {
    await page
      .getByRole('link', { name: language === 'ro' ? 'Cont' : 'Account' })
      .click();
  } else {
    await page
      .getByRole('button', { exact: true, name: titles.signIn })
      .click();
  }
  await dialog(page, titles.signIn)
    .getByRole('button', {
      name: language === 'ro' ? 'Creează un cont' : 'Create an account',
    })
    .click();
  await expect(surface(page, titles.signUp)).toBeVisible();
}

async function axeViolations(page: Page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const axe = (globalThis as unknown as { axe: Axe }).axe;
    const result = await axe.run({ include: [['.cdk-overlay-container']] });
    return result.violations.map((v) => `${v.id} (${v.nodes.length})`);
  });
}

const CASES = SIZES.flatMap(([label, width, height]) =>
  (['dark', 'light'] as const).flatMap((colorScheme) =>
    (['ro', 'en'] as const).map(
      (language) => ({ colorScheme, height, label, language, width }) as const,
    ),
  ),
);

test.describe('the sign-up dialog on every screen size', () => {
  for (const { colorScheme, height, label, language, width } of CASES) {
    test(`fits and passes axe on ${label}, ${colorScheme}, ${language}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await ready(page, `/${language}/garages`);

      await openAt(page, width, language);

      const box = await surface(page, TITLE[language].signUp).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});

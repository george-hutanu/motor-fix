import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, type Page, test } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';

type Axe = {
  run: (context: unknown) => Promise<{
    violations: Array<{ id: string; nodes: unknown[] }>;
  }>;
};

const AXE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

const dialog = (page: Page, name = 'Autentificare') =>
  page.getByRole('dialog', { name });

const openFromHeader = (page: Page, name = 'Autentificare') =>
  page.getByRole('button', { exact: true, name }).click();

test.describe('signing in for real @seeded', () => {
  for (const [who, email, landing, menu] of [
    ['a driver', ACCOUNTS.driver, '/app/driver', 'Mașinile mele'],
    ['a garage owner', ACCOUNTS.garage, '/app/garage', 'Mecanici'],
    ['a receptionist', ACCOUNTS.receptionist, '/app/garage', 'Programări'],
    ['a mechanic', ACCOUNTS.mechanic, '/app/garage', 'Panou'],
    ['an admin', ACCOUNTS.admin, '/app/admin', 'Utilizatori'],
    [
      'a driver and garage who used the garage last',
      ACCOUNTS.twoRoles,
      '/app/garage',
      'Mecanici',
    ],
  ] as const) {
    test(`${who} signs in from the garages screen and lands on ${landing}`, async ({
      page,
    }) => {
      await ready(page, '/ro/garages');
      await openFromHeader(page);

      await expect(page).toHaveURL('/ro/garages');
      await signIn(page, email);

      await expect(page).toHaveURL(landing);
      await expect(
        page.getByRole('navigation', { name: 'Meniu' }).getByRole('link', {
          exact: true,
          name: menu,
        }),
      ).toBeVisible();
    });
  }

  test('Back from the landing returns to the screen the dialog opened over', async ({
    page,
  }) => {
    await ready(page, '/ro/garages');
    await openFromHeader(page);
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');

    await page.goBack();

    await expect(page).toHaveURL('/ro/garages');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('a receptionist sees no settings, prices or team', async ({ page }) => {
    await ready(page, '/ro');
    await openFromHeader(page);
    await signIn(page, ACCOUNTS.receptionist);

    const menu = page.getByRole('navigation', { name: 'Meniu' });
    await expect(menu.getByRole('link', { name: 'Programări' })).toBeVisible();
    for (const hidden of ['Mecanici', 'Prețuri', 'Profilul service‑ului']) {
      await expect(menu.getByRole('link', { name: hidden })).toHaveCount(0);
    }
  });

  test('the session survives a reload, and "Ieși din cont" ends it', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await openFromHeader(page);
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');

    await page.reload();
    await expect(page).toHaveURL('/app/driver');
    await expect(page.getByText('Andrei Popescu')).toBeVisible();

    await page.getByRole('button', { name: 'Ieși din cont' }).click();
    await expect(page).toHaveURL(/\/ro\/?$/);

    await page.goto('/app/driver');
    await expect(page).toHaveURL(/\/ro\/?$/);
    await expect(dialog(page)).toBeVisible();
  });

  test('"keep me signed in" decides whether the cookie outlives the browser', async ({
    page,
    context,
  }) => {
    await ready(page, '/ro');
    await openFromHeader(page);
    await signIn(page, ACCOUNTS.driver, { remember: false });
    await expect(page).toHaveURL('/app/driver');
    const session = (await context.cookies()).find(
      (c) => c.name === 'mf_refresh',
    );
    expect(session?.expires).toBe(-1);
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Strict');
    expect(session?.path).toBe('/api/v1/auth');

    await page.getByRole('button', { name: 'Ieși din cont' }).click();
    await expect(page).toHaveURL(/\/ro\/?$/);
    await openFromHeader(page);
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');
    const kept = (await context.cookies()).find((c) => c.name === 'mf_refresh');
    expect(kept?.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86_400);
  });

  test('the page never holds the refresh token', async ({ page }) => {
    await ready(page, '/ro');
    await openFromHeader(page);
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');

    const visible = await page.evaluate(() => ({
      cookie: document.cookie,
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    }));
    expect(visible.cookie).not.toContain('mf_refresh');
    expect(visible.local).not.toMatch(/eyJ|refresh/);
    expect(visible.session).not.toMatch(/eyJ|refresh/);
  });

  test('a signed-out visit to a dashboard opens Home with the dialog, then the own dashboard', async ({
    page,
  }) => {
    await ready(page, '/app/admin');

    await expect(page).toHaveURL(/\/ro\/?$/);
    await signIn(page, ACCOUNTS.driver);

    await expect(page).toHaveURL('/app/driver');
  });

  test('a phone signs in from the Cont tab over the current screen', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await ready(page, '/ro/garages');

    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { name: 'Cont' })
      .click();

    await expect(page).toHaveURL('/ro/garages');
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');
  });
});

test.describe('signing in with something wrong @seeded', () => {
  test('a wrong password and an unknown e-mail say the same, and keep the e-mail', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await openFromHeader(page);

    for (const [email, password] of [
      [ACCOUNTS.suspended, 'nu-este-parola'],
      [`nimeni-${Date.now()}@example.test`, 'parola-de-test'],
    ]) {
      await signIn(page, email, { password });
      await expect(dialog(page).getByRole('alert')).toHaveText(
        'E‑mailul sau parola nu sunt corecte.',
      );
      await expect(dialog(page).getByLabel('E‑mail')).toHaveValue(email);
      await expect(dialog(page).getByLabel('Parolă')).toHaveValue('');
    }
    await expect(page).toHaveURL(/\/ro\/?$/);
  });

  test('a suspended account is told so', async ({ page }) => {
    await ready(page, '/ro');
    await openFromHeader(page);

    await signIn(page, ACCOUNTS.suspended);

    await expect(dialog(page).getByRole('alert')).toHaveText(
      'Contul tău este suspendat.',
    );
  });

  test('an empty or invalid form is pointed out and nothing is sent', async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/auth/sign-in')) calls.push(r.url());
    });
    await ready(page, '/ro');
    await openFromHeader(page);
    const form = dialog(page);

    await form.getByRole('button', { name: 'Intră în cont' }).click();
    await expect(form.getByText('Câmpul este obligatoriu.')).toHaveCount(2);
    await expect(form.getByLabel('E‑mail')).toBeFocused();

    await form.getByLabel('E‑mail').fill('andrei@example');
    await form.getByRole('button', { name: 'Intră în cont' }).click();
    await expect(
      form.getByText('Adresa de e‑mail nu pare corectă.'),
    ).toBeVisible();

    expect(calls).toEqual([]);
  });

  test('the dialog reads English and refuses in English', async ({ page }) => {
    await ready(page, '/en/garages');
    await openFromHeader(page, 'Sign in');
    const form = dialog(page, 'Sign in');

    await form.getByLabel('E-mail').fill(ACCOUNTS.suspended);
    await form.getByLabel('Password').fill('not-the-password');
    await form.getByRole('button', { name: 'Sign in' }).click();

    await expect(form.getByRole('alert')).toHaveText(
      'The e-mail or password is not correct.',
    );
  });
});

const SIZES = [
  ['320 px', 320, 640],
  ['390 px', 390, 844],
  ['a tablet', 820, 1180],
  ['a desktop', 1440, 900],
] as const;

const TITLE = { en: 'Sign in', ro: 'Autentificare' } as const;

// Phones open it from the tab bar, wider screens from the top bar.
async function openAt(page: Page, width: number, language: 'ro' | 'en') {
  if (width < 768) {
    await page
      .getByRole('link', { name: language === 'ro' ? 'Cont' : 'Account' })
      .click();
  } else {
    await openFromHeader(page, TITLE[language]);
  }
  await expect(panel(page, language)).toBeVisible();
}

// The panel: on a phone the dialog container around the sheet has no box.
const panel = (page: Page, language: 'ro' | 'en') =>
  dialog(page, TITLE[language]).locator('mf-overlay-panel');

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

test.describe('the dialog on every screen size', () => {
  for (const { colorScheme, height, label, language, width } of CASES) {
    test(`fits and passes axe on ${label}, ${colorScheme}, ${language}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await ready(page, `/${language}/garages`);

      await openAt(page, width, language);

      const box = await panel(page, language).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      if (width < 768) {
        // A phone: the sheet rises from the bottom, no taller than 92 %.
        await expect(panel(page, language)).toHaveAttribute(
          'data-side',
          'bottom',
        );
        expect(box?.height ?? 0).toBeLessThanOrEqual(height * 0.92 + 0.5);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await axeViolations(page)).toEqual([]);
      if (width < 768) {
        // A tap above the sheet closes it; the page stays where it was.
        const address = page.url();
        const before = await page.evaluate(() => window.scrollY);
        await page.mouse.click(width / 2, 10);
        await expect(dialog(page, TITLE[language])).toHaveCount(0);
        expect(page.url()).toBe(address);
        expect(await page.evaluate(() => window.scrollY)).toBe(before);
      }
    });
  }

  test('works from the keyboard alone', async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await ready(page, '/ro/garages');
    const opener = page.getByRole('button', {
      exact: true,
      name: 'Autentificare',
    });
    await opener.focus();
    await page.keyboard.press('Enter');

    const form = dialog(page);
    await expect(form.getByLabel('E‑mail')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Parolă')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Ține‑mă autentificat')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      form.getByRole('button', { name: 'Ai uitat parola?' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      form.getByRole('button', { name: 'Intră în cont' }),
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

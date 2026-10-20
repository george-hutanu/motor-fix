import { expect, type Page } from '@playwright/test';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

const COPY = {
  en: {
    find: 'Find a mechanic',
    footer: 'MotorFix links',
    how: 'How it works',
    list: 'List your garage',
    nav: 'Site menu',
    signIn: 'Sign in',
    title: 'Put your garage on the map',
  },
  ro: {
    find: 'Găsește un mecanic',
    footer: 'Legături MotorFix',
    how: 'Cum funcționează',
    list: 'Înscrie‑ți service‑ul',
    nav: 'Meniul site‑ului',
    signIn: 'Autentificare',
    title: 'Pune.ți service.ul pe hartă',
  },
} as const;

const bar = (page: Page, language: 'ro' | 'en') =>
  page.getByRole('navigation', { name: COPY[language].nav });
const footer = (page: Page, language: 'ro' | 'en') =>
  page.getByRole('navigation', { name: COPY[language].footer });
const section = (page: Page) => page.locator('section#how-it-works');

for (const language of ['ro', 'en'] as const) {
  const copy = COPY[language];

  test.describe(`the public frame in ${language}`, () => {
    test.use({ viewport: { height: 900, width: 1280 } });

    // @traces 228-FR-001
    test('orders the site bar find, how it works, sign in, list', async ({
      page,
    }) => {
      await ready(page, `/${language}`);

      await expect(bar(page, language).locator('a, button')).toHaveText([
        copy.find,
        copy.how,
        copy.signIn,
        copy.list,
      ]);
    });

    // @traces 228-FR-002
    for (const from of ['', '/garages?brand=dacia']) {
      test(`"${copy.how}" from ${from || 'Home'} lands on the section, focused`, async ({
        page,
      }) => {
        await ready(page, `/${language}${from}`);

        await bar(page, language).getByRole('link', { name: copy.how }).click();

        await expect(page).toHaveURL(new RegExp(`/${language}#how-it-works$`));
        await expect(section(page)).toBeInViewport();
        await expect(section(page)).toBeFocused();
      });
    }

    // @traces 228-FR-016
    test('the garage invitation opens the listing form at step 1 without an account', async ({
      page,
    }) => {
      await ready(page, `/${language}`);

      await page.locator('mf-garage-invite a').click();

      await expect(page).toHaveURL(
        new RegExp(`/${language}/list-your-garage$`),
      );
      await expect(page.locator('h1')).toHaveText(new RegExp(copy.title));
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    // @traces 228-FR-017
    for (const from of ['', '/garages?brand=dacia']) {
      test(`the footer links on ${from || 'Home'} land right`, async ({
        page,
      }) => {
        await ready(page, `/${language}${from}`);
        const links = footer(page, language);

        await expect(
          page.locator('mf-public-footer a.wordmark'),
        ).toHaveAttribute('href', `/${language}`);
        await expect(
          links.getByRole('link', { name: copy.find }),
        ).toHaveAttribute('href', `/${language}`);
        await links.getByRole('link', { name: copy.list }).click();
        await expect(page).toHaveURL(
          new RegExp(`/${language}/list-your-garage$`),
        );

        await footer(page, language)
          .getByRole('button', { name: copy.signIn })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
      });
    }
  });
}

// @traces 228-FR-003
test('"Găsește un mecanic" on Home opens Results for the brand shown @seeded', async ({
  page,
}) => {
  // Results search near the driver: Militari, where the seeded garages are.
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 44.435, longitude: 26.015 });
  await ready(page, '/ro');
  const shown = page
    .getByRole('radiogroup', { name: 'Marca mașinii' })
    .locator('[aria-checked="true"]');
  await shown.click();
  const name = (await shown.textContent())?.trim() ?? '';

  await bar(page, 'ro').getByRole('link', { name: COPY.ro.find }).click();

  await expect(page).toHaveURL(/\/ro\/garages\?brand=/);
  await expect(page.getByText(name).first()).toBeVisible();
});

// @traces 228-FR-002
test.describe('on a phone', () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test('hides the site bar links, keeps the tab bar, and the section is reached by scrolling', async ({
    page,
  }) => {
    await ready(page, '/ro');

    await expect(bar(page, 'ro')).toBeHidden();
    await expect(page.locator('mf-public-tab-bar')).toBeVisible();
    await section(page).scrollIntoViewIfNeeded();
    await expect(section(page)).toBeInViewport();
  });
});

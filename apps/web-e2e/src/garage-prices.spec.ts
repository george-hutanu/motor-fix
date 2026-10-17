import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seed's Service Auto Militari owns the brief's price list: six jobs, the
// suspension check from 350 lei with no top, a BMW range on front brakes and
// labour 180–240 lei.
const OWNER = 'militari@example.test';

const JOBS = [
  'Diagnoză și citire coduri de eroare',
  'Schimb de ulei și filtre',
  'Plăcuțe și discuri de frână față',
  'Kit lanț de distribuție',
  'Încărcare freon climă',
  'Verificare suspensie și geometrie',
];

const title = (page: Page) => page.getByRole('heading', { level: 1 });
const language = (page: Page) =>
  page.getByRole('group', { name: /^(Limba|Language)$/ });
const rows = (page: Page) => page.locator('[data-row]');
const row = (page: Page, name: string) =>
  rows(page).filter({ has: page.locator('[data-name]', { hasText: name }) });

async function signedIn(page: Page, email: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
  // Romanian whatever an earlier run left saved on the shared account.
  await language(page).getByRole('button', { exact: true, name: 'RO' }).click();
}

async function seesTheList(page: Page) {
  await expect(title(page)).toHaveText('Prețuri');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    'Lista de prețuri',
  );
  await expect(rows(page).locator('[data-name]')).toHaveText(JOBS);

  const suspension = row(page, 'Verificare suspensie și geometrie');
  await expect(suspension).toHaveAttribute('data-public', 'false');
  await expect(suspension.locator('[data-state]')).toHaveText(
    'ascuns · fără preț maxim',
  );
  await expect(suspension.locator('[data-price]')).toHaveText('de la 350 lei');
  await expect(
    row(page, 'Plăcuțe și discuri de frână față').locator('[data-brand]'),
  ).toHaveText(['BMW · 1.100–1.700 lei']);
  await expect(page.locator('[data-labour]')).toHaveText(
    'Manoperă: 180–240 lei / oră. Minimul e mașina mică și simplă, maximul e cea mare sau dificilă.',
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBe(0);
}

// @seeded: signs in as the seeded accounts against the real API.
test.describe('the garage price list @seeded', () => {
  for (const [size, width, height] of [
    ['a desktop', 1440, 900],
    ['a 390 px phone', 390, 844],
  ] as const) {
    // @traces 172-price-list-states-FR-001 172-price-list-states-FR-002 172-price-list-states-FR-003 172-price-list-states-FR-004 172-price-list-states-FR-005 172-price-list-states-FR-006 172-price-list-states-FR-011
    test(`the owner reads each job's state, its brand range and the labour note on ${size}, in Romanian and English`, async ({
      page,
    }) => {
      // Signed in at desktop width, where the header carries the button.
      await signedIn(page, OWNER);
      await page.setViewportSize({ height, width });
      await page.goto('/app/garage/prices');

      await seesTheList(page);

      await language(page)
        .getByRole('button', { exact: true, name: 'EN' })
        .click();
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(
        'Price list',
      );
      const suspension = row(page, 'Suspension check and alignment');
      await expect(suspension.locator('[data-state]')).toHaveText(
        'hidden · no top price set',
      );
      await expect(suspension.locator('[data-price]')).toHaveText(
        'from 350 lei',
      );
      await expect(
        row(page, 'Front brake pads and discs').locator('[data-brand]'),
      ).toHaveText(['BMW · 1,100–1,700 lei']);
      await expect(page.locator('[data-labour]')).toHaveText(
        'Labour: 180–240 lei / hour. The low end is the small, easy car; the high end is the big or awkward one.',
      );

      await language(page)
        .getByRole('button', { exact: true, name: 'RO' })
        .click();
      await seesTheList(page);
    });
  }

  // @traces 172-price-list-states-FR-009 172-price-list-states-FR-011
  test('the receptionist finds no Prețuri and its address returns to the dashboard', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, ACCOUNTS.receptionist);
    const menu = page.getByRole('navigation', { name: 'Meniu' });

    await expect(
      menu.getByRole('link', { exact: true, name: 'Programări' }),
    ).toBeVisible();
    await expect(
      menu.getByRole('link', { exact: true, name: 'Prețuri' }),
    ).toHaveCount(0);

    await page.goto('/app/garage/prices');
    await expect(page).toHaveURL('/app/garage');
  });
});

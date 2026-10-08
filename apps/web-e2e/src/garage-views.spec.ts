import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// [entry in the menu, tab in the bar, address, title, the line under it]
const VIEWS = [
  ['Panou', 'Panou', '/app/garage', 'Panou service', 'Atelier Test'],
  [
    'Cereri de ofertă',
    'Cereri',
    '/app/garage/requests',
    'Cereri de ofertă',
    'Răspunde în mai puțin de o oră ca să apari primul la șofer.',
  ],
  [
    'Programări',
    'Program',
    '/app/garage/schedule',
    'Programări',
    'Programările pe zile, pe mecanici și pe elevatoare',
  ],
  [
    'Mecanici',
    'Mecanici',
    '/app/garage/team',
    'Mecanici',
    'Echipa ta și ce poate face fiecare',
  ],
  [
    'Prețuri',
    'Prețuri',
    '/app/garage/prices',
    'Prețuri',
    'Intervalele pe care le văd șoferii pe profilul tău',
  ],
  [
    'Recenzii',
    'Recenzii',
    '/app/garage/reviews',
    'Recenzii',
    'Ce spun șoferii despre service',
  ],
  [
    'Profilul service‑ului',
    'Profil',
    '/app/garage/profile',
    'Profilul service‑ului',
    'Așa te văd șoferii pe hartă',
  ],
  [
    'Setări',
    'Setări',
    '/app/garage/settings',
    'Setări',
    'Contul, notificările și funcțiile service‑ului',
  ],
  [
    'Istoric modificări',
    'Istoric',
    '/app/garage/history',
    'Istoric modificări',
    'Cine a schimbat ce și când',
  ],
] as const;

const title = (page: Page) => page.getByRole('heading', { level: 1 });
const line = (page: Page) => page.locator('header .line');
const language = (page: Page) =>
  page.getByRole('group', { name: /^(Limba|Language)$/ });

async function signedIn(page: Page, email: string) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
  // The account's language is shared with specs running beside this one.
  await language(page).getByRole('button', { exact: true, name: 'RO' }).click();
  await expect(title(page)).toHaveText('Panou service');
}

// A marker that a reload would lose.
const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __mf: number }).__mf = 1;
  });
const marked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mf?: number }).__mf);

// @seeded: signs in as the seeded accounts against the real API.
test.describe('garage views @seeded', () => {
  // @traces 097-FR-001 097-FR-002 097-FR-003 097-FR-006 097-FR-011
  test('the owner opens every released view from the menu, each with its own address, title and line', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, ACCOUNTS.garage);
    await mark(page);
    const menu = page.getByRole('navigation', { name: 'Meniu' });

    await expect(page.locator('aside .eyebrow')).toHaveText('CONT SERVICE');
    await expect(line(page)).toHaveText('Atelier Test');
    await expect(menu.getByRole('link')).toHaveText(
      VIEWS.map(([entry]) => entry),
    );
    await expect(menu.getByRole('link', { name: 'Asistent AI' })).toHaveCount(
      0,
    );
    for (const [entry, , address, text, under] of [
      ...VIEWS.slice(1),
      VIEWS[0],
    ]) {
      await menu.getByRole('link', { exact: true, name: entry }).click();
      await expect(page).toHaveURL(address);
      await expect(title(page)).toHaveText(text);
      await expect(line(page)).toHaveText(under);
      expect(await marked(page)).toBe(1);
    }

    await page.goto('/app/garage/prices');
    await expect(title(page)).toHaveText('Prețuri');
    await expect(page.locator('main')).toContainText(
      'Aici vei vedea intervalele de preț pe lucrări.',
    );

    await page.goto('/app/garage/assistant');
    await expect(page).toHaveURL('/app/garage');
  });

  // @traces 097-FR-002 097-FR-010
  test('the owner reaches every released view from the bar on a 390 px phone, with the short labels', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await signedIn(page, ACCOUNTS.garage);
    await mark(page);
    const bar = page.getByRole('navigation', { name: 'Panou service' });

    await expect(bar.getByRole('link')).toHaveText(VIEWS.map(([, tab]) => tab));
    for (const [, tab, address, text] of [...VIEWS.slice(1), VIEWS[0]]) {
      await bar.getByRole('link', { exact: true, name: tab }).click();
      await expect(page).toHaveURL(address);
      await expect(title(page)).toHaveText(text);
      expect(await marked(page)).toBe(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
    }
  });

  // @traces 097-FR-003 097-FR-006 097-FR-010
  test('the dashboard turns English without a reload and back, with no sideways scroll at 320 px', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 700, width: 320 });
    await signedIn(page, ACCOUNTS.garage);
    await mark(page);
    const bar = page.getByRole('navigation', {
      name: /^(Panou service|Garage dashboard)$/,
    });

    await language(page)
      .getByRole('button', { exact: true, name: 'EN' })
      .click();
    await expect(title(page)).toHaveText('Garage dashboard');
    await expect(page.locator('aside .eyebrow')).toHaveText('GARAGE ACCOUNT');
    await expect(bar.getByRole('link')).toHaveText([
      'Home',
      'Requests',
      'Schedule',
      'Team',
      'Prices',
      'Reviews',
      'Profile',
      'Settings',
      'History',
    ]);
    await bar.getByRole('link', { exact: true, name: 'History' }).click();
    await expect(title(page)).toHaveText('Change history');
    expect(await marked(page)).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);

    await language(page)
      .getByRole('button', { exact: true, name: 'RO' })
      .click();
    await expect(title(page)).toHaveText('Istoric modificări');
  });

  // @traces 097-FR-008
  test('the owner of a garage not yet approved reads that its profile is being checked', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, ACCOUNTS.garage);

    await expect(page.locator('main')).toContainText(
      'Profilul tău e în verificare.',
    );
    await expect(line(page)).toHaveText('Atelier Test');
    await expect(
      page.getByRole('navigation', { name: 'Meniu' }).getByRole('link'),
    ).toHaveCount(VIEWS.length);

    await language(page)
      .getByRole('button', { exact: true, name: 'EN' })
      .click();
    await expect(page.locator('main')).toContainText(
      'Your profile is being checked.',
    );
    await language(page)
      .getByRole('button', { exact: true, name: 'RO' })
      .click();
  });

  // @traces 097-FR-009
  test('a driver who opens the garage dashboard lands on their own', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');

    for (const address of ['/app/garage', '/app/garage/prices']) {
      await page.goto(address);
      await expect(page).toHaveURL('/app/driver');
      await expect(page.getByText('Atelier Test')).toHaveCount(0);
    }
  });
});

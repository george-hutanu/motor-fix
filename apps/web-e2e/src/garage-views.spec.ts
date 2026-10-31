import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn, signUpDriver } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage, savedLanguage } from './seeded-language.js';

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
    'Lucrări',
    'Lucrări',
    '/app/garage/jobs',
    'Lucrări',
    'Lucrările confirmate, de azi încolo',
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
    'Reparații clienți',
    'Reparații clienți',
    '/app/garage/client-repairs',
    'Reparații adăugate de clienți',
    'Reparațiile pe care clienții le‑au înregistrat la tine și le partajează',
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

// Cereri de ofertă carries the number of waiting requests once there are any:
// its text then ends in the chip's number (99+ past 99) and the screen-reader-only
// "<n> în așteptare", which also completes its name.
const COUNTED = ['Cereri de ofertă', 'Cereri', 'Requests'];
const shown = (label: string) =>
  COUNTED.includes(label)
    ? new RegExp(`^${label}\\s*(\\d+\\+?\\s*\\d+ (în așteptare|waiting))?$`)
    : label;
const named = (label: string) =>
  COUNTED.includes(label)
    ? new RegExp(`^${label}( \\d+ (în așteptare|waiting))?$`)
    : label;

const title = (page: Page) => page.getByRole('heading', { level: 1 });
const line = (page: Page) => page.locator('header .line');
const language = (page: Page) =>
  page.getByRole('group', { name: /^(Limba|Language)$/ });

async function signedIn(page: Page, email: string, heading = 'Panou service') {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
  // Romanian whatever an earlier run left saved on the shared account.
  await language(page).getByRole('button', { exact: true, name: 'RO' }).click();
  await expect(title(page)).toHaveText(heading);
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
  // @traces 097-FR-001 097-FR-002 097-FR-003 097-FR-006
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
      VIEWS.map(([entry]) => shown(entry)),
    );
    await expect(menu.getByRole('link', { name: 'Asistent AI' })).toHaveCount(
      0,
    );
    for (const [entry, , address, text, under] of [
      ...VIEWS.slice(1),
      VIEWS[0],
    ]) {
      await menu.getByRole('link', { name: named(entry) }).click();
      await expect(page).toHaveURL(address);
      await expect(title(page)).toHaveText(text);
      await expect(line(page)).toHaveText(under);
      expect(await marked(page)).toBe(1);
    }

    await page.goto('/app/garage/prices');
    await expect(title(page)).toHaveText('Prețuri');
    // The test garage lists no jobs: the price list's empty panel, with the
    // owner's switch into editing above it.
    await expect(page.locator('main')).toContainText('Lista de prețuri');
    await expect(
      page.locator('main').getByRole('button', { name: 'Modifică prețurile' }),
    ).toBeVisible();
    await expect(page.locator('main')).toContainText(
      'Nu ai încă lucrări în listă.',
    );

    await page.goto('/app/garage/assistant');
    await expect(page).toHaveURL('/app/garage');
  });

  // @traces 097-FR-002 097-FR-010
  test('the owner reaches every released view from the bar on a 390 px phone, with the short labels', async ({
    page,
  }) => {
    // Signed in at desktop width, where the header carries the button.
    await signedIn(page, ACCOUNTS.garage);
    await page.setViewportSize({ height: 844, width: 390 });
    await mark(page);
    const bar = page.getByRole('navigation', { name: 'Panou service' });

    await expect(bar.getByRole('link')).toHaveText(
      VIEWS.map(([, tab]) => shown(tab)),
    );
    for (const [, tab, address, text] of [...VIEWS.slice(1), VIEWS[0]]) {
      await bar.getByRole('link', { name: named(tab) }).click();
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
    request,
  }) => {
    await signedIn(page, ACCOUNTS.garage);
    await page.setViewportSize({ height: 700, width: 320 });
    await mark(page);
    const bar = page.getByRole('navigation', {
      name: /^(Panou service|Garage dashboard)$/,
    });

    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/me') &&
        response.request().method() === 'PATCH',
    );
    await language(page)
      .getByRole('button', { exact: true, name: 'EN' })
      .click();
    await expect(title(page)).toHaveText('Garage dashboard');
    await saved;
    // The owner is shared with every worker: the page turns, the account not.
    expect(await savedLanguage(request, ACCOUNTS.garage)).toBe('ro');
    await expect(page.locator('aside .eyebrow')).toHaveText('GARAGE ACCOUNT');
    await expect(bar.getByRole('link')).toHaveText([
      'Home',
      shown('Requests'),
      'Schedule',
      'Jobs',
      'Team',
      'Prices',
      'Reviews',
      'Profile',
      'Client repairs',
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

  // @traces 097-FR-008 101-FR-007 101-FR-013
  test('the owner of a garage not yet approved reads that its profile is being checked, with no view open @core', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, ACCOUNTS.draftOwner, 'Profilul tău e în verificare');

    await expect(page.locator('mf-verification-progress')).toBeVisible();
    await expect(title(page)).toHaveText('Profilul tău e în verificare');
    await expect(line(page)).toHaveText('Atelier Nou');
    await expect(
      page.getByRole('navigation', { name: 'Meniu' }).getByRole('link'),
    ).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Meniu' }).getByRole('button'),
    ).toHaveText(['Ajutor și contact']);

    await language(page)
      .getByRole('button', { exact: true, name: 'EN' })
      .click();
    await expect(title(page)).toHaveText('Your profile is being checked');
    await language(page)
      .getByRole('button', { exact: true, name: 'RO' })
      .click();
  });

  // @traces 097-FR-009
  // A driver of its own: the seeded one is signed in and out by many specs
  // running beside this one.
  test('a driver who opens the garage dashboard lands on their own', async ({
    page,
    request,
  }) => {
    const driver = await signUpDriver(request, 'fara-atelier');
    await ready(page, '/ro');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, driver);
    await expect(page).toHaveURL('/app/driver');

    for (const address of ['/app/garage', '/app/garage/prices']) {
      await page.goto(address);
      await expect(page).toHaveURL('/app/driver');
      await expect(page.getByText('Atelier Test')).toHaveCount(0);
    }
  });
});

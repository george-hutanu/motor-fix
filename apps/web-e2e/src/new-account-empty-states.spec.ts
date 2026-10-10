import { expect, type Page } from '@playwright/test';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

// A fake password for the account this test creates; never a real one.
const NEW_PASSWORD = 'parola-noua-de-test';

const fresh = () =>
  `gol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

// Sign-up is limited per address per hour: each run signs up from its own.
async function ownAddress(page: Page) {
  const address = `198.51.100.${Date.now() % 250}`;
  await page.route('**/api/v1/auth/sign-up', (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': address },
    }),
  );
}

async function signUp(page: Page) {
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
  await form.getByLabel('Nume').fill('Elena Gol');
  await form.getByLabel('E‑mail').fill(fresh());
  await form.getByLabel('Parolă', { exact: true }).fill(NEW_PASSWORD);
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Creează contul' }).click();
  await expect(page).toHaveURL('/app/driver');
}

const main = (page: Page) => page.getByRole('main');
const invitation = (page: Page, key: 'car' | 'search') =>
  page.locator(`[data-invitation="${key}"]`);

test.describe('a new account sees helpful empty states @seeded', () => {
  // @traces 030-FR-002, 030-FR-003, 030-FR-004
  test('a new driver is invited to add a car and to find a garage, in Romanian and English', async ({
    page,
  }) => {
    await signUp(page);

    await expect(invitation(page, 'car')).toContainText(
      'Adaugă prima ta mașină',
    );
    await expect(invitation(page, 'search')).toContainText(
      'Caută un service pentru mașina ta',
    );
    await expect(main(page)).toContainText(
      'Încă nu ai oferte. Trimite o cerere și compari ofertele aici.',
    );
    await expect(main(page)).toContainText(
      'Nicio reparație încă. Reparațiile făcute prin MotorFix apar aici singure.',
    );
    await expect(main(page)).not.toContainText('Cerere nouă');

    await invitation(page, 'car')
      .getByRole('button', { exact: true, name: 'Adaugă o mașină' })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Adaugă o mașină' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Adaugă o mașină' }),
    ).toBeHidden();

    await page.getByRole('button', { exact: true, name: 'EN' }).click();
    await expect(invitation(page, 'car')).toContainText('Add your first car');
    await expect(invitation(page, 'search')).toContainText(
      'Find a garage for your car',
    );

    await invitation(page, 'search')
      .getByRole('link', { exact: true, name: 'Find a garage' })
      .click();
    await expect(page).toHaveURL(/\/en\/?$/);
  });

  // @traces 030-FR-009, 030-FR-011
  test('a new driver finds each view’s own empty state, never the shared placeholder', async ({
    page,
  }) => {
    await signUp(page);

    const views: [string, string, string][] = [
      [
        '/app/driver/cars',
        'Adaugă prima ta mașină. O folosim ca să‑ți arătăm service‑urile potrivite și să‑ți amintim de ITP.',
        'Add your first car. We use it to show you the right garages and to remind you about the ITP.',
      ],
      [
        '/app/driver/requests',
        'Nicio cerere încă. Cere oferte de la mai multe service‑uri deodată.',
        'No requests yet. Ask several garages for a quote at once.',
      ],
      [
        '/app/driver/reviews',
        'Nicio recenzie încă. După o reparație prin MotorFix îți cerem părerea.',
        'No reviews yet. After a repair through MotorFix we ask what you think.',
      ],
      [
        '/app/driver/saved',
        'Nu ai salvat încă niciun service.',
        'You have not saved any garage yet.',
      ],
    ];

    for (const [path, ro] of views) {
      await page.goto(path);
      await expect(main(page)).toContainText(ro);
      await expect(main(page)).not.toContainText('Nimic aici încă.');
    }

    await page.getByRole('button', { exact: true, name: 'EN' }).click();
    for (const [path, , en] of views) {
      await page.goto(path);
      await expect(main(page)).toContainText(en);
      await expect(main(page)).not.toContainText('Nothing here yet.');
    }
  });
});

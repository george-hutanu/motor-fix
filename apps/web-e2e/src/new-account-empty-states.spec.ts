import { expect, type Page } from '@playwright/test';

import { ownAddress, ready } from './accounts.js';
import { test } from './fixtures.js';

// A fake password for the account this test creates; never a real one.
const NEW_PASSWORD = 'parola-noua-de-test';

const fresh = () =>
  `gol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUp(page: Page) {
  await ownAddress(page, '198.51.100');
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

  // @traces 030-FR-012
  test('Panou on a new account fits a 320 px phone with no text under 12 px', async ({
    page,
  }) => {
    // A phone shows an account icon, not the Autentificare button: sign up wide.
    await signUp(page);
    await page.setViewportSize({ height: 640, width: 320 });
    await expect(invitation(page, 'search')).toBeVisible();

    const sideways = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(sideways).toBe(false);
    const smallest = await main(page).evaluate((root) =>
      Math.min(
        ...[...root.querySelectorAll('mf-empty-state *, mf-panel h2')]
          .filter((e) => e.textContent?.trim())
          .map((e) => Number.parseFloat(getComputedStyle(e).fontSize)),
      ),
    );
    expect(smallest).toBeGreaterThanOrEqual(12);
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

  // @traces 029-FR-009 029-FR-013 029-FR-014
  test('a new driver adds a car from Mașinile mele on Panou and sees it at once and after a reload', async ({
    page,
  }) => {
    await signUp(page);
    const cars = page.locator('[data-panel="cars"]');
    await expect(cars).toContainText('Adaugă prima ta mașină');

    await cars
      .getByRole('button', { exact: true, name: 'Adaugă o mașină' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Adaugă o mașină' });
    await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
    await dialog.getByLabel('Marcă').fill('BMW');
    await dialog.getByRole('option', { exact: true, name: 'BMW' }).click();
    await dialog.getByLabel('Model').fill('320d');
    await dialog.getByLabel('An', { exact: true }).fill('2019');
    await dialog.getByLabel('Kilometri').fill('148200');
    await dialog.getByRole('radio', { name: 'Motorină' }).check();
    await dialog.getByRole('button', { name: 'Adaugă mașina' }).click();
    await expect(dialog).toHaveCount(0);

    const card = cars.locator('li').filter({ hasText: 'BMW 320d' });
    await expect(card).toContainText('2019 · 148.200 km');
    await expect(card).toContainText('ITP: adaugă data din talon');
    await expect(invitation(page, 'car')).toHaveCount(0);

    await page.reload();
    await expect(card).toContainText('2019 · 148.200 km');

    await page.setViewportSize({ height: 640, width: 320 });
    await expect(card).toBeVisible();
    const sideways = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(sideways).toBe(false);
  });
});

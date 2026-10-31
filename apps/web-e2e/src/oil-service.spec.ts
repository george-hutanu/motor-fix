// @traces 1386-FR-001 1386-FR-003 1386-FR-004 1386-FR-005 1386-FR-007

import { expect, type Page } from '@playwright/test';

import { openSignIn, ready, signIn, signUpDriver } from './accounts.js';
import { test } from './fixtures.js';

const card = (page: Page) =>
  page.locator('[data-car]').filter({ hasText: 'BMW 320d' });
const oilLamp = (page: Page) => card(page).locator('mf-oil-line mf-lamp');

async function addBmw(page: Page, next: string) {
  await page
    .getByRole('button', { exact: true, name: 'Adaugă o mașină' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Adaugă o mașină' });
  await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
  await dialog.getByLabel('Marcă').fill('BMW');
  await dialog.getByRole('option', { exact: true, name: 'BMW' }).click();
  await dialog.getByLabel('Model').fill('320d');
  await dialog.getByLabel('An', { exact: true }).fill('2019');
  await dialog.getByLabel('Kilometri').fill('148.200');
  await dialog.getByLabel('Următorul schimb de ulei la (km)').fill(next);
  await dialog.getByRole('radio', { name: 'Motorină' }).check();
  await dialog.getByRole('button', { name: 'Adaugă mașina' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page)).toBeVisible();
}

test.describe('a driver sets the next oil service and sees its lamp @seeded', () => {
  test('asks for it on a grey line, refuses one below the kilometres, then judges it green and amber', async ({
    page,
    request,
  }) => {
    const email = await signUpDriver(request, 'ulei');
    await ready(page, '/ro');
    await openSignIn(page);
    await signIn(page, email);
    await expect(page).toHaveURL('/app/driver');
    await page.goto('/app/driver/cars');

    // Added without one, the card asks for it on a grey line.
    await addBmw(page, '');
    const grey = card(page).getByRole('button', {
      exact: true,
      name: 'Schimb de ulei: adaugă kilometrajul',
    });
    await expect(grey).toBeVisible();
    await grey.click();
    const edit = page.getByRole('dialog', { name: 'Modifică mașina' });
    const next = edit.getByLabel('Următorul schimb de ulei la (km)');
    await expect(next).toBeFocused();

    // Not above the kilometres: refused on the field, nothing sent.
    await next.fill('148.000');
    await edit.getByRole('button', { name: 'Salvează' }).click();
    await expect(edit.locator('#mf-car-nextServiceKm-error')).toHaveText(
      'Valoarea trebuie să fie mai mare decât kilometrajul actual (148.200 km).',
    );
    await expect(next).toHaveAttribute('aria-invalid', 'true');

    // 152.000 at 148.200 km: 3.800 km left, months away, green.
    await next.fill('152.000');
    await edit.getByRole('button', { name: 'Salvează' }).click();
    await expect(edit).toHaveCount(0);
    await expect(oilLamp(page)).toHaveText('Schimb de ulei peste 3.800 km');
    await expect(oilLamp(page)).toHaveAttribute('data-state', 'green');

    // 150.500 km read: 1.500 km left, about six weeks, amber.
    await card(page)
      .getByRole('button', { exact: true, name: 'Acțiuni pentru BMW 320d' })
      .click();
    await page.getByRole('menuitem', { exact: true, name: 'Modifică' }).click();
    const again = page.getByRole('dialog', { name: 'Modifică mașina' });
    await expect(
      again.getByLabel('Următorul schimb de ulei la (km)'),
    ).toHaveValue('152.000');
    await again.getByLabel('Kilometri').fill('150.500');
    await again.getByRole('button', { name: 'Salvează' }).click();
    await expect(again).toHaveCount(0);
    await expect(oilLamp(page)).toHaveText('Schimb de ulei peste 1.500 km');
    await expect(oilLamp(page)).toHaveAttribute('data-state', 'amber');
  });
});

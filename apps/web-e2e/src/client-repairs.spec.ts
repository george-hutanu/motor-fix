import { expect } from '@playwright/test';

import { ACCOUNTS, signedIn } from './accounts.js';
import { test } from './fixtures.js';
import { accessToken, bearer } from './quoted-request.js';
import { type SharedRepair, sharedRepair } from './shared-repair.js';

// @traces 1400-FR-011
test.describe('correcting a shared repair from the garage dashboard @seeded @database', () => {
  let repair: SharedRepair | undefined;

  test.afterEach(async () => {
    await repair?.remove();
    repair = undefined;
  });

  test('the owner corrects the reading, the row reads Corectată pe and the driver’s bell tells it', async ({
    page,
    request,
  }) => {
    // Signing in and the save, then up to 60 s for the driver's bell.
    test.setTimeout(90_000);
    repair = await sharedRepair(request, 14_300);
    const driver = bearer(
      await accessToken(request, repair.driver.email, repair.driver.password),
    );

    await page.setViewportSize({ height: 844, width: 390 });
    await signedIn(page, ACCOUNTS.garage, /\/app\/garage/);
    await page.goto('/app/garage/client-repairs');
    const row = page.locator(`li[data-repair="${repair.id}"]`);
    await expect(row.locator('.km')).toHaveText('14.300 km');
    await expect(row.locator('.corrected')).toHaveCount(0);

    await row.locator('[data-correct]').click();
    const dialog = page.getByRole('dialog', { name: 'Corectează reparația' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Kilometraj').fill('14500');
    await dialog.getByRole('button', { exact: true, name: 'Salvează' }).click();
    await expect(dialog).toBeHidden();

    await expect(row.locator('.km')).toHaveText('14.500 km');
    await expect(row.locator('.corrected')).toContainText('Corectată pe');

    // The driver's bell: "<garage> a corectat o reparație din istoricul <car>."
    const garage = repair.garage;
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/v1/notifications', {
            headers: driver,
          });
          expect(res.ok()).toBe(true);
          const { items } = (await res.json()) as {
            items: { kind: string; text: string }[];
          };
          return items
            .filter((item) => item.kind === 'REPAIR_UPDATED')
            .map((item) => item.text);
        },
        { timeout: 60_000 },
      )
      .toContainEqual(expect.stringContaining(`${garage} a corectat`));
  });
});

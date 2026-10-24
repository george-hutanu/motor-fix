import { expect, type Locator, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { type PastJob, pastJob } from './past-job.js';

async function openTeam(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.garage);
  await expect(page).toHaveURL('/app/garage');
  await page.goto('/app/garage/team');
  return page.getByRole('region', { name: 'Echipa' });
}

// The width check after the add, the edit of her specialties and her removal.
async function removeAfterEdit(page: Page, row: Locator, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await row.getByRole('button').click();
  const edit = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Nume') });
  await expect(edit.getByLabel('Nume')).toHaveValue(name);
  await expect(edit.getByRole('checkbox', { name: 'Dacia' })).toBeChecked();
  await edit.getByLabel('Specialități').fill('Frâne, Suspensie');
  await edit.getByRole('button', { name: 'Salvează' }).click();
  await expect(edit).toBeHidden();
  await expect(row).toContainText('Frâne, Suspensie · 21 de ani', {
    timeout: 5_000,
  });

  await row.getByRole('button').click();
  await page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Nume') })
    .getByRole('button', { exact: true, name: 'Elimină' })
    .click();
  const confirmation = page
    .getByRole('dialog')
    .filter({ hasText: `Elimini pe ${name} din echipă?` });
  await confirmation
    .getByRole('button', { exact: true, name: 'Elimină' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toHaveCount(0, { timeout: 5_000 });
}

// @traces 056-FR-023
test.describe('the garage team, written by the owner @seeded', () => {
  test('the owner adds Elena, edits her specialties and removes her; a past job keeps its mechanic', async ({
    page,
    request,
  }) => {
    test.skip(
      !process.env['DATABASE_URL'],
      "writes Elena's past job straight to PostgreSQL, which needs DATABASE_URL",
    );
    // Unique per run: the seeded database keeps what an earlier run wrote.
    const name = `Elena Stan ${Math.random().toString(36).slice(2, 8)}`;
    const panel = await openTeam(page);
    const row = panel.getByRole('listitem').filter({ hasText: name });

    await expect(panel.getByRole('listitem').first()).toContainText(
      'proprietar',
    );

    await panel
      .getByRole('button', { exact: true, name: 'Adaugă un mecanic' })
      .click();
    const add = page.getByRole('dialog', { name: 'Adaugă un mecanic' });
    await add.getByLabel('Nume').fill(name);
    await add.getByLabel('Rol').fill('Mecanic șef');
    await add.getByLabel('Specialități').fill('Frâne, Suspensie, Geometrie');
    await add.getByLabel('Certificări').fill('Bosch Car Service');
    await add.getByLabel('Ani de experiență').fill('21');
    await add.getByRole('checkbox', { name: 'Dacia' }).check();
    await add.getByRole('button', { name: 'Salvează' }).click();
    await expect(add).toBeHidden();

    await expect(row).toContainText('Frâne, Suspensie, Geometrie · 21 de ani', {
      timeout: 5_000,
    });
    await expect(row).toContainText('nu apare pe profil · fără cont');
    await expect(row).toContainText('fără recenzii');
    let job: PastJob | undefined;
    try {
      job = await pastJob(request, name);
      await removeAfterEdit(page, row, name);

      // The job Elena finished earlier today keeps her name after the removal.
      await page.goto('/app/garage/jobs');
      await expect(
        page.locator('[data-job]', { hasText: job.plate }),
      ).toContainText(name, { timeout: 5_000 });
    } finally {
      await job?.remove();
    }
  });

  test("the owner's own row opens with no Elimină", async ({ page }) => {
    const panel = await openTeam(page);
    const owner = panel.getByRole('listitem').first();
    await expect(owner).toContainText('proprietar');

    await owner.getByRole('button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Nume')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Salvează' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { exact: true, name: 'Elimină' }),
    ).toHaveCount(0);
  });
});

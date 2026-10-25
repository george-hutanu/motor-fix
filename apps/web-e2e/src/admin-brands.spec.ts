// @traces 1368-FR-009 1368-FR-010
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { violations } from './axe.js';
import { deleteBrand } from './delete-brand.js';
import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signInAsAdmin(page: Page) {
  await ready(page, '/ro/garages');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { exact: true, name: 'Cont' })
      .click();
  } else {
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
  }
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
}

const list = (page: Page) => page.locator('mf-admin-brands');
const row = (page: Page, name: string) =>
  list(page).locator('tbody tr', { hasText: name });

// An admin adds a brand no garage has yet, through the real dialog, and the
// brand reaches every place a brand is offered: the listing's brands step,
// its results page and Home's search. The brand is removed afterwards; a
// deployed address, whose run has no DATABASE_URL, skips the file.
test.describe('the admin brand list @seeded @database', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'removes the brand it adds straight from PostgreSQL, which needs DATABASE_URL',
  );
  test.describe.configure({ mode: 'serial' });

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = `Marca Noua ${stamp}`;
  let db: Client;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM brand WHERE name = $1',
      [name],
    );
    for (const { id } of rows) await deleteBrand(db, id);
    await db.end();
  });

  test('adds a brand, retires it and brings it back', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/app/admin/catalogue');
    await expect(
      list(page).getByRole('heading', { name: 'Lista de mărci' }),
    ).toBeVisible();

    await list(page).getByRole('button', { name: 'Adaugă o marcă' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adaugă o marcă' });
    await dialog.getByLabel('Numele mărcii').fill(name);
    await dialog.getByRole('button', { exact: true, name: 'Adaugă' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(row(page, name)).toContainText('activă');
    await row(page, name)
      .getByRole('button', { name: `Retrage ${name}` })
      .click();
    await expect(row(page, name)).toContainText('retrasă');
    await row(page, name)
      .getByRole('button', { name: `Readuce ${name}` })
      .click();
    await expect(row(page, name)).toContainText('activă');

    await list(page).getByRole('searchbox').fill(stamp.toUpperCase());
    await expect(list(page).locator('tbody tr')).toHaveCount(1);
  });

  test('offers the new brand in the listing, on its results page and on Home', async ({
    page,
  }) => {
    const { rows } = await db.query<{ slug: string }>(
      'SELECT slug FROM brand WHERE name = $1',
      [name],
    );
    const slug = rows[0]?.slug ?? '';
    expect(slug).not.toBe('');

    await page.goto('/ro/list-your-garage');
    const step = page.locator('mf-brands-step');
    await expect(step.locator('.chips > li > button').first()).toBeVisible();
    await step.locator('input[type="search"]').fill(stamp);
    await expect(
      step.locator('.results button', { hasText: name }),
    ).toBeVisible();

    await ready(page, `/ro/garages?brand=${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `Cine primește ${name}`,
    );

    await ready(page, '/ro');
    await page.getByRole('combobox', { name: 'Caută marca' }).fill(stamp);
    await expect(page.getByRole('option')).toHaveText([name]);
  });

  test('fits a 320 px phone with no sideways scroll and no axe violation', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await signInAsAdmin(page);
    await page.goto('/app/admin/catalogue');
    await list(page).getByRole('searchbox').fill(stamp);
    await expect(row(page, name)).toBeVisible();

    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(
      await violations(page, {}, { include: [['mf-admin-brands']] }),
    ).toEqual([]);
  });
});

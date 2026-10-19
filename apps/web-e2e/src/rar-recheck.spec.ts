import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn, signInAsAdmin2 } from './accounts.js';
import { test } from './fixtures.js';

// Garages of this file's own, written due straight to PostgreSQL: recording
// a seeded garage would move it for every spec running beside this one. A
// deployed address, whose run has no DATABASE_URL, skips the file.
// @traces 1351-FR-007 1351-FR-010 1351-FR-011 1351-FR-015

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const panel = (page: Page) => page.locator('mf-admin-rechecks');
const rowOf = (page: Page, name: string) =>
  panel(page).locator('li.row').filter({ hasText: name });
const dialog = (page: Page) => page.getByRole('dialog');

async function signInAsAdmin(page: Page) {
  await ready(page, '/ro/garages');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { exact: true, name: 'Cont' })
      .click();
  } else {
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
  }
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
}

// The seeded admin reads Romanian; only the language is changed.
async function inEnglish(page: Page) {
  await page.route('**/api/v1/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), language: 'en' },
      response,
    });
  });
}

const bucharestToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
    new Date(),
  );

test.describe('the monthly RAR re-check @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its garages straight to PostgreSQL, which needs DATABASE_URL',
  );

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let db: Client;
  const garageIds: string[] = [];

  const due = async (name: string, slug: string) => {
    const made = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, last_checked_on, rar_activities)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now(),
         (now() AT TIME ZONE 'Europe/Bucharest')::date - 29, ARRAY['mechanics', 'brakes'])
       RETURNING id`,
      [name, slug],
    );
    const id = made.rows[0]?.id ?? '';
    garageIds.push(id);
    return id;
  };
  const stored = async (id: string) =>
    (
      await db.query<{ status: string; checked: string | null }>(
        `SELECT status::text, last_checked_on::text AS checked FROM garage WHERE id = $1`,
        [id],
      )
    ).rows[0];

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [garageIds]);
    await db.end();
  });

  test('records a valid re-check and the row leaves a second admin’s list without a reload', async ({
    browser,
    page,
  }) => {
    const name = `Atelier Reverificat ${stamp}`;
    const id = await due(name, `e2e-reverificat-${stamp}`);
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);
    await page.goto('/app/admin/garages');

    const other = await browser.newContext();
    const second = await other.newPage();
    await second.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin2(second);
    await second.goto('/app/admin/garages');
    await expect(rowOf(second, name)).toHaveCount(1);
    let navigations = 0;
    second.on('framenavigated', (frame) => {
      if (frame === second.mainFrame()) navigations++;
    });

    await expect(panel(page).getByRole('heading', { level: 2 })).toContainText(
      'Reverificări RAR',
    );
    await expect(rowOf(page, name).locator('.days')).toHaveText('29 de zile');
    await rowOf(page, name)
      .getByRole('button', { name: 'Înregistrează' })
      .click();
    await expect(dialog(page).locator('input[type="date"]')).toHaveValue(
      bucharestToday(),
    );
    await dialog(page).getByRole('button', { name: 'Valabilă' }).click();
    await dialog(page).getByRole('button', { name: 'Salvează' }).click();

    await expect(rowOf(page, name)).toHaveCount(0);
    await expect(rowOf(second, name)).toHaveCount(0, { timeout: 2_000 });
    expect(navigations).toBe(0);
    expect((await stored(id))?.checked).toBe(bucharestToday());
    await other.close();
  });

  test('records a failed re-check after confirming, suspending the garage', async ({
    page,
  }) => {
    const name = `Atelier Expirat ${stamp}`;
    const id = await due(name, `e2e-expirat-${stamp}`);
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);
    await page.goto('/app/admin/garages');

    await rowOf(page, name)
      .getByRole('button', { name: 'Înregistrează' })
      .click();
    await dialog(page).getByRole('button', { name: 'Expirată' }).click();
    await dialog(page).locator('textarea').fill('expirată pe 12 sept. 2026');
    await dialog(page)
      .getByRole('button', { name: 'Suspendă service‑ul' })
      .click();
    await expect(dialog(page)).toContainText(
      'Service‑ul va fi suspendat și scos de pe hartă.',
    );
    await dialog(page)
      .getByRole('button', { name: 'Confirmă suspendarea' })
      .click();

    await expect(rowOf(page, name)).toHaveCount(0);
    expect((await stored(id))?.status).toBe('suspended');
    await expect(
      page.locator('mf-admin-suspended li.row').filter({ hasText: name }),
    ).toHaveCount(1, { timeout: 15_000 });
    const profile = await page.request.get(
      `/api/v1/garages/e2e-expirat-${stamp}`,
    );
    expect(profile.status()).toBe(410);
  });

  for (const [language, scheme, heading, days] of [
    ['ro', 'light', 'Reverificări RAR', '29 de zile'],
    ['en', 'dark', 'RAR re-checks', '29 days'],
  ] as const) {
    test(`fits a 320 px phone with no sideways scroll, ${language}, ${scheme}`, async ({
      page,
    }) => {
      const name = `Atelier Îngust ${stamp} ${language}`;
      await due(name, `e2e-ingust-${stamp}-${language}`);
      await page.setViewportSize({ height: 640, width: 320 });
      await page.emulateMedia({ colorScheme: scheme });
      if (language === 'en') await inEnglish(page);
      await signInAsAdmin(page);
      await page.goto('/app/admin/garages');

      await expect(
        panel(page).getByRole('heading', { level: 2 }),
      ).toContainText(heading);
      await expect(rowOf(page, name).locator('.days')).toHaveText(days);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      await rowOf(page, name)
        .getByRole('button', {
          name: language === 'en' ? 'Record' : 'Înregistrează',
        })
        .click();
      await expect(dialog(page)).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});

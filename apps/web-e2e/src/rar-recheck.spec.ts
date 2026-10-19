import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn, signInAsAdmin2 } from './accounts.js';
import { test } from './fixtures.js';

// Garages of this file's own, written due straight to PostgreSQL: recording
// a seeded garage would move it for every spec running beside this one. The
// @database tag keeps the file out of a deployed run, which has no database.
// @traces 1351-FR-007 1351-FR-010 1351-FR-011 1351-FR-015

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const panel = (page: Page) => page.locator('mf-admin-rechecks');
const rowOf = (page: Page, name: string) =>
  panel(page).locator('li.row').filter({ hasText: name });
const dialog = (page: Page) => page.getByRole('dialog');
const cards = (page: Page) =>
  page.getByRole('list', { name: 'Service‑uri găsite' }).getByRole('heading');

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

// A day as the Panou writes it in Romanian: "20 oct. 2026".
const RO_MONTHS = [
  'ian.',
  'feb.',
  'mart.',
  'apr.',
  'mai',
  'iun.',
  'iul.',
  'aug.',
  'sept.',
  'oct.',
  'nov.',
  'dec.',
];
const roDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return `${date} ${RO_MONTHS[(month ?? 1) - 1]} ${year}`;
};

const bucharestToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
    new Date(),
  );

test.describe('the monthly RAR re-check @seeded @database', () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const brand = { name: `Marca Rev ${stamp}`, slug: `marca-rev-${stamp}` };
  const owner = {
    email: `reverificat-${stamp}@example.test`,
    password: 'proprietar-reverificat-2026',
  };
  let db: Client;
  let brandId = '';
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
  // An approved file with every check in order and both documents valid, so
  // the owner's Panou shows the legal check.
  const approvedFile = async (garageId: string) => {
    const file = await db.query<{ id: string }>(
      `INSERT INTO verification_file (id, garage_id, status, opened_at, decided_at)
       VALUES (gen_random_uuid(), $1, 'approved', now(), now())
       RETURNING id::text`,
      [garageId],
    );
    const fileId = file.rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind, result, recorded_at)
       SELECT gen_random_uuid(), $1, k::verification_check_kind, 'ok', now()
       FROM unnest(ARRAY['company', 'caen', 'rar', 'documents']) AS k`,
      [fileId],
    );
    await db.query(
      `INSERT INTO legal_document (verification_file_id, kind, pages, status)
       SELECT $1::uuid, k, ARRAY['legal_document/' || $1::text || '/e2e-' || k || '-1'], 'valid'
       FROM unnest(ARRAY['onrc_certificate', 'rar_authorisation']) AS k`,
      [fileId],
    );
  };
  const ownerOf = async (request: APIRequestContext, garageId: string) => {
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email: owner.email,
        language: 'ro',
        name: `Proprietar ${stamp}`,
        password: owner.password,
      },
      headers: { 'x-forwarded-for': `198.51.100.${(Date.now() + 13) % 250}` },
    });
    expect(signUp.status()).toBe(201);
    const account = await db.query<{ id: string }>(
      'SELECT id FROM account WHERE email = $1',
      [owner.email],
    );
    const accountId = account.rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO account_role (account_id, role) VALUES ($1, 'garage')
       ON CONFLICT DO NOTHING`,
      [accountId],
    );
    await db.query(`UPDATE account SET last_role = 'garage' WHERE id = $1`, [
      accountId,
    ]);
    await db.query(
      `INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'owner')`,
      [garageId, accountId],
    );
  };
  // Where search finds it: a place, and a brand of this file's own.
  const searchable = async (garageId: string) => {
    await db.query(
      `UPDATE garage SET latitude = 44.2, longitude = 24.9, rating = 4.9, review_count = 5
       WHERE id = $1`,
      [garageId],
    );
    await db.query(
      `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
       VALUES ($1, $2, 'works_on', true, true, true, true, now())`,
      [garageId, brandId],
    );
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
    const made = await db.query<{ id: string }>(
      `INSERT INTO brand (id, key, name, slug, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $1, now()) RETURNING id`,
      [brand.slug, brand.name],
    );
    brandId = made.rows[0]?.id ?? '';
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM account WHERE email = $1', [owner.email]);
    await db.query('DELETE FROM search_log WHERE brand_id = $1', [brandId]);
    await db.query('DELETE FROM verification_file WHERE garage_id = ANY($1)', [
      garageIds,
    ]);
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [garageIds]);
    await db.query('DELETE FROM brand WHERE id = $1', [brandId]);
    await db.end();
  });

  test('records a valid re-check: the row leaves a second admin’s list and the owner’s legal panel shows the new date, without a reload', async ({
    browser,
    page,
    request,
  }) => {
    const name = `Atelier Reverificat ${stamp}`;
    const id = await due(name, `e2e-reverificat-${stamp}`);
    await approvedFile(id);
    await ownerOf(request, id);
    const before = (await stored(id))?.checked ?? '';

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await ownerPage.setViewportSize({ height: 800, width: 1280 });
    await ready(ownerPage, '/ro/garages');
    await ownerPage
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(ownerPage, owner.email, { password: owner.password });
    await expect(ownerPage).toHaveURL('/app/garage');
    const documents = ownerPage
      .getByRole('region', { name: 'Verificare legală' })
      .locator('[data-legal-row="documents"]');
    await expect(documents).toContainText(`verificate pe ${roDay(before)}`);
    let ownerNavigations = 0;
    ownerPage.on('framenavigated', (frame) => {
      if (frame === ownerPage.mainFrame()) ownerNavigations++;
    });
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
    await expect(documents).toContainText(
      `verificate pe ${roDay(bucharestToday())}`,
      { timeout: 15_000 },
    );
    expect(ownerNavigations).toBe(0);
    await other.close();
    await ownerContext.close();
  });

  test('records a failed re-check after confirming, suspending the garage and taking it off open results', async ({
    browser,
    page,
  }) => {
    const name = `Atelier Expirat ${stamp}`;
    const id = await due(name, `e2e-expirat-${stamp}`);
    await searchable(id);
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    // Opened where the garage stands: Results searches only from a place.
    await visitor.goto(`/ro/garages?brand=${brand.slug}&near=44.200,24.900`);
    await expect(cards(visitor).filter({ hasText: name })).toHaveCount(1);
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
    await expect(cards(visitor).filter({ hasText: name })).toHaveCount(0, {
      timeout: 15_000,
    });
    await visitorContext.close();
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

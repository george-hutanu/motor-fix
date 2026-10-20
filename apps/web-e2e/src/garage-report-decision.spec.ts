import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// A brand, a listed garage, its owner and a driver of this file's own:
// suspending a seeded garage would take it from every other spec running
// beside this one. The driver reports the garage through the real route, an
// admin confirms the report in the drawer, a visitor's results lose the
// garage and its owner reads the suspension. A deployed address, whose run
// has no DATABASE_URL, skips the file.
// @traces 069-FR-012
test.describe('confirming a garage report @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its brand, garage and accounts straight to PostgreSQL, which needs DATABASE_URL',
  );
  test.describe.configure({ mode: 'serial' });

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const brand = { name: `Marca Sesiz ${stamp}`, slug: `marca-sesiz-${stamp}` };
  const name = `Service Sesizat ${stamp}`;
  const owner = {
    email: `sesizat-${stamp}@example.test`,
    password: 'proprietar-sesizat-2026',
  };
  const driver = {
    email: `raporteaza-${stamp}@example.test`,
    name: `Șofer ${stamp}`,
    password: 'sofer-raporteaza-2026',
  };
  const TEXT = 'Au cerut plata înainte și nu au reparat mașina deloc.';
  const REASON = 'Prețuri false confirmate la telefon';
  let db: Client;
  let brandId = '';
  let garageId = '';
  let fileId = '';

  const cards = (page: Page) =>
    page.getByRole('list', { name: 'Service‑uri găsite' }).getByRole('heading');
  const drawer = (page: Page) => page.locator('mf-verification-file');

  async function account(
    request: APIRequestContext,
    who: { email: string; name: string; password: string },
    n: number,
  ) {
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email: who.email,
        language: 'ro',
        name: who.name,
        password: who.password,
      },
      headers: { 'x-forwarded-for': `203.0.113.${(Date.now() + n) % 250}` },
    });
    expect(signUp.status()).toBe(201);
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM account WHERE email = $1',
      [who.email],
    );
    return rows[0]?.id ?? '';
  }

  test.beforeAll(async ({ request }) => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const made = await db.query<{ id: string }>(
      `INSERT INTO brand (id, key, name, slug, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $1, now()) RETURNING id`,
      [brand.slug, brand.name],
    );
    brandId = made.rows[0]?.id ?? '';
    const garage = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, rating, review_count)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now(), 4.8, 5) RETURNING id`,
      [name, `e2e-sesizat-${stamp}`],
    );
    garageId = garage.rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
       VALUES ($1, $2, 'works_on', true, true, true, true, now())`,
      [garageId, brandId],
    );
    const file = await db.query<{ id: string }>(
      `INSERT INTO verification_file (id, garage_id, status)
       VALUES (gen_random_uuid(), $1, 'approved') RETURNING id::text`,
      [garageId],
    );
    fileId = file.rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind)
       SELECT gen_random_uuid(), $1, kind
       FROM unnest(enum_range(NULL::verification_check_kind)) AS kind`,
      [fileId],
    );
    const ownerId = await account(
      request,
      { ...owner, name: `Proprietar ${stamp}` },
      11,
    );
    await db.query(
      `INSERT INTO account_role (account_id, role) VALUES ($1, 'garage')
       ON CONFLICT DO NOTHING`,
      [ownerId],
    );
    await db.query(`UPDATE account SET last_role = 'garage' WHERE id = $1`, [
      ownerId,
    ]);
    await db.query(
      `INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'owner')`,
      [garageId, ownerId],
    );
    await account(request, driver, 13);
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM outbox_event WHERE subject_id = ANY($1)', [
      [garageId, fileId],
    ]);
    await db.query('DELETE FROM garage_report WHERE garage_id = $1', [
      garageId,
    ]);
    await db.query('DELETE FROM account WHERE email = ANY($1)', [
      [owner.email, driver.email],
    ]);
    await db.query('DELETE FROM search_log WHERE brand_id = $1', [brandId]);
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
    await db.query('DELETE FROM brand WHERE id = $1', [brandId]);
    await db.end();
  });

  test('a driver reports the garage, and its file goes back to review', async ({
    request,
  }) => {
    const signedIn = await request.post('/api/v1/auth/sign-in', {
      data: {
        email: driver.email,
        password: driver.password,
        remember: false,
      },
    });
    expect(signedIn.ok()).toBe(true);
    const { accessToken } = (await signedIn.json()) as { accessToken: string };

    const res = await request.post(`/api/v1/garages/${garageId}/reports`, {
      data: { text: TEXT },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(201);

    const { rows } = await db.query<{ status: string }>(
      'SELECT status::text FROM verification_file WHERE id = $1',
      [fileId],
    );
    expect(rows[0]?.status).toBe('in_review');
  });

  test('an admin reads the report in the drawer and confirms it with a reason', async ({
    page,
  }) => {
    await ready(page, '/ro/garages');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.admin);
    await expect(page).toHaveURL('/app/admin');
    await page.goto(`/app/admin/garages/${fileId}`);
    await expect(drawer(page).locator('h3')).toHaveText(name);

    const part = drawer(page).locator('[data-section="reports"]');
    await expect(part.locator('h4')).toHaveText('SESIZĂRI · 1 DESCHISĂ');
    await expect(part.locator('li.report')).toHaveCount(1);
    await expect(part.locator('.report-text')).toHaveText(TEXT);
    // The drawer names the reporter by first name and initial.
    await expect(part.locator('a.reporter')).toHaveText(
      `Șofer ${stamp.charAt(0)}.`,
    );

    await drawer(page).locator('[data-part="report-confirmed"]').click();
    const dialog = page.getByRole('dialog', { name: 'Sesizare confirmată' });
    await expect(dialog).toContainText(
      'Service‑ul va fi suspendat și va primi acest motiv.',
    );
    await dialog.getByRole('textbox').fill(REASON);
    await dialog.getByRole('button', { name: 'Confirmă și suspendă' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(part.locator('h4')).toHaveText('SESIZĂRI · 0 DESCHISE');
    await expect(part.locator('li.report')).toContainText(`Motiv: ${REASON}`);
    await expect(
      drawer(page).locator('[data-part="report-confirmed"]'),
    ).toHaveCount(0);
    const stored = await db.query<{
      file: string;
      garage: string;
      report: string;
    }>(
      `SELECT f.status::text AS file, g.status::text AS garage, r.status::text AS report
       FROM verification_file f
       JOIN garage g ON g.id = f.garage_id
       JOIN garage_report r ON r.garage_id = g.id
       WHERE f.id = $1`,
      [fileId],
    );
    expect(stored.rows).toEqual([
      { file: 'approved', garage: 'suspended', report: 'confirmed' },
    ]);
  });

  test('the garage leaves the results', async ({ page }) => {
    await page.goto(`/ro/garages?brand=${brand.slug}`);
    // The garage was the brand's only one: the results list only the
    // garages that do not take the brand, and the suspended one is not among them.
    await expect(cards(page).first()).toBeVisible();
    await expect(
      page.getByText(`0 lucrează pe ${brand.name}`, { exact: false }).first(),
    ).toBeVisible();
    await expect(cards(page).filter({ hasText: name })).toHaveCount(0);
  });

  test('its owner reads the suspension and the reason', async ({ page }) => {
    await ready(page, '/ro/garages');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, owner.email, { password: owner.password });
    await expect(page).toHaveURL('/app/garage');

    await expect(
      page.getByRole('alert').filter({ hasText: 'Profil suspendat' }),
    ).toContainText(`Profil suspendat · ${REASON}.`);
  });
});

import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { deleteBrand } from './delete-brand.js';
import { test } from './fixtures.js';

// A brand, a garage and its owner of this file's own: suspending and
// restoring a seeded garage would move it for every spec running beside this
// one. The seeded admin suspends it by recording a failed re-check, then puts
// it back from "Service-uri suspendate" with a valid one, while a visitor's
// results and the owner's dashboard stay open. The @database tag keeps the
// file out of a deployed run, which has no database.
// @traces 067-FR-014 067-FR-007 067-FR-009 067-FR-010
test.describe('putting a suspended garage back on the map @seeded @database', () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const brand = { name: `Marca Rep ${stamp}`, slug: `marca-rep-${stamp}` };
  const name = `Atelier Repus ${stamp}`;
  const slug = `e2e-repus-${stamp}`;
  const owner = {
    email: `repus-${stamp}@example.test`,
    password: 'proprietar-repus-2026',
  };
  let db: Client;
  let brandId = '';
  let garageId = '';

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
  const dialog = (page: Page) => page.getByRole('dialog');
  const cards = (page: Page) =>
    page.getByRole('list', { name: 'Service‑uri găsite' }).getByRole('heading');
  const recheckRow = (page: Page) =>
    page.locator('mf-admin-rechecks li.row').filter({ hasText: name });
  const suspendedRow = (page: Page) =>
    page.locator('mf-admin-suspended li.row').filter({ hasText: name });
  const stored = async () =>
    (
      await db.query<{ status: string; checked: string | null }>(
        `SELECT status::text, last_checked_on::text AS checked FROM garage WHERE id = $1`,
        [garageId],
      )
    ).rows[0];

  async function signInFromHeader(
    page: Page,
    email: string,
    password?: string,
  ) {
    await page.setViewportSize({ height: 800, width: 1280 });
    await ready(page, '/ro/garages');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, email, password ? { password } : undefined);
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
    // Due for its monthly re-check, findable by its brand from where it stands.
    const garage = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, last_checked_on, rar_activities,
         latitude, longitude, rating, review_count)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now(),
         (now() AT TIME ZONE 'Europe/Bucharest')::date - 29, ARRAY['mechanics', 'brakes'],
         44.2, 24.9, 4.9, 5)
       RETURNING id`,
      [name, slug],
    );
    garageId = garage.rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
       VALUES ($1, $2, 'works_on', true, true, true, true, now())`,
      [garageId, brandId],
    );
    // An approved file, so the suspended row opens the drawer.
    const file = await db.query<{ id: string }>(
      `INSERT INTO verification_file (id, garage_id, status, opened_at, decided_at)
       VALUES (gen_random_uuid(), $1, 'approved', now(), now())
       RETURNING id::text`,
      [garageId],
    );
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind, result, recorded_at)
       SELECT gen_random_uuid(), $1, k::verification_check_kind, 'ok', now()
       FROM unnest(ARRAY['company', 'caen', 'rar', 'documents']) AS k`,
      [file.rows[0]?.id ?? ''],
    );
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email: owner.email,
        language: 'ro',
        name: `Proprietar ${stamp}`,
        password: owner.password,
      },
      headers: { 'x-forwarded-for': `198.51.100.${(Date.now() + 41) % 250}` },
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
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM account WHERE email = $1', [owner.email]);
    await db.query('DELETE FROM verification_file WHERE garage_id = $1', [
      garageId,
    ]);
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
    await deleteBrand(db, brandId);
    await db.end();
  });

  test('suspends it by a failed re-check, restores it with a valid one, and shows it again in search, on its profile, to the owner and in the file', async ({
    browser,
    page,
  }) => {
    // Three browsers, a suspension, a restore and four pages read after it.
    test.slow();
    await signInFromHeader(page, ACCOUNTS.admin);
    await expect(page).toHaveURL('/app/admin');
    await page.goto('/app/admin/garages');

    await recheckRow(page)
      .getByRole('button', { name: 'Înregistrează' })
      .click();
    await dialog(page).getByRole('button', { name: 'Expirată' }).click();
    await dialog(page).locator('textarea').fill('expirată pe 12 sept. 2026');
    await dialog(page)
      .getByRole('button', { name: 'Suspendă service‑ul' })
      .click();
    await dialog(page)
      .getByRole('button', { name: 'Confirmă suspendarea' })
      .click();
    await expect(suspendedRow(page)).toHaveCount(1, { timeout: 15_000 });
    expect((await stored())?.status).toBe('suspended');

    // Open while it is suspended: the owner's banner and a visitor's results.
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInFromHeader(ownerPage, owner.email, owner.password);
    await expect(ownerPage).toHaveURL('/app/garage');
    const banner = ownerPage
      .getByRole('alert')
      .filter({ hasText: 'Profil suspendat' });
    await expect(banner).toHaveCount(1);
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(`/ro/garages?brand=${brand.slug}&near=44.200,24.900`);
    await expect(
      visitor.getByRole('list', { name: 'Service‑uri găsite' }),
    ).toHaveCount(0);

    const fileLink =
      (await suspendedRow(page).locator('a.open').getAttribute('href')) ?? '';
    expect(fileLink).toMatch(/^\/app\/admin\/garages\/.+/);
    await suspendedRow(page)
      .getByRole('button', { name: `Repune pe hartă ${name}` })
      .click();
    await expect(dialog(page).locator('[data-part="name"]')).toHaveText(name);
    await expect(dialog(page).locator('[data-part="result"]')).toContainText(
      'Valabilă',
    );
    await expect(dialog(page).locator('input[type="date"]')).toHaveValue(
      bucharestToday(),
    );
    await expect(
      dialog(page).locator('input[type="checkbox"]:checked'),
    ).toHaveCount(2);
    await dialog(page)
      .locator('textarea')
      .fill('Autorizația RAR reînnoită, verificată în registru.');
    await dialog(page)
      .getByRole('button', { exact: true, name: 'Repune pe hartă' })
      .click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(banner).toHaveCount(0, { timeout: 2_000 });
    await expect(suspendedRow(page)).toHaveCount(0);
    expect(await stored()).toEqual({
      checked: bucharestToday(),
      status: 'approved',
    });

    // An open page re-reads its counts and pins on the event; the card itself
    // comes with the next search, as a newly approved garage's does.
    await visitor.goto(`/ro/garages?brand=${brand.slug}&near=44.200,24.900`);
    await expect(cards(visitor).filter({ hasText: name })).toHaveCount(1);
    await visitor.goto(`/ro/garages/${slug}`);
    await expect(visitor.locator('.verified')).toContainText(
      `Ultima verificare: ${roDay(bucharestToday())}.`,
    );

    await page.goto(fileLink);
    await expect(page.locator('[data-part="suspension"]')).toContainText(
      /^Suspendat .+ – .+ · repus pe hartă de .+/,
    );
    // The file is a drawer over the garages page, whose list of suspended
    // garages keeps the restore buttons of other tests' garages.
    await expect(
      page.locator('[data-section="header"] [data-part="restore"]'),
    ).toHaveCount(0);
    await ownerContext.close();
    await visitorContext.close();
  });
});

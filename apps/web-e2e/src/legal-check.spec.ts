import { expect } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const SLUG = 'atelier-test';

// The seed approves the owner's garage with no verification file, so the
// test gives it an approved one, with every check in order, both legal
// documents valid and its last check day, and removes them afterwards.
test.describe('the legal check panel @seeded', () => {
  let db: Client;
  let fileId: string | undefined;
  let lastCheckedOn: string | null = null;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterEach(async () => {
    if (!fileId) return;
    await db.query('DELETE FROM verification_file WHERE id = $1', [fileId]);
    await db.query('UPDATE garage SET last_checked_on = $1 WHERE slug = $2', [
      lastCheckedOn,
      SLUG,
    ]);
    fileId = undefined;
  });

  test.afterAll(async () => {
    await db.end();
  });

  // @traces 210-FR-014
  // @traces 210-SC-001
  test('the owner of an approved garage sees "Verificat" and four rows in order', async ({
    page,
  }) => {
    const before = await db.query<{ day: string | null }>(
      `SELECT last_checked_on::text AS day FROM garage WHERE slug = $1`,
      [SLUG],
    );
    expect(before.rows[0], 'the seeded garage is missing').toBeDefined();
    lastCheckedOn = before.rows[0]?.day ?? null;
    const { rows } = await db.query<{ file: string }>(
      `INSERT INTO verification_file (id, garage_id, status, opened_at, decided_at)
       SELECT gen_random_uuid(), g.id, 'approved', now(), now() FROM garage g
       WHERE g.slug = $1 AND g.status = 'approved'
       RETURNING id::text AS file`,
      [SLUG],
    );
    expect(rows[0], 'the seeded garage is not approved').toBeDefined();
    fileId = rows[0]?.file;
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind, result, recorded_at)
       SELECT gen_random_uuid(), $1, k::verification_check_kind, 'ok', now()
       FROM unnest(ARRAY['company', 'caen', 'rar', 'documents']) AS k`,
      [fileId],
    );
    await db.query(
      `INSERT INTO legal_document (verification_file_id, kind, pages, status)
       SELECT $1, k, ARRAY[]::text[], 'valid'
       FROM unnest(ARRAY['onrc_certificate', 'rar_authorisation']) AS k`,
      [fileId],
    );
    await db.query(
      `UPDATE garage SET last_checked_on = (now() AT TIME ZONE 'Europe/Bucharest')::date
       WHERE slug = $1`,
      [SLUG],
    );

    await ready(page, '/ro');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.garage);
    await expect(page).toHaveURL('/app/garage');

    await expect(page.getByText('Profil verificat')).toBeVisible();
    const panel = page.getByRole('region', { name: 'Verificare legală' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Verificat', { exact: true })).toBeVisible();
    const rowsShown = panel.locator('[data-legal-row]');
    await expect(rowsShown).toHaveCount(4);
    await expect(rowsShown.nth(0)).toContainText('Firmă activă');
    await expect(rowsShown.nth(1)).toContainText('Cod CAEN 4520');
    await expect(rowsShown.nth(2)).toContainText('Autorizație tehnică RAR');
    await expect(rowsShown.nth(3)).toContainText('Documente');
    await expect(panel.getByText('în regulă', { exact: true })).toHaveCount(4);
  });
});

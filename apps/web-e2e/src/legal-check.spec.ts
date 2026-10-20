import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { expect } from '@playwright/test';
import { Client } from 'pg';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// An approved garage and its owner of this file's own: the seed leaves the
// shared owner's garage a draft, and another spec gives it a live file of
// its own, so the test builds its garage with an approved file, every check
// in order, both legal documents valid and its last check day, and removes
// them afterwards. A deployed address, whose run has no DATABASE_URL, skips
// the file.
test.describe('the legal check panel @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its garage, file and owner straight to PostgreSQL, which needs DATABASE_URL',
  );

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const owner = {
    email: `verificat-${stamp}@example.test`,
    password: 'proprietar-verificat-2026',
  };
  let db: Client;
  let garageId = '';

  test.beforeAll(async ({ request }) => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const garage = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, last_checked_on)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now(),
               (now() AT TIME ZONE 'Europe/Bucharest')::date)
       RETURNING id::text`,
      [`Service Verificat ${stamp}`, `e2e-verificat-${stamp}`],
    );
    garageId = garage.rows[0]?.id ?? '';
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
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email: owner.email,
        language: 'ro',
        name: `Proprietar ${stamp}`,
        password: owner.password,
      },
      headers: { 'x-forwarded-for': `203.0.113.${(Date.now() + 11) % 250}` },
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
    await db.end();
  });

  // @traces 210-FR-014
  // @traces 210-SC-001
  test('the owner of an approved garage sees "Verificat" and four rows in order', async ({
    page,
  }) => {
    await ready(page, '/ro');
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
    await signIn(page, owner.email, { password: owner.password });
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

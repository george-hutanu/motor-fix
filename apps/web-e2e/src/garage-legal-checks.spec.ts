import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// Garages and owners of this file's own, written straight to PostgreSQL so no
// seeded garage moves under a spec running beside this one. The @database tag
// keeps the file out of a deployed run, which has no database.
// @traces 1354-FR-003 1354-FR-004 1354-FR-005 1354-FR-006 1354-FR-010

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const legal = (page: Page) =>
  page.getByRole('region', { name: 'Verificare legală' });

test.describe('the garage’s legal checks after a re-check @seeded @database', () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const password = 'proprietar-legal-2026';
  const emails: string[] = [];
  const garageIds: string[] = [];
  let db: Client;

  const garage = async (slug: string, status: 'approved' | 'suspended') => {
    const made = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, last_checked_on, rar_activities)
       VALUES (gen_random_uuid(), $1, $2, $3, now(), DATE '2026-10-01', ARRAY['mechanics', 'brakes'])
       RETURNING id`,
      [`Atelier ${slug}`, `e2e-${slug}`, status],
    );
    const id = made.rows[0]?.id ?? '';
    garageIds.push(id);
    const file = await db.query<{ id: string }>(
      `INSERT INTO verification_file (id, garage_id, status, opened_at, decided_at)
       VALUES (gen_random_uuid(), $1, 'approved', now(), now())
       RETURNING id::text`,
      [id],
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
    return id;
  };

  const owner = async (request: APIRequestContext, garageId: string) => {
    const email = `legal-${garageIds.length}-${stamp}@example.test`;
    emails.push(email);
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email,
        language: 'ro',
        name: `Proprietar ${stamp}`,
        password,
      },
      headers: { 'x-forwarded-for': `198.51.100.${(Date.now() + 17) % 250}` },
    });
    expect(signUp.status()).toBe(201);
    const account = await db.query<{ id: string }>(
      'SELECT id FROM account WHERE email = $1',
      [email],
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
    return email;
  };

  const signInAt = async (page: Page, email: string, width: number) => {
    await page.setViewportSize({ height: 800, width });
    await ready(page, '/ro/garages');
    if (width < 768) {
      await page
        .getByRole('navigation', { name: 'Navigare principală' })
        .getByRole('link', { exact: true, name: 'Cont' })
        .click();
    } else {
      await page
        .getByRole('button', { exact: true, name: 'Autentificare' })
        .click();
    }
    await signIn(page, email, { password });
    await expect(page).toHaveURL('/app/garage');
  };

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM account WHERE email = ANY($1)', [emails]);
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [garageIds]);
    await db.end();
  });

  test('shows the owner the re-check date on the strip and the RAR row, and the note', async ({
    page,
    request,
  }) => {
    const id = await garage(`reverificat-${stamp}`, 'approved');
    await db.query(
      `INSERT INTO recheck (id, garage_id, checked_on, result)
       VALUES (gen_random_uuid(), $1, DATE '2026-10-01', 'ok')`,
      [id],
    );
    await signInAt(page, await owner(request, id), 1280);

    await expect(page.locator('[data-verified-line]')).toHaveText(
      'Autorizația RAR, reverificată pe 1 oct.',
    );
    await expect(legal(page).locator('[data-legal-row="rar"]')).toContainText(
      'reverificată pe 1 oct. 2026',
    );
    await expect(legal(page).locator('[data-legal-note]')).toContainText(
      'Reverificăm lunar autorizația în registrul RAR.',
    );
  });

  test('shows the owner of a garage suspended by a failed re-check the red RAR row, on a 320 px phone', async ({
    page,
    request,
  }) => {
    const id = await garage(`expirat-${stamp}`, 'suspended');
    await db.query(
      `INSERT INTO recheck (id, garage_id, checked_on, result, failure, detail)
       VALUES (gen_random_uuid(), $1, DATE '2026-10-12', 'failed', 'expired', 'Autorizația a expirat la 30 septembrie')`,
      [id],
    );
    await db.query(
      `INSERT INTO garage_suspension (garage_id, cause, reason, from_time)
       VALUES ($1, 'recheck_failed', 'Autorizația RAR a expirat', now())`,
      [id],
    );
    await signInAt(page, await owner(request, id), 320);

    await expect(legal(page).locator('[data-legal-tag]')).toHaveText(
      'Suspendat',
    );
    await expect(legal(page).locator('[data-legal-row="rar"]')).toContainText(
      'expirată pe 12 oct. 2026 · Autorizația a expirat la 30 septembrie',
    );
    await expect(page.locator('[data-verified-pill]')).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

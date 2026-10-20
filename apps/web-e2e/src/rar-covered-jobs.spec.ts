import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// A garage of this file's own, approved with the activities an admin's record
// left it (no brakes), written straight to PostgreSQL so no seeded garage moves
// under a spec running beside this one. The @database tag keeps the file out
// of a deployed run, which has no database.
// @traces 1357-FR-001 1357-FR-002 1357-FR-005 1357-FR-007

const BRAKES = 'Plăcuțe și discuri de frână față';
const OIL = 'Schimb de ulei și filtre';

const rows = (page: Page) => page.locator('[data-row]');
const row = (page: Page, name: string) =>
  rows(page).filter({ has: page.locator('[data-name]', { hasText: name }) });

test.describe('the jobs a RAR authorisation covers @seeded @database', () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `rar-${stamp}@example.test`;
  const password = 'proprietar-rar-2026';
  const slug = `e2e-rar-${stamp}`;
  let db: Client;
  let garageId = '';

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
    await db.query('DELETE FROM account WHERE email = $1', [email]);
    await db.end();
  });

  test('the owner sees a job outside the authorisation hidden with its reason, and drivers never see it', async ({
    page,
    request,
  }) => {
    const made = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, last_checked_on, rar_activities)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now(), DATE '2026-10-01', ARRAY['mechanics', 'suspension'])
       RETURNING id::text`,
      [`Atelier RAR ${stamp}`, slug],
    );
    garageId = made.rows[0]?.id ?? '';

    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email,
        language: 'ro',
        name: `Proprietar ${stamp}`,
        password,
      },
      headers: { 'x-forwarded-for': `198.51.100.${(Date.now() + 41) % 250}` },
    });
    expect(signUp.status()).toBe(201);
    const account = await db.query<{ id: string }>(
      'SELECT id::text FROM account WHERE email = $1',
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
    for (const [position, key] of ['oil-service', 'front-brakes'].entries()) {
      await db.query(
        `INSERT INTO garage_price (id, garage_id, job_type_id, from_bani, to_bani, position, updated_at, updated_by)
         SELECT gen_random_uuid(), $1, j.id, 30000, 50000, $3, now(), $4
         FROM job_type j WHERE j.key = $2`,
        [garageId, key, position, accountId],
      );
    }

    await page.setViewportSize({ height: 800, width: 1280 });
    await ready(page, '/ro/garages');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, email, { password });
    await expect(page).toHaveURL('/app/garage');
    await page.goto('/app/garage/prices');

    const brakes = row(page, BRAKES);
    await expect(brakes.locator('[data-state]')).toHaveText(
      'ascuns · nu e în autorizația RAR',
    );
    await expect(brakes).toHaveAttribute('data-public', 'false');
    await expect(row(page, OIL).locator('[data-state]')).toHaveText(
      'pe profil',
    );
    await brakes.screenshot({
      path: test.info().outputPath('hidden-by-rar.png'),
    });

    await page.goto(`/ro/garages/${slug}`);
    const prices = page.locator('section[data-slot="prices"]');
    await expect(prices).toContainText(OIL);
    await expect(prices).not.toContainText(BRAKES);
  });
});

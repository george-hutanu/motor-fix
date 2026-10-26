import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// A garage and owner of this file's own, written straight to PostgreSQL so no
// seeded garage moves under a spec running beside this one. The @database tag
// keeps the file out of a deployed run, which has no database.
// @traces 136-FR-001
// @traces 136-FR-003
// @traces 136-FR-005
// @traces 136-FR-007

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const legal = (page: Page) =>
  page.getByRole('region', { name: 'Verificare legală' });

test.describe('the legal check on the garage profile view @seeded @database', () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const password = 'proprietar-profil-2026';
  const emails: string[] = [];
  const garageIds: string[] = [];
  let db: Client;

  // An approved garage, its four checks ok and both documents valid; its
  // yearly documents due in `dueIn` days.
  const garage = async (
    slug: string,
    dueIn: number,
    status: 'approved' | 'suspended' = 'approved',
  ) => {
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
    await db.query(
      `INSERT INTO garage_document_cycle (garage_id, due_on)
       VALUES ($1, (now() AT TIME ZONE 'Europe/Bucharest')::date + $2::int)`,
      [id, dueIn],
    );
    await db.query(
      `INSERT INTO recheck (id, garage_id, checked_on, result)
       VALUES (gen_random_uuid(), $1, DATE '2026-10-01', 'ok')`,
      [id],
    );
    return id;
  };

  const owner = async (request: APIRequestContext, garageId: string) => {
    const email = `profil-legal-${garageIds.length}-${stamp}@example.test`;
    emails.push(email);
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email,
        language: 'ro',
        name: `Proprietar ${stamp}`,
        password,
      },
      headers: { 'x-forwarded-for': `198.51.100.${(Date.now() + 29) % 250}` },
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

  const profileAt = async (page: Page, email: string, width: number) => {
    await page.setViewportSize({ height: 800, width });
    await ready(page, '/ro/garages');
    if (width < 768) {
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
    await signIn(page, email, { password });
    await expect(page).toHaveURL('/app/garage');
    await page.goto('/app/garage/profile');
  };

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    try {
      await db.query('DELETE FROM account WHERE email = ANY($1)', [emails]);
      await db.query('DELETE FROM garage WHERE id = ANY($1)', [garageIds]);
    } finally {
      await db.end();
    }
  });

  test('shows the owner the tag, four rows in order, the RAR day, the deadline and the note', async ({
    page,
    request,
  }) => {
    const id = await garage(`profil-${stamp}`, 90);
    await profileAt(page, await owner(request, id), 1280);

    await expect(legal(page).locator('[data-legal-tag]')).toHaveText(
      'Verificat',
    );
    await expect(legal(page).locator('[data-legal-row]')).toHaveCount(4);
    expect(
      await legal(page)
        .locator('[data-legal-row]')
        .evaluateAll((rows) =>
          rows.map((r) => r.getAttribute('data-legal-row')),
        ),
    ).toEqual(['company', 'caen', 'rar', 'documents']);
    await expect(legal(page).locator('[data-legal-row="rar"]')).toContainText(
      'reverificată pe 1 oct. 2026',
    );
    await expect(
      legal(page).locator('[data-legal-row="documents"]'),
    ).toContainText('de reîncărcat o dată pe an, până în');
    await expect(legal(page).locator('[data-legal-note]')).toContainText(
      'Reverificăm lunar autorizația în registrul RAR.',
    );
  });

  test('turns the documents row amber with its due day when they are due within 30 days, on a 320 px phone', async ({
    page,
    request,
  }) => {
    const id = await garage(`scadent-${stamp}`, 20);
    await profileAt(page, await owner(request, id), 320);

    const row = legal(page).locator('[data-legal-row="documents"]');
    await expect(row).toHaveAttribute('data-lamp', 'amber');
    await expect(row).toContainText('scadent pe');
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('keeps the legal panel under the suspended line when the garage is suspended', async ({
    page,
    request,
  }) => {
    const id = await garage(`suspendat-${stamp}`, 90, 'suspended');
    await db.query(
      `INSERT INTO garage_suspension (garage_id, cause, reason, from_time)
       VALUES ($1, 'recheck_failed', 'Autorizația RAR a expirat', now())`,
      [id],
    );
    await profileAt(page, await owner(request, id), 390);

    await expect(legal(page).locator('[data-legal-tag]')).toHaveText(
      'Suspendat',
    );
    await expect(
      page.getByRole('region', { name: 'Profilul public' }),
    ).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

// @traces 136-FR-006
// @traces 102-FR-004
test.describe('the legal check stays the owner’s on the profile view @seeded', () => {
  test("shows the garage's receptionist the profile without the panel", async ({
    page,
  }) => {
    await keepSeededLanguage(page);
    await ready(page, '/ro');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, 'receptie-militari@example.test');
    await expect(page).toHaveURL('/app/garage');
    const menu = page.getByRole('navigation', { name: 'Meniu' });

    await menu.getByRole('link', { name: 'Profilul service‑ului' }).click();
    await expect(page).toHaveURL('/app/garage/profile');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Profilul service‑ului' }),
    ).toBeVisible();
    await expect(page.locator('[data-line="name"]')).toBeVisible();
    await expect(legal(page)).toHaveCount(0);
  });
});

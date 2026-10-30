import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, openSignIn, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// @traces 011-FR-002 011-FR-003 011-FR-013

// A garage and its owner of this file's own: hiding a section saves the
// owner's layout, which no other spec may see change under it.
test.describe('choosing the sections of Panou @seeded @database', () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const owner = {
    email: `panou-${stamp}@example.test`,
    password: 'proprietar-panou-2026',
  };
  let db: Client;
  let garageId = '';

  test.beforeAll(async ({ request }) => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const garage = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now()) RETURNING id`,
      [`Service Panou ${stamp}`, `e2e-panou-${stamp}`],
    );
    garageId = garage.rows[0]?.id ?? '';
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email: owner.email,
        language: 'ro',
        name: `Proprietar ${stamp}`,
        password: owner.password,
      },
      headers: { 'x-forwarded-for': `203.0.113.${(Date.now() + 41) % 250}` },
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
    try {
      await db.query('DELETE FROM account WHERE email = $1', [owner.email]);
      await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
    } finally {
      await db.end();
    }
  });

  const keys = (page: Page) =>
    page
      .locator('[data-section]')
      .evaluateAll((all) => all.map((el) => el.getAttribute('data-section')));
  const panel = (page: Page) =>
    page.getByRole('dialog', { name: 'Alege ce vezi pe panou' });

  test('the owner hides two sections and they stay hidden after a reload', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await openSignIn(page);
    await signIn(page, owner.email, { password: owner.password });
    await expect(page).toHaveURL('/app/garage');
    await expect(page.getByText('7 din 7 secțiuni afișate')).toBeVisible();

    await page.getByRole('button', { name: 'Personalizează panoul' }).click();
    await expect(panel(page)).toBeVisible();
    for (const name of ['Programul pe elevatoare', 'Mărci cerute']) {
      const control = panel(page).getByRole('switch', { name });
      await control.click();
      await expect(control).toHaveAttribute('aria-checked', 'false');
      await expect(control).toBeEnabled();
    }
    await expect(page.getByText('5 din 7 secțiuni afișate')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Gata' }).click();
    await expect(panel(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText('5 din 7 secțiuni afișate')).toBeVisible();
    expect(await keys(page)).toEqual([
      'kpi',
      'req',
      'load',
      'funnel',
      'reviews',
    ]);

    // The menu still opens the views of both hidden sections.
    await page.setViewportSize({ height: 900, width: 1440 });
    const menu = page.getByRole('navigation', { name: 'Meniu' });
    await menu.getByRole('link', { exact: true, name: 'Programări' }).click();
    await expect(page).toHaveURL('/app/garage/schedule');
    await menu
      .getByRole('link', { exact: true, name: 'Profilul service‑ului' })
      .click();
    await expect(page).toHaveURL('/app/garage/profile');
  });

  test('a mechanic sees only her two rows', async ({ page }) => {
    await ready(page, '/ro');
    await openSignIn(page);
    await signIn(page, ACCOUNTS.mechanic);
    await expect(page).toHaveURL('/app/garage');

    await page.getByRole('button', { name: 'Personalizează panoul' }).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('switch')).toHaveCount(2);
    await expect(
      panel(page).getByRole('switch', { name: 'Încărcarea mecanicilor' }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole('switch', { name: 'Programul pe elevatoare' }),
    ).toBeVisible();
    await expect(page.getByText('2 din 2 secțiuni afișate')).toBeVisible();
  });
});

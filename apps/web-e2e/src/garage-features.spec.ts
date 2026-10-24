import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready, signIn } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';

// @traces 398-FR-009 398-FR-010 398-FR-012 398-FR-014
// @traces 531-FR-001 531-FR-005

// A garage and its owner of this file's own: every approved seeded garage has
// a mechanic, which refuses the team switch (398-FR-005), and switching a
// seeded garage's features would reach every other spec running beside this
// one. A deployed address, whose run has no DATABASE_URL, skips the file.
test.describe("the garage's feature switches @seeded @database", () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its garage and owner straight to PostgreSQL, which needs DATABASE_URL',
  );

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const owner = {
    email: `functii-${stamp}@example.test`,
    password: 'proprietar-functii-2026',
  };
  let db: Client;
  let garageId = '';

  test.beforeAll(async ({ request }) => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const garage = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now()) RETURNING id`,
      [`Service Funcții ${stamp}`, `e2e-functii-${stamp}`],
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
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
    await db.end();
  });

  async function openDashboard(page: Page, path: string) {
    await ready(page, '/ro');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    const live = page.waitForResponse((r) => r.url().endsWith('/api/v1/live'));
    await signIn(page, owner.email, { password: owner.password });
    await expect(page).toHaveURL('/app/garage');
    expect((await live).status()).toBe(200);
    await page.goto(path);
  }

  const menu = (page: Page) => page.getByRole('navigation').first();

  test('switching the team off in one tab takes Mecanici away from another open tab, and back', async ({
    browser,
  }) => {
    const a = await (await browser.newContext()).newPage();
    const b = await (await browser.newContext()).newPage();
    await openDashboard(a, '/app/garage/settings');
    await openDashboard(b, '/app/garage/team');
    await b.evaluate(() => {
      (window as { kept?: boolean }).kept = true;
    });

    const team = a.getByRole('switch', { name: 'Echipă și mecanici' });
    await expect(team).toBeChecked();
    await team.click();
    const confirm = a.getByRole('dialog');
    await expect(confirm).toBeVisible();
    // The dialog fades in: axe reads its colours once every animation is done.
    await a.waitForFunction(() =>
      document.getAnimations().every((x) => x.playState !== 'running'),
    );
    expect(await violations(a, {}, { include: [['[role="dialog"]']] })).toEqual(
      [],
    );
    await confirm.getByRole('button', { name: 'Oprește' }).click();
    await expect(team).not.toBeChecked();

    await expect(b).toHaveURL('/app/garage', { timeout: 5000 });
    expect(await b.evaluate(() => (window as { kept?: boolean }).kept)).toBe(
      true,
    );
    await expect(
      menu(b).getByRole('link', { exact: true, name: 'Mecanici' }),
    ).toHaveCount(0, { timeout: 5000 });

    await team.click();
    await expect(team).toBeChecked();
    await expect(
      menu(b).getByRole('link', { exact: true, name: 'Mecanici' }),
    ).toBeVisible({ timeout: 5000 });
    expect(
      await violations(a, {}, { include: [['mf-feature-switches']] }),
    ).toEqual([]);
  });

  test('switching day sheets off in one tab takes Programări away from another open tab, and back', async ({
    browser,
  }) => {
    const a = await (await browser.newContext()).newPage();
    const b = await (await browser.newContext()).newPage();
    await openDashboard(a, '/app/garage/settings');
    await openDashboard(b, '/app/garage/schedule');
    const schedule = menu(b).getByRole('link', {
      exact: true,
      name: 'Programări',
    });
    await expect(schedule).toBeVisible();

    const sheets = a.getByRole('switch', { name: 'Foi de lucru' });
    await expect(sheets).toBeChecked();
    await sheets.click();
    await a
      .getByRole('dialog')
      .getByRole('button', { name: 'Oprește' })
      .click();
    await expect(sheets).not.toBeChecked();

    await expect(b).toHaveURL('/app/garage', { timeout: 5000 });
    await expect(schedule).toHaveCount(0, { timeout: 5000 });

    await sheets.click();
    await expect(sheets).toBeChecked();
    await expect(schedule).toBeVisible({ timeout: 5000 });
  });

  test('cancelling the confirmation leaves the switch on', async ({ page }) => {
    await openDashboard(page, '/app/garage/settings');

    const lifts = page.getByRole('switch', { name: 'Program pe elevatoare' });
    await lifts.click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(lifts).toBeChecked();
    await expect(lifts).toBeFocused();
  });
});

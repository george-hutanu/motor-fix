import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, openSignIn, ready, signIn } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';

// @traces 099-FR-013 099-FR-008 099-FR-003 099-FR-002 099-FR-010

// A garage and its owner of this file's own: the first-steps card shows only
// while the garage has no request and no review, and switching lift_schedule
// off on a seeded garage would reach every other spec running beside this one.
// A deployed address, whose run has no DATABASE_URL, skips the file.
test.describe('the sections of Panou @seeded @database', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its garage and owner straight to PostgreSQL, which needs DATABASE_URL',
  );

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const owner = {
    email: `sectiuni-${stamp}@example.test`,
    password: 'proprietar-sectiuni-2026',
  };
  let db: Client;
  let garageId = '';
  let driverId = '';

  test.beforeAll(async ({ request }) => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const garage = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now()) RETURNING id`,
      [`Service Secțiuni ${stamp}`, `e2e-sectiuni-${stamp}`],
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
      headers: { 'x-forwarded-for': `203.0.113.${(Date.now() + 37) % 250}` },
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
    if (driverId)
      await db.query('DELETE FROM account WHERE id = $1', [driverId]);
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
    await db.end();
  });

  async function openPanou(page: Page) {
    await ready(page, '/ro');
    await openSignIn(page);
    await signIn(page, owner.email, { password: owner.password });
    await expect(page).toHaveURL('/app/garage');
  }

  const keys = (page: Page) =>
    page
      .locator('[data-section]')
      .evaluateAll((all) => all.map((el) => el.getAttribute('data-section')));
  const card = (page: Page) =>
    page.getByRole('heading', { exact: true, name: 'Primii pași' });

  // One request waiting for this garage, from a driver of this file's own.
  async function firstRequest() {
    const driver = await db.query<{ id: string }>(
      `INSERT INTO account (id, name, last_role)
       VALUES (gen_random_uuid(), $1, 'driver') RETURNING id`,
      [`Șofer Secțiuni ${stamp}`],
    );
    driverId = driver.rows[0]?.id ?? '';
    const car = await db.query<{ id: string }>(
      `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, odometer_km,
         idempotency_key)
       VALUES (gen_random_uuid(), $1, (SELECT id FROM brand ORDER BY key LIMIT 1),
         'Logan', 2018, 'petrol', 120000, gen_random_uuid()::text)
       RETURNING id`,
      [driverId],
    );
    const quote = await db.query<{ id: string }>(
      `INSERT INTO quote_request (id, driver_id, car_id, car_brand, car_model,
         car_year, car_fuel, expires_at, idempotency_key)
       VALUES (gen_random_uuid(), $1, $2, 'Dacia', 'Logan', 2018, 'petrol',
         now() + interval '7 days', gen_random_uuid()::text)
       RETURNING id`,
      [driverId, car.rows[0]?.id],
    );
    await db.query(
      `INSERT INTO request_recipient (id, request_id, garage_id, source, status)
       VALUES (gen_random_uuid(), $1, $2, 'search', 'waiting')`,
      [quote.rows[0]?.id, garageId],
    );
  }

  test('a new owner sees the strip, the first steps and every released section in order, each title opening its view', async ({
    page,
  }) => {
    await openPanou(page);

    await expect(card(page)).toBeVisible();
    await expect(page.locator('[data-section="reviews"]')).toBeVisible();
    expect(await keys(page)).toEqual([
      'kpi',
      'req',
      'load',
      'sched',
      'funnel',
      'brands',
      'reviews',
    ]);
    await expect(
      page.getByText('Aici vei vedea ce se întâmplă azi'),
    ).toHaveCount(0);

    const views: [string, string][] = [
      ['Cifrele zilei', '/app/garage/profile'],
      ['Cereri de ofertă', '/app/garage/requests'],
      ['Încărcarea mecanicilor azi', '/app/garage/team'],
      ['Programul de azi, pe elevatoare', '/app/garage/schedule'],
      ['Recenzii noi', '/app/garage/reviews'],
    ];
    for (const [name, href] of views)
      await expect(
        page.getByRole('heading').getByRole('link', { exact: true, name }),
      ).toHaveAttribute('href', href);
    expect(
      await violations(page, {}, { include: [['mf-garage-home']] }),
    ).toEqual([]);

    await page
      .getByRole('heading')
      .getByRole('link', { exact: true, name: 'Încărcarea mecanicilor azi' })
      .click();
    await expect(page).toHaveURL('/app/garage/team');
  });

  test('never scrolls sideways at 320 px', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 320 });
    await openPanou(page);
    await expect(page.locator('[data-section="kpi"]')).toBeVisible();

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });

  test('leaves the lift section out while lift_schedule is off, and the card once the first request arrives', async ({
    page,
  }) => {
    await db.query(
      `INSERT INTO garage_feature (garage_id, key, enabled)
       VALUES ($1, 'lift_schedule', false)
       ON CONFLICT (garage_id, key) DO UPDATE SET enabled = false`,
      [garageId],
    );
    await firstRequest();
    await openPanou(page);

    await expect(
      page.locator('[data-section="req"] li[data-live-id]'),
    ).toHaveCount(1);
    await expect(card(page)).toHaveCount(0);
    expect(await keys(page)).not.toContain('sched');
  });

  test('shows a mechanic only her own sections', async ({ page }) => {
    await ready(page, '/ro');
    await openSignIn(page);
    await signIn(page, ACCOUNTS.mechanic);
    await expect(page).toHaveURL('/app/garage');
    await expect(page.locator('[data-section="load"]')).toBeVisible();

    const shown = await keys(page);
    for (const key of ['kpi', 'funnel', 'brands', 'reviews'])
      expect(shown).not.toContain(key);
    await expect(card(page)).toHaveCount(0);
  });
});

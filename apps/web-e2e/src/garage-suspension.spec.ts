import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { accessToken } from './platform-rules.js';

// A brand, a garage and its owner of this file's own: suspending a seeded
// garage would take it from every other spec running beside this one. The
// admin suspends it through the real route while a visitor's results are
// open; the owner then signs in and reads the banner. A deployed address,
// whose run has no DATABASE_URL, skips the file.
// @traces 049-FR-001 049-FR-006 049-FR-007 049-FR-012 049-FR-015
test.describe('suspending a garage @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its brand, garage and owner straight to PostgreSQL, which needs DATABASE_URL',
  );
  test.describe.configure({ mode: 'serial' });

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const brand = { name: `Marca Susp ${stamp}`, slug: `marca-susp-${stamp}` };
  const kept = `Service Rămas ${stamp}`;
  const taken = `Service Suspendat ${stamp}`;
  const owner = {
    email: `suspendat-${stamp}@example.test`,
    password: 'proprietar-suspendat-2026',
  };
  const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';
  let db: Client;
  let brandId = '';
  let takenId = '';
  const garageIds: string[] = [];

  const cards = (page: Page) =>
    page.getByRole('list', { name: 'Service‑uri găsite' }).getByRole('heading');

  test.beforeAll(async ({ request }) => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const made = await db.query<{ id: string }>(
      `INSERT INTO brand (id, key, name, slug, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $1, now()) RETURNING id`,
      [brand.slug, brand.name],
    );
    brandId = made.rows[0]?.id ?? '';
    for (const [i, name] of [taken, kept].entries()) {
      const row = await db.query<{ id: string }>(
        `INSERT INTO garage (id, name, slug, status, approved_at, rating, review_count)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now(), $3, 5) RETURNING id`,
        [name, `e2e-suspendat-${stamp}-${i}`, i === 0 ? 4.9 : 4.1],
      );
      const id = row.rows[0]?.id ?? '';
      garageIds.push(id);
      await db.query(
        `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
         VALUES ($1, $2, 'works_on', true, true, true, true, now())`,
        [id, brandId],
      );
    }
    takenId = garageIds[0] ?? '';
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email: owner.email,
        language: 'ro',
        name: `Proprietar ${stamp}`,
        password: owner.password,
      },
      headers: { 'x-forwarded-for': `203.0.113.${(Date.now() + 7) % 250}` },
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
      [takenId, accountId],
    );
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM account WHERE email = $1', [owner.email]);
    await db.query('DELETE FROM search_log WHERE brand_id = $1', [brandId]);
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [garageIds]);
    await db.query('DELETE FROM brand WHERE id = $1', [brandId]);
    await db.end();
  });

  test('takes the garage off open results without a reload once an admin suspends it', async ({
    page,
    request,
  }) => {
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto(`/ro/garages?brand=${brand.slug}`);
    await expect(cards(page).nth(0)).toHaveText(taken);
    await stream;
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    const res = await request.post(`/api/v1/admin/garages/${takenId}/suspend`, {
      data: { cause: 'recheck_failed', reason: REASON },
      headers: { Authorization: `Bearer ${await accessToken(request)}` },
    });
    expect(res.status()).toBe(200);

    await expect(cards(page).filter({ hasText: taken })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(cards(page).nth(0)).toHaveText(kept);
    expect(navigations).toBe(0);
  });

  for (const [device, width, height] of [
    ['a 320 px phone', 320, 640],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`shows the owner the suspension, its reason and the next step on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
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
      await signIn(page, owner.email, { password: owner.password });
      await expect(page).toHaveURL('/app/garage');

      const banner = page.getByRole('alert').filter({
        hasText: 'Profil suspendat',
      });
      await expect(banner).toContainText(
        `Profil suspendat · ${REASON}. Profilul nu apare pe hartă până se rezolvă.`,
      );
      await expect(banner).toContainText('Încarcă autorizația RAR reînnoită.');
      const scrolls = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(scrolls).toBe(false);
    });
  }
});

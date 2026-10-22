import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const brands = (page: Page) => page.locator('section[data-slot="brands"]');
const where = (page: Page) => page.locator('section[data-slot="where"]');

const HOURS = {
  fri: [['08:00', '18:00']],
  mon: [['08:00', '18:00']],
  sat: [['09:00', '13:00']],
  sun: [],
  thu: [['08:00', '18:00']],
  tue: [['08:00', '18:00']],
  wed: [['08:00', '18:00']],
};

// A garage written straight to PostgreSQL with two brands taken, one refused,
// a paid courtesy car, card payment and its opening hours; the stance change
// goes out through the outbox as the listing's own edits do.
// @traces 308-FR-014 308-FR-015 308-FR-016
test.describe('the brands, facilities and hours on a public profile @database', () => {
  test.describe.configure({ mode: 'serial' });
  const tag = Date.now().toString(36);
  const slug = `e2e-detalii-${tag}`;
  // Own brands, so the lists hold only these: Alfa and Beta taken, Gama refused.
  const names = ['Alfa', 'Beta', 'Gama'].map((name) => `${name} ${tag}`);
  const [alfa, beta, gama] = names as [string, string, string];
  let db: Client;
  let id: string;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, address,
         hours, payment_card, courtesy_car_paid, courtesy_car_price_per_day_bani)
       VALUES (gen_random_uuid(), 'Service Detalii E2E', $1, 'approved', now(),
         'Strada Fabricii 12, București', $2, true, true, 15000)
       RETURNING id`,
      [slug, JSON.stringify(HOURS)],
    );
    id = rows[0]?.id ?? '';
    for (const name of names) {
      const key = name.toLowerCase().replace(' ', '-');
      await db.query(
        `WITH made AS (
           INSERT INTO brand (id, key, name, slug, updated_at)
           VALUES (gen_random_uuid(), $2, $3, $2, now()) RETURNING id)
         INSERT INTO garage_brand (garage_id, brand_id, stance, electric, updated_at)
         SELECT $1, made.id, $4::garage_brand_stance, $5, now() FROM made`,
        [
          id,
          key,
          name,
          name === gama ? 'does_not_take' : 'works_on',
          name !== beta,
        ],
      );
    }
    await db.query(
      `INSERT INTO garage_facility (garage_id, facility) VALUES ($1, 'courtesy_car')`,
      [id],
    );
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE slug = $1', [slug]);
    await db.query('DELETE FROM brand WHERE name = ANY($1)', [names]);
    await db.end();
  });

  for (const width of [320, 1280]) {
    test(`shows what was entered, in Romanian and in English, at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 900, width });
      await page.goto(`/ro/garages/${slug}`);

      await expect(brands(page).locator('.works li')).toHaveText([
        new RegExp(alfa),
        new RegExp(beta),
      ]);
      await expect(
        brands(page).locator('.works li', { hasText: beta }),
      ).toContainText('benzină · motorină · hibrid');
      await expect(brands(page).locator('.refuses li')).toHaveText([
        new RegExp(gama),
      ]);
      await expect(brands(page)).toContainText(
        'Mașină la schimb · 150 lei / zi',
      );
      await expect(brands(page)).toContainText('Plată: card');
      await expect(where(page)).toContainText('Strada Fabricii 12, București');
      await expect(where(page)).toContainText('Luni – vineri');
      await expect(where(page)).toContainText('08:00 – 18:00');
      await expect(where(page)).toContainText('Duminică');
      await expect(where(page)).toContainText('Închis');
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      await page.goto(`/en/garages/${slug}`);
      await expect(brands(page)).toContainText('Works on');
      await expect(brands(page)).toContainText('Does not work on');
      await expect(brands(page)).toContainText('Courtesy car · 150 lei / day');
      await expect(brands(page)).toContainText('Payment: card');
      await expect(where(page)).toContainText('Monday – Friday');
      await expect(where(page)).toContainText('Closed');
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  test('shows a brand the garage stops taking without reloading the page', async ({
    page,
  }) => {
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto(`/ro/garages/${slug}`);
    await expect(brands(page).locator('.works li')).toHaveCount(2);
    await stream;
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    await db.query('BEGIN');
    await db.query(
      `UPDATE garage_brand SET stance = 'does_not_take', updated_at = now()
        WHERE garage_id = $1 AND brand_id = (SELECT id FROM brand WHERE name = $2)`,
      [id, beta],
    );
    await db.query(
      `INSERT INTO outbox_event (kind, subject_id, audience)
       VALUES ('garage.updated', $1, $2)`,
      [id, [`garage:${id}`, `public:garage:${id}`]],
    );
    await db.query('COMMIT');

    await expect(brands(page).locator('.refuses li')).toHaveText(
      [new RegExp(beta), new RegExp(gama)],
      { timeout: 15_000 },
    );
    await expect(brands(page).locator('.works li')).toHaveText([
      new RegExp(alfa),
    ]);
    expect(navigations).toBe(0);
  });
});

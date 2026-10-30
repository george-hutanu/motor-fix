import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready } from './accounts.js';
import { deleteBrand } from './delete-brand.js';
import { test } from './fixtures.js';

// A brand and three garages of this file's own, written straight to
// PostgreSQL where no seeded garage stands. At the first place one garage is
// open round the clock every day, Saturday included, and one has no hours; at
// the second place only a garage without hours stands. "Open now" is the
// API's verdict on its own clock, so the seed holds at any instant but a legal
// holiday, when the calendar closes every garage: then the file asserts that
// verdict, the filtered empty state, instead of the open garage.
// @traces 1398-FR-001 1398-FR-002 1398-FR-003 1398-FR-004 1398-FR-006 1398-FR-007 1398-FR-009 1398-FR-010 1398-FR-011 1398-FR-015
test.describe('filtering the Results page @seeded @database', () => {
  test.describe.configure({ mode: 'serial' });

  const stamp = Date.now().toString(36);
  const brand = {
    name: `Marca Filtrată ${stamp}`,
    slug: `marca-filtre-${stamp}`,
  };
  const first = '47.745,26.665';
  const second = '46.640,27.730';
  const opened = (near: string, more = '') =>
    `/ro/garages?brand=${brand.slug}&near=${near}${more}`;
  const ROUND = [['00:00', '24:00']];
  const always = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ROUND]),
  );
  // name, latitude, longitude, hours
  const garages = [
    [`Deschis ${stamp}`, 47.75, 26.665, always],
    [`Fără program ${stamp}`, 47.76, 26.665, {}],
    [`Departe ${stamp}`, 46.65, 27.73, {}],
  ] as const;
  let db: Client;
  let brandId = '';
  let holiday = false;
  const ids: string[] = [];

  const cards = (page: Page) =>
    page.getByRole('list', { name: 'Service‑uri găsite' }).getByRole('heading');
  const opener = (page: Page) =>
    page.locator('.brands .filters button.filters-open');
  const nothing = 'Niciun service nu are tot ce ai ales';
  const chip = (page: Page, name: string) =>
    page.getByRole('button', { name: `Scoate filtrul ${name}` });

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const today = await db.query(
      `SELECT 1 FROM public_holiday
        WHERE day = (now() AT TIME ZONE 'Europe/Bucharest')::date`,
    );
    holiday = (today.rowCount ?? 0) > 0;
    const made = await db.query<{ id: string }>(
      `INSERT INTO brand (id, key, name, slug, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $1, now()) RETURNING id`,
      [brand.slug, brand.name],
    );
    brandId = made.rows[0]?.id ?? '';
    for (const [name, lat, lng, hours] of garages) {
      const row = await db.query<{ id: string }>(
        `INSERT INTO garage (id, name, slug, status, approved_at, rating, review_count, latitude, longitude, hours)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now(), 4.5, 5, $3, $4, $5) RETURNING id`,
        [
          name,
          `e2e-filtre-${name.toLowerCase().replace(/\W+/g, '-')}`,
          lat,
          lng,
          JSON.stringify(hours),
        ],
      );
      const id = row.rows[0]?.id ?? '';
      ids.push(id);
      await db.query(
        `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
         VALUES ($1, $2, 'works_on', true, true, true, true, now())`,
        [id, brandId],
      );
    }
  });

  // The browser's clock stands on a Tuesday at 10:15 in Bucharest (UTC+2 in
  // late October), so nothing the page draws from its own clock moves with
  // the run's instant; the verdict stays the API's, which the seed holds.
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-27T08:15:00Z'));
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [ids]);
    await deleteBrand(db, brandId);
    await db.end();
  });

  test('"Deschis acum" keeps the open garage, sums it up, dims the other pin and logs nothing', async ({
    page,
  }) => {
    const searched: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/search/garages'))
        searched.push(request.url());
    });
    await ready(page, opened(first));
    await expect(cards(page)).toHaveCount(2);
    await expect(opener(page)).toHaveText('Filtre');
    const before = searched.length;

    await opener(page).click();
    await page.getByRole('switch', { name: 'Deschis acum' }).click();
    await expect(page).toHaveURL(/open_now=1/);
    await page.keyboard.press('Escape');

    await expect(opener(page)).toHaveText('Filtre · 1');
    await expect(chip(page, 'Deschis acum')).toBeVisible();
    if (holiday) {
      await expect(page.getByRole('heading', { name: nothing })).toBeVisible();
      await expect(page.locator('mf-static-map .pin.dim')).toHaveCount(2);
    } else {
      await expect(cards(page)).toHaveCount(1);
      await expect(cards(page).first()).toHaveText(`Deschis ${stamp}`);
      await expect(page.locator('.summary .tally')).toContainText(
        '2 service‑uri găsite · 1 cu filtrele alese',
      );
      await expect(page.locator('mf-static-map .pin.dim')).toHaveCount(1);
    }
    const after = searched.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((url) => /[?&]log=1/.test(url))).toEqual([]);
  });

  test('keeps the filter through a brand change and restores both from the link', async ({
    page,
  }) => {
    await ready(page, opened(first, '&open_now=1&open_saturday=1'));
    if (holiday)
      await expect(page.getByRole('heading', { name: nothing })).toBeVisible();
    else await expect(cards(page)).toHaveCount(1);
    await expect(opener(page)).toHaveText('Filtre · 2');
    await expect(chip(page, 'Deschis acum')).toBeVisible();
    await expect(chip(page, 'Deschis sâmbăta')).toBeVisible();

    await page
      .getByRole('group', { name: 'Marca' })
      .getByRole('button', { pressed: false })
      .first()
      .click();

    await expect(page).not.toHaveURL(new RegExp(`brand=${brand.slug}`));
    await expect(page).toHaveURL(/open_now=1/);
    await expect(page).toHaveURL(/open_saturday=1/);
    await expect(chip(page, 'Deschis acum')).toBeVisible();
  });

  test('says no garage has everything chosen, and "Scoate filtrele" brings the list back', async ({
    page,
  }) => {
    await ready(page, opened(second, '&open_now=1'));

    await expect(page.getByRole('heading', { name: nothing })).toBeVisible();
    await expect(page.locator('mf-static-map .pin.dim')).toHaveCount(1);

    await page.getByRole('button', { name: 'Scoate filtrele' }).click();

    await expect(page).not.toHaveURL(/open_now/);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toHaveText(`Departe ${stamp}`);
  });

  // The chip row holds at 320 px without a sideways scroll.
  test('holds both chips at 320 px with no sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 320 });
    await ready(page, opened(first, '&open_now=1&open_saturday=1'));
    await expect(chip(page, 'Deschis sâmbăta')).toBeAttached();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});

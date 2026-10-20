import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

// A brand and 48 garages of this file's own, written straight to PostgreSQL:
// 31 that take the brand and 17 that do not, so the list runs to three pages
// (20, 20, 8). They stand together near Iași, where no seeded garage does and
// no other spec writes one, and the page opens there. A deployed address,
// whose run has no DATABASE_URL, skips the file.
// @traces 1356-FR-001 1356-FR-003 1356-FR-004 1356-FR-005 1356-FR-006 1356-FR-007 1356-FR-008
test.describe('loading more garages on the Results page @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its brand and garages straight to PostgreSQL, which needs DATABASE_URL',
  );
  test.describe.configure({ mode: 'serial' });

  const stamp = Date.now().toString(36);
  const brand = {
    name: `Marca Lungă ${stamp}`,
    slug: `marca-lunga-${stamp}`,
  };
  const near = '47.160,27.580';
  const opened = () => `/ro/garages?brand=${brand.slug}&near=${near}`;
  let db: Client;
  let brandId = '';
  const ids: string[] = [];

  const logged = async () => {
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM search_log WHERE brand_id = $1',
      [brandId],
    );
    return rows[0]?.n ?? 0;
  };
  const cards = (page: Page) =>
    page.getByRole('list', { name: 'Service‑uri găsite' }).getByRole('heading');
  const pageReads = (page: Page) => {
    const urls: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/v1/search/garages?') && url.includes('cursor='))
        urls.push(url);
    });
    return urls;
  };
  // Scrolls the last loaded card into view until `count` cards are listed.
  const scrollTo = async (page: Page, count: number) => {
    await expect(async () => {
      await cards(page).last().scrollIntoViewIfNeeded();
      expect(await cards(page).count()).toBeGreaterThanOrEqual(count);
    }).toPass({ timeout: 20_000 });
  };

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const made = await db.query<{ id: string }>(
      `INSERT INTO brand (id, key, name, slug, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $1, now()) RETURNING id`,
      [brand.slug, brand.name],
    );
    brandId = made.rows[0]?.id ?? '';
    for (let i = 0; i < 48; i++) {
      const takes = i < 31;
      const row = await db.query<{ id: string }>(
        `INSERT INTO garage (id, name, slug, status, approved_at, rating, review_count, latitude, longitude)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now(), $3, $4, $5, $6) RETURNING id`,
        [
          `Service Lung ${String(i).padStart(2, '0')} ${stamp}`,
          `e2e-lung-${stamp}-${i}`,
          (5 - (i % 31) * 0.1).toFixed(1),
          48 - i,
          47.16 + (i % 7) * 0.002,
          27.58 + Math.floor(i / 7) * 0.002,
        ],
      );
      const id = row.rows[0]?.id ?? '';
      ids.push(id);
      await db.query(
        `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
         VALUES ($1, $2, $3, $4, $4, $4, $4, now())`,
        [id, brandId, takes ? 'works_on' : 'does_not_take', takes],
      );
    }
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM search_log WHERE brand_id = $1', [brandId]);
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [ids]);
    await db.query('DELETE FROM brand WHERE id = $1', [brandId]);
    await db.end();
  });

  test('scrolls to every garage found, ends the list and logs the search once', async ({
    page,
  }) => {
    const reads = pageReads(page);
    await ready(page, opened());
    await expect(cards(page)).toHaveCount(20);
    await expect(page.locator('.tally')).toContainText(
      `31 lucrează pe ${brand.name}`,
    );

    await scrollTo(page, 48);
    await expect(cards(page)).toHaveCount(48);
    // Each garage once, and no garage that refuses the brand before a taker.
    const names = await cards(page).allTextContents();
    expect(new Set(names).size).toBe(48);
    const numbers = names.map((name) => Number(name.split(' ')[2]));
    expect(numbers.slice(0, 31).every((n) => n < 31)).toBe(true);
    await expect(page.locator('.end')).toHaveText('Ai văzut toate cele 48');
    await expect(
      page.getByRole('button', { name: 'Încarcă mai multe' }),
    ).toHaveCount(0);
    // The top keeps the total found, whatever is loaded.
    await expect(page.locator('.tally')).toContainText(
      `31 lucrează pe ${brand.name}`,
    );
    expect(reads).toHaveLength(2);
    await page.waitForTimeout(1_000);
    expect(await logged()).toBe(1);
  });

  test('loads the next page from the keyboard', async ({ page }) => {
    await ready(page, opened());
    await expect(cards(page)).toHaveCount(20);
    const more = page.getByRole('button', { name: 'Încarcă mai multe' });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => cards(page).count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(40);
    await expect(more).toBeFocused();
  });

  test('offers a retry when a page fails, and keeps the cards', async ({
    page,
  }) => {
    let failed = false;
    await page.route(/\/api\/v1\/search\/garages\?.*cursor=/, (route) => {
      if (failed) return route.continue();
      failed = true;
      return route.abort();
    });
    await ready(page, opened());
    await expect(cards(page)).toHaveCount(20);
    await cards(page).last().scrollIntoViewIfNeeded();

    const retry = page.getByRole('button', { name: 'Reîncearcă' });
    await expect(retry).toBeVisible();
    await expect(cards(page)).toHaveCount(20);
    await retry.click();
    await expect(cards(page)).toHaveCount(40);
  });

  test('comes back from a profile to the cards it had loaded', async ({
    page,
  }) => {
    await ready(page, opened());
    await scrollTo(page, 40);
    const count = await cards(page).count();
    await page
      .getByRole('list', { name: 'Service‑uri găsite' })
      .getByRole('link', { name: 'Vezi service‑ul' })
      .nth(34)
      .click();
    await page.waitForURL(/\/ro\/garages\/e2e-lung-/);

    const searches: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/search/garages?'))
        searches.push(request.url());
    });
    await page.goBack();
    await expect(cards(page)).toHaveCount(count);
    await page.waitForTimeout(1_000);
    expect(searches.filter((url) => url.includes('cursor='))).toEqual([]);
    expect(searches.filter((url) => url.includes('log='))).toEqual([]);
  });

  test('does not scroll sideways on a 320 px phone with every page loaded', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, opened());
    await scrollTo(page, 48);
    await expect(page.locator('.end')).toHaveText('Ai văzut toate cele 48');
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(wide).toBe(false);
  });
});

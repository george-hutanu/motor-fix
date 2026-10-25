import { expect, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';

import { openMap, ready } from './accounts.js';
import { violations } from './axe.js';
import { deleteBrand } from './delete-brand.js';
import { test } from './fixtures.js';

// A brand and three garages of this file's own, written straight to
// PostgreSQL near Tulcea, where no seeded garage stands: each sort puts a
// different one first. A deployed address has no database to write to, and
// leaves @database flows out.
// @traces 328-FR-001 328-FR-003 328-FR-004 328-FR-005 328-FR-009 328-FR-010 328-FR-011 328-FR-012 328-FR-013
test.describe('sorting the Results page @seeded @database', () => {
  test.describe.configure({ mode: 'serial' });

  const stamp = Date.now().toString(36);
  const brand = { name: `Marca Sortată ${stamp}`, slug: `marca-sort-${stamp}` };
  const near = '45.180,28.800';
  const opened = (sort?: string) =>
    `/ro/garages?brand=${brand.slug}&near=${near}${sort ? `&sort=${sort}` : ''}`;
  // name, rating, km north of the place, hourly rate in bani
  const garages = [
    [`Alfa ${stamp}`, 4.8, 6, 20_000],
    [`Beta ${stamp}`, 4.5, 1, 30_000],
    [`Gama ${stamp}`, 3.9, 3, 9_000],
  ] as const;
  let db: Client;
  let brandId = '';
  const ids: string[] = [];

  const cards = (page: Page) =>
    page.getByRole('list', { name: 'Service‑uri găsite' }).getByRole('heading');
  const first = async (page: Page) =>
    (await cards(page).first().textContent())?.trim();
  const sorts = (page: Page) => page.getByRole('group', { name: 'Sortare' });

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const made = await db.query<{ id: string }>(
      `INSERT INTO brand (id, key, name, slug, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $1, now()) RETURNING id`,
      [brand.slug, brand.name],
    );
    brandId = made.rows[0]?.id ?? '';
    for (const [name, rating, km, bani] of garages) {
      const row = await db.query<{ id: string }>(
        `INSERT INTO garage (id, name, slug, status, approved_at, rating, review_count, latitude, longitude, labour_from_bani)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now(), $3, 5, $4, 28.8, $5) RETURNING id`,
        [
          name,
          `e2e-sort-${name.toLowerCase().replace(/\W+/g, '-')}`,
          rating,
          45.18 + km / 111.195,
          bani,
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

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [ids]);
    await deleteBrand(db, brandId);
    await db.end();
  });

  test('reorders the list by each sort, keeps it in the bar and goes back through the history', async ({
    page,
  }) => {
    await ready(page, opened());
    await expect(cards(page)).toHaveCount(3);
    await expect(
      sorts(page).getByRole('button', { name: 'Notă' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await first(page)).toBe(`Alfa ${stamp}`);

    await sorts(page).getByRole('button', { name: 'Distanță' }).click();
    await expect(page).toHaveURL(/sort=distance/);
    await expect.poll(() => first(page)).toBe(`Beta ${stamp}`);

    await sorts(page).getByRole('button', { name: 'Preț' }).click();
    await expect(page).toHaveURL(/sort=price/);
    await expect.poll(() => first(page)).toBe(`Gama ${stamp}`);

    await page.goBack();
    await expect(page).toHaveURL(/sort=distance/);
    await expect.poll(() => first(page)).toBe(`Beta ${stamp}`);
  });

  test('opens a sorted address in its order, its sort pressed', async ({
    page,
  }) => {
    await ready(page, opened('price'));
    await expect(cards(page)).toHaveCount(3);
    await expect(
      sorts(page).getByRole('button', { name: 'Preț' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await first(page)).toBe(`Gama ${stamp}`);
  });

  test('keeps the sort through a brand change and a reload of the same address', async ({
    page,
  }) => {
    await ready(page, opened('price'));
    await expect(cards(page)).toHaveCount(3);

    await page
      .getByRole('group', { name: 'Marca' })
      .getByRole('button', { pressed: false })
      .first()
      .click();
    await expect(page).not.toHaveURL(new RegExp(`brand=${brand.slug}`));
    await expect(page).toHaveURL(/sort=price/);
    await expect(
      sorts(page).getByRole('button', { name: 'Preț' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.goBack();
    await page.reload();
    await expect(page).toHaveURL(/sort=price/);
    await expect(cards(page)).toHaveCount(3);
    await expect(
      sorts(page).getByRole('button', { name: 'Preț' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await first(page)).toBe(`Gama ${stamp}`);
  });

  for (const size of [
    { height: 900, width: 1280 },
    { height: 844, width: 390 },
  ]) {
    test(`selects the first card, in view, after each switch at ${size.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await ready(page, opened());
      await expect(cards(page)).toHaveCount(3);

      for (const [name, top] of [
        ['Distanță', `Beta ${stamp}`],
        ['Preț', `Gama ${stamp}`],
      ] as const) {
        await sorts(page).getByRole('button', { name }).click();
        await expect.poll(() => first(page)).toBe(top);
        const selected = page.locator('mf-result-card article.card.selected');
        await expect(selected).toHaveCount(1);
        await expect(selected.getByRole('heading')).toHaveText(top);
        await expect(selected).toBeInViewport();
      }
    });
  }

  // The pressed sort's amber text stands on its own opaque tint, so axe
  // measures it against what is drawn and finds it readable.
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`keeps every sort readable, pressed or not, ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      for (const sort of [undefined, 'price']) {
        await ready(page, opened(sort));
        await expect(cards(page)).toHaveCount(3);
        const found = await violations(
          page,
          { runOnly: { type: 'rule', values: ['color-contrast'] } },
          { include: [['mf-sort-control']] },
        );
        expect(found).toEqual([]);
      }
    });
  }

  // The sort's line makes the sheet's header taller: on a 320 × 568 phone
  // its rests can reach over the map's zoom buttons, which then hide rather
  // than lie under its handle, at every rest.
  test('keeps the zoom-out button clear of the sheet handle at every rest on a 320 px phone', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 568, width: 320 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page, opened());
    await expect(cards(page)).toHaveCount(3);
    await openMap(page);
    const handle = page.locator('mf-results-sheet button.handle');
    const zoomOut = page.locator('.maplibregl-ctrl-zoom-out');
    await expect(zoomOut).toHaveCount(1);

    for (let rest = 0; rest < 3; rest++) {
      expect(await across(zoomOut, handle)).toBe(false);
      await handle.click();
    }
  });

  test('fits a 320 px phone without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, opened());
    await expect(sorts(page)).toBeVisible();
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(wide).toBe(false);
  });
});

// Whether a shown `a` shares any area with `b`; a hidden one never does.
async function across(a: Locator, b: Locator): Promise<boolean> {
  const shown = await a.evaluate((el) =>
    el.checkVisibility({ visibilityProperty: true }),
  );
  if (!shown) return false;
  const [x, y] = [await a.boundingBox(), await b.boundingBox()];
  if (!x || !y) throw new Error('no box');
  const wide = Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x);
  const tall = Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y);
  return wide > 0 && tall > 0;
}

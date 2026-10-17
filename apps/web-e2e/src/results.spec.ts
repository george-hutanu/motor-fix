import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ownMap, ready } from './accounts.js';
import { test } from './fixtures.js';

// A brand and three garages of this file's own, written straight to
// PostgreSQL: no seeded garage takes the brand, so the takers on the page are
// exactly these, and no other spec's counts move while they live. They hold
// no coordinates, so a search near a place never finds them. A deployed
// address, whose run has no DATABASE_URL, skips the file.
// @traces 267-FR-001 267-FR-007 267-FR-013 267-FR-017 267-FR-019
test.describe('the Results page @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its brand, garages and suspension straight to PostgreSQL, which needs DATABASE_URL',
  );
  test.describe.configure({ mode: 'serial' });

  const stamp = Date.now().toString(36);
  const brand = { name: `Marca E2E ${stamp}`, slug: `marca-e2e-${stamp}` };
  const garages = [
    {
      name: `Service Bun ${stamp}`,
      rating: 4.9,
      reviews: 12,
      stance: 'works_on',
    },
    {
      name: `Service Mediu ${stamp}`,
      rating: 4.2,
      reviews: 3,
      stance: 'works_on',
    },
    {
      name: `Service Refuz ${stamp}`,
      rating: 5.0,
      reviews: 40,
      stance: 'does_not_take',
    },
  ] as const;
  // The Danube delta: no seeded garage within 50 km.
  const empty = '45.160,29.650';
  let db: Client;
  let brandId = '';
  const ids = new Map<string, string>();

  const logged = async () => {
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM search_log WHERE brand_id = $1',
      [brandId],
    );
    return rows[0]?.n ?? 0;
  };
  const cards = (page: Page) =>
    page.getByRole('list', { name: 'Service‑uri găsite' }).getByRole('heading');

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const made = await db.query<{ id: string }>(
      `INSERT INTO brand (id, key, name, slug, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $1, now()) RETURNING id`,
      [brand.slug, brand.name],
    );
    brandId = made.rows[0]?.id ?? '';
    for (const [i, garage] of garages.entries()) {
      const row = await db.query<{ id: string }>(
        `INSERT INTO garage (id, name, slug, status, approved_at, rating, review_count)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now(), $3, $4) RETURNING id`,
        [
          garage.name,
          `e2e-rezultat-${stamp}-${i}`,
          garage.rating,
          garage.reviews,
        ],
      );
      const id = row.rows[0]?.id ?? '';
      ids.set(garage.name, id);
      await db.query(
        `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
         VALUES ($1, $2, $3, $4, $4, $4, $4, now())`,
        [id, brandId, garage.stance, garage.stance === 'works_on'],
      );
    }
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM search_log WHERE brand_id = $1', [brandId]);
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [
      [...ids.values()],
    ]);
    await db.query('DELETE FROM brand WHERE id = $1', [brandId]);
    await db.end();
  });

  // Home's link to this address is brand-search.spec.ts's: the brand list is
  // cached, so a brand written here is not offered there at once.
  test('lists the takers first, in rating order, with the counts, and logs the search once', async ({
    page,
  }) => {
    await ready(page, `/ro/garages?brand=${brand.slug}`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `Service‑uri pentru ${brand.name}`,
    );
    await expect(cards(page).nth(0)).toHaveText(garages[0].name);
    await expect(cards(page).nth(1)).toHaveText(garages[1].name);
    await expect(page.locator('.tally')).toContainText(
      `2 lucrează pe ${brand.name}`,
    );
    await expect.poll(logged).toBe(1);
  });

  test('does not log the widening of a search near a place', async ({
    page,
  }) => {
    const before = await logged();
    await page.goto(`/ro/garages?brand=${brand.slug}&near=${empty}`);

    await expect(
      page.getByRole('heading', { name: 'Niciun service în 25 km' }),
    ).toBeVisible();
    await expect.poll(logged).toBe(before + 1);

    await page.getByRole('button', { name: 'Caută în 50 km' }).click();
    await expect(
      page.getByRole('heading', { name: 'Niciun service în 50 km' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Caută în 50 km' }),
    ).toHaveCount(0);
    // The log row is written after the answer: give a stray one time to land.
    await page.waitForTimeout(1_000);
    expect(await logged()).toBe(before + 1);
  });

  test('does not log the retry after a failed search', async ({ page }) => {
    const before = await logged();
    const asked: string[] = [];
    let first = true;
    await page.route(/\/api\/v1\/search\/garages\?/, (route) => {
      asked.push(route.request().url());
      if (!first) return route.continue();
      first = false;
      return route.fulfill({ body: '{}', status: 500 });
    });
    await page.goto(`/ro/garages?brand=${brand.slug}`);

    await expect(
      page.getByRole('heading', { name: 'Nu am putut încărca rezultatele' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Reîncearcă' }).click();
    await expect(cards(page).nth(0)).toHaveText(garages[0].name);

    // Other specs' garage events re-read the counts or cards here too: the
    // first search asks to be logged, and nothing after it does.
    const logs = asked.map((url) => new URL(url).searchParams.has('log'));
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0]).toBe(true);
    expect(logs.slice(1)).not.toContain(true);
    await page.waitForTimeout(1_000);
    expect(await logged()).toBe(before);
  });

  test('fades out a garage suspended while the page is open and drops it from the counts', async ({
    page,
  }) => {
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto(`/ro/garages?brand=${brand.slug}`);
    await expect(cards(page).nth(0)).toHaveText(garages[0].name);
    await stream;
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    // No route suspends a garage yet: the row and its event are written as
    // the admin's suspension will write them, with the same audience.
    const id = ids.get(garages[0].name);
    await db.query('BEGIN');
    await db.query(`UPDATE garage SET status = 'suspended' WHERE id = $1`, [
      id,
    ]);
    await db.query(
      `INSERT INTO outbox_event (kind, subject_id, audience)
       VALUES ('garage.suspended', $1, $2)`,
      [id, [`garage:${id}`, `public:garage:${id}`, 'public:search']],
    );
    await db.query('COMMIT');

    await expect(cards(page).filter({ hasText: garages[0].name })).toHaveCount(
      0,
      { timeout: 15_000 },
    );
    await expect(cards(page).nth(0)).toHaveText(garages[1].name);
    await expect(page.locator('.tally')).toContainText(
      `1 lucrează pe ${brand.name}`,
    );
    expect(navigations).toBe(0);
  });
});

// Garages of this file's own with a position, in the Danube delta, where no
// seeded garage stands: the pins of a search near there are exactly these.
// @traces 269-FR-002
// @traces 269-FR-003
// @traces 269-FR-012
test.describe('the map beside the results @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its brand and garages straight to PostgreSQL, which needs DATABASE_URL',
  );

  const stamp = `${Date.now().toString(36)}m`;
  const brand = { name: `Marca Harta ${stamp}`, slug: `marca-harta-${stamp}` };
  const near = '45.160,29.650';
  const placed = [
    { at: [45.17, 29.66], bani: 15049, kind: 'company', stance: 'works_on' },
    { at: [45.15, 29.64], bani: 9000, kind: 'company', stance: 'works_on' },
    {
      at: [45.165, 29.63],
      bani: 20000,
      kind: 'company',
      stance: 'does_not_take',
    },
    { at: [45.16, 29.67], bani: 12000, kind: 'mobile', stance: 'works_on' },
  ] as const;
  let db: Client;
  let brandId = '';
  const ids: string[] = [];

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const made = await db.query<{ id: string }>(
      `INSERT INTO brand (id, key, name, slug, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $1, now()) RETURNING id`,
      [brand.slug, brand.name],
    );
    brandId = made.rows[0]?.id ?? '';
    for (const [i, garage] of placed.entries()) {
      const row = await db.query<{ id: string }>(
        `INSERT INTO garage (id, name, slug, status, approved_at, latitude, longitude,
                             labour_from_bani, labour_to_bani, business_kind, service_radius_km)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now(), $3, $4, $5, $5, $6, $7)
         RETURNING id`,
        [
          `Service Harta ${stamp} ${i}`,
          `e2e-harta-${stamp}-${i}`,
          garage.at[0],
          garage.at[1],
          garage.bani,
          garage.kind,
          garage.kind === 'mobile' ? 10 : null,
        ],
      );
      const id = row.rows[0]?.id ?? '';
      ids.push(id);
      await db.query(
        `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
         VALUES ($1, $2, $3, $4, $4, $4, $4, now())`,
        [id, brandId, garage.stance, garage.stance === 'works_on'],
      );
    }
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM search_log WHERE brand_id = $1', [brandId]);
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [ids]);
    await db.query('DELETE FROM brand WHERE id = $1', [brandId]);
    await db.end();
  });

  test('draws one pin per fixed garage of the search, with its rate and the colour of its stance', async ({
    page,
  }) => {
    await ownMap(page);
    const answer = page.waitForResponse(
      (r) => r.url().includes('/api/v1/search/garages/pins?') && r.ok(),
    );
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);
    const { total } = (await (await answer).json()) as { total: number };

    await expect(
      page.getByRole('region', { name: 'Harta service‑urilor' }),
    ).toBeVisible();
    const drawn = () =>
      page.evaluate(async () => {
        type Feature = { properties: { rate: string; stance: string } };
        const map = (
          window as unknown as {
            __MF_MAP?: {
              getSource(
                id: string,
              ): { getData(): Promise<{ features: Feature[] }> } | undefined;
            };
          }
        ).__MF_MAP;
        const data = await map?.getSource('pins')?.getData();
        return (data?.features ?? [])
          .map((f) => `${f.properties.rate} ${f.properties.stance}`)
          .sort();
      });

    await expect
      .poll(drawn)
      .toEqual(['150 works_on', '200 does_not_take', '90 works_on']);
    expect(total).toBe(4);
  });
});

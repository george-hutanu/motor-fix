import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ownMap, ready } from './accounts.js';
import { test } from './fixtures.js';

// A brand and three garages of this file's own, written straight to
// PostgreSQL: no seeded garage takes the brand, so the takers on the page are
// exactly these, and no other spec's counts move while they live. They stand
// together near Caracal, where no seeded garage does, and the page opens
// there: Results searches only from a place. A deployed address, whose run
// has no DATABASE_URL, skips the file.
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
  // Where the three garages stand, and the page with its place.
  const near = '44.100,24.400';
  const opened = () => `/ro/garages?brand=${brand.slug}&near=${near}`;
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
        `INSERT INTO garage (id, name, slug, status, approved_at, rating, review_count, latitude, longitude)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now(), $3, $4, 44.1, 24.4) RETURNING id`,
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
    await ready(page, opened());

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
    await page.goto(opened());

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
    await page.goto(opened());
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
  // One worker seeds the brand once: parallel workers share the stamp.
  test.describe.configure({ mode: 'serial' });

  const stamp = `${Date.now().toString(36)}m`;
  const brand = { name: `Marca Harta ${stamp}`, slug: `marca-harta-${stamp}` };
  // Far from the other describe's empty place, which runs beside it.
  const near = '45.350,22.850';
  const placed = [
    { at: [45.36, 22.86], bani: 15049, kind: 'company', stance: 'works_on' },
    { at: [45.34, 22.84], bani: 9000, kind: 'company', stance: 'works_on' },
    {
      at: [45.355, 22.83],
      bani: 20000,
      kind: 'company',
      stance: 'does_not_take',
    },
    { at: [45.35, 22.87], bani: 12000, kind: 'mobile', stance: 'works_on' },
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
    // Read on its way to the page: a response the browser hands over and
    // then drops (a navigation, a second read) cannot lose its body here.
    let total: number | undefined;
    await page.route(
      (url) => url.pathname === '/api/v1/search/garages/pins',
      async (route) => {
        const response = await route.fetch();
        // An error answer passes through as it came, JSON or not, so the
        // test fails on it instead of leaving the request hanging.
        if (!response.ok()) return route.fulfill({ response });
        const json = (await response.json()) as { total: number };
        total = json.total;
        await route.fulfill({ json, response });
      },
    );
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);

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
    await expect.poll(() => total).toBe(4);
  });

  // @traces 269-FR-014
  // @traces 269-FR-015
  test('draws the mobile mechanic over the place as a circle with its rate, and no pin', async ({
    page,
  }) => {
    await ownMap(page);
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);

    const drawn = () =>
      page.evaluate(async () => {
        type Feature = {
          geometry: { type: string };
          properties: { id: string; rate: string };
        };
        const map = (
          window as unknown as {
            __MF_MAP?: {
              getSource(
                id: string,
              ): { getData(): Promise<{ features: Feature[] }> } | undefined;
            };
          }
        ).__MF_MAP;
        const of = async (id: string) =>
          (await map?.getSource(id)?.getData())?.features ?? [];
        return {
          areas: (await of('areas')).map(
            (f) => `${f.properties.id} ${f.geometry.type} ${f.properties.rate}`,
          ),
          pins: (await of('pins')).map((f) => f.properties.id),
        };
      });

    await expect
      .poll(async () => (await drawn()).areas)
      .toEqual([`${ids[3]} Polygon 120`]);
    expect((await drawn()).pins).not.toContain(ids[3]);
    await expect(
      page
        .getByRole('region', { name: 'Harta service‑urilor' })
        .getByText('Mecanic mobil · zona deservită'),
    ).toBeVisible();
  });

  // @traces 269-FR-007
  // @traces 269-FR-008
  test('follows the map the driver drags, and goes back to the 25 km search', async ({
    page,
  }) => {
    await ownMap(page);
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);
    const tally = page.locator('.summary .tally');
    await expect(tally).toContainText('4 service‑uri găsite');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __MF_MAP?: unknown }).__MF_MAP !==
            undefined,
        ),
      )
      .toBe(true);

    // Away from the fixed garages; a jump is not the driver's, so it loads nothing.
    await page.evaluate(() =>
      (
        window as unknown as {
          __MF_MAP: { jumpTo(view: object): void };
        }
      ).__MF_MAP.jumpTo({ center: [22.6, 45.49], zoom: 12 }),
    );
    const boxed = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/search/garages?') &&
        r.url().includes('bbox=') &&
        r.ok(),
    );
    const canvas = page.locator('mf-results-map .canvas canvas');
    const at = await canvas.boundingBox();
    if (!at) throw new Error('the map has no canvas');
    const x = at.x + at.width / 2;
    const y = at.y + at.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 20, { steps: 8 });
    await page.mouse.up();
    await boxed;

    // Only the mobile mechanic, whose area covers the place, is left.
    await expect(tally).toContainText('1 service în zona hărții');
    await expect(page.locator('mf-result-card')).toHaveCount(1);

    await page.getByRole('button', { name: 'Înapoi la 25 km' }).click();

    await expect(tally).toContainText('4 service‑uri găsite');
    await expect(page.locator('mf-result-card')).toHaveCount(4);
  });

  // @traces 269-FR-010
  test('puts the map above the list on a phone, with no sideways scroll at 320 px or 390 px', async ({
    page,
  }) => {
    await ownMap(page);
    for (const [width, lang, region, scheme] of [
      [320, 'ro', 'Harta service‑urilor', 'light'],
      [390, 'en', 'Map of garages', 'dark'],
    ] as const) {
      await page.setViewportSize({ height: 800, width });
      await page.emulateMedia({ colorScheme: scheme });
      await ready(page, `/${lang}/garages?brand=${brand.slug}&near=${near}`);
      const map = page.getByRole('region', { name: region });

      await expect(page.locator('mf-result-card')).toHaveCount(4);
      await expect(map.locator('.legend')).toBeVisible();
      const mapBox = await map.boundingBox();
      const cardBox = await page
        .locator('mf-result-card')
        .first()
        .boundingBox();
      expect(mapBox && cardBox && mapBox.y + mapBox.height <= cardBox.y).toBe(
        true,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false);
    }
  });

  // @traces 269-FR-017
  test('keeps every card when the map cannot load, and says so on the map', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as { __MF_MAP_STYLE?: string }).__MF_MAP_STYLE =
        '/map/no-such-style.json';
    });
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);

    await expect(page.locator('mf-result-card')).toHaveCount(4);
    await expect(
      page
        .getByRole('region', { name: 'Harta service‑urilor' })
        .getByRole('status'),
    ).toHaveText('Harta nu este disponibilă acum');
    await expect(page.locator('.state[role="alert"]')).toHaveCount(0);
  });

  // A card and its pin, read through the map the page exposes: the lit
  // layers' filters name the lit garage, and a pin is clicked where the map
  // projects it.
  type Lit = 'pins-lit-dot' | 'areas-lit-fill';
  const litIn = (page: Page, layer: Lit) =>
    page.evaluate((id) => {
      const map = (
        window as unknown as {
          __MF_MAP?: { getFilter(id: string): unknown };
        }
      ).__MF_MAP;
      return JSON.stringify(map?.getFilter(id) ?? null);
    }, layer);
  async function mapSettled(page: Page) {
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const map = (
            window as unknown as {
              __MF_MAP?: {
                getSource(
                  id: string,
                ): { getData(): Promise<{ features: unknown[] }> } | undefined;
                isMoving(): boolean;
                loaded(): boolean;
              };
            }
          ).__MF_MAP;
          if (!map?.loaded() || map.isMoving()) return 0;
          return (await map.getSource('pins')?.getData())?.features.length ?? 0;
        }),
      )
      .toBeGreaterThan(0);
  }
  async function clickAt(page: Page, at: readonly [number, number]) {
    const spot = await page.evaluate(([lat, lng]) => {
      const map = (
        window as unknown as {
          __MF_MAP: {
            getCanvas(): HTMLCanvasElement;
            project(at: [number, number]): { x: number; y: number };
          };
        }
      ).__MF_MAP;
      const { x, y } = map.project([lng, lat]);
      const box = map.getCanvas().getBoundingClientRect();
      return { x: box.left + x, y: box.top + y };
    }, at);
    await page.mouse.click(spot.x, spot.y);
  }
  const named = (page: Page, i: number) =>
    page.locator('mf-result-card').filter({
      has: page.getByRole('heading', { name: `Service Harta ${stamp} ${i}` }),
    });

  // @traces 270-FR-001 270-FR-002 270-FR-003 270-FR-007 270-FR-013
  test('lights the pin of the card the pointer or the focus rests on, and turns the card tapped amber', async ({
    page,
  }) => {
    await ownMap(page);
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);
    await mapSettled(page);
    const first = page.locator('mf-result-card').first();
    await expect(first.locator('article.card')).toHaveClass(/selected/);

    await named(page, 1).hover();
    await expect.poll(() => litIn(page, 'pins-lit-dot')).toContain(ids[1]);

    await page.mouse.move(0, 0);
    await expect.poll(() => litIn(page, 'pins-lit-dot')).not.toContain(ids[1]);
    await named(page, 1).locator('a').first().focus();
    await expect.poll(() => litIn(page, 'pins-lit-dot')).toContain(ids[1]);

    await named(page, 1).getByRole('heading').click();
    await expect(named(page, 1).locator('article.card')).toHaveClass(
      /selected/,
    );
    await expect(page.locator('article.card.selected')).toHaveCount(1);
  });

  // @traces 270-FR-004 270-FR-013
  test('selects the card of a tapped pin and brings it into view, focus unmoved', async ({
    page,
  }) => {
    await ownMap(page);
    await page.setViewportSize({ height: 480, width: 1280 });
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);
    await mapSettled(page);

    await clickAt(page, placed[2].at);

    const card = named(page, 2);
    await expect(card.locator('article.card')).toHaveClass(/selected/);
    await expect(card).toBeInViewport();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
      'BODY',
    );
  });

  // The empty style carries no glyphs, so the circle's rate label is not
  // drawn here; its tap is the unit suite's. A tap on the fill names nothing.
  // @traces 270-FR-004 270-FR-008 270-FR-013
  test('lights the mobile mechanic circle of its card, and selects nothing for a tap on its fill', async ({
    page,
  }) => {
    await ownMap(page);
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);
    await mapSettled(page);

    await named(page, 3).hover();
    await expect.poll(() => litIn(page, 'areas-lit-fill')).toContain(ids[3]);

    await page.mouse.move(0, 0);
    const selected = await page
      .locator('mf-result-card:has(article.card.selected) h2')
      .textContent();
    await page.evaluate(() =>
      (
        window as unknown as {
          __MF_MAP: { jumpTo(view: object): void };
        }
      ).__MF_MAP.jumpTo({ center: [22.87, 45.35], zoom: 12 }),
    );
    await clickAt(page, [45.37, 22.87]);
    await expect(
      page.locator('mf-result-card:has(article.card.selected) h2'),
    ).toHaveText(selected ?? '');
  });

  // @traces 270-FR-010 270-FR-011 270-FR-013
  test('opens the small card for a pin whose garage the list does not show', async ({
    page,
  }) => {
    await ownMap(page);
    // The search near the place finds all four; the list answer drops one so
    // its pin has no card, and the ids= read still brings it.
    await page.route(
      (url) =>
        url.pathname === '/api/v1/search/garages' &&
        !url.searchParams.has('ids'),
      async (route) => {
        const response = await route.fetch();
        if (!response.ok()) return route.fulfill({ response });
        const json = (await response.json()) as {
          items: { id: string }[];
        };
        json.items = json.items.filter((item) => item.id !== ids[0]);
        await route.fulfill({ json, response });
      },
    );
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);
    await mapSettled(page);
    await expect(named(page, 0)).toHaveCount(0);

    await clickAt(page, placed[0].at);

    const small = page.locator('mf-map-card');
    await expect(small).toBeVisible();
    await expect(small).toContainText(`Service Harta ${stamp} 0`);
    await expect(
      small.getByRole('link', { name: 'Vezi service‑ul' }),
    ).toHaveAttribute(
      'href',
      `/ro/garages/e2e-harta-${stamp}-0?brand=${brand.slug}`,
    );
    await expect(page.locator('article.card.selected')).toHaveCount(0);

    await named(page, 1).getByRole('heading').click();
    await expect(small).toHaveCount(0);
  });

  // @traces 270-FR-009 270-FR-011 270-FR-013
  test('turns the card tapped amber when the map cannot load', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as { __MF_MAP_STYLE?: string }).__MF_MAP_STYLE =
        '/map/no-such-style.json';
    });
    await page.setViewportSize({ height: 800, width: 320 });
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);

    await named(page, 1).getByRole('heading').click();
    await expect(named(page, 1).locator('article.card')).toHaveClass(
      /selected/,
    );
    await expect(page.locator('article.card.selected')).toHaveCount(1);
    await expect(page.locator('.state[role="alert"]')).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  // Last: the garage it suspends stays suspended for the rest of the file.
  // @traces 269-FR-018
  test('takes the pin of a garage suspended while the page is open off the map within 2 seconds', async ({
    page,
  }) => {
    await ownMap(page);
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await ready(page, `/ro/garages?brand=${brand.slug}&near=${near}`);
    await stream;
    const pinned = () =>
      page.evaluate(async () => {
        type Feature = { properties: { id: string } };
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
        return (data?.features ?? []).map((f) => f.properties.id).sort();
      });
    await expect.poll(pinned).toHaveLength(3);
    const id = ids[0];

    // Written as the admin's suspension writes it, with the same audience.
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

    // The card leaves when the event arrives; the outbox relay's own delay
    // comes before it, the 2 seconds after.
    const card = page
      .locator('mf-result-card')
      .filter({ hasText: `Service Harta ${stamp} 0` });
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(pinned, { timeout: 2_000 }).not.toContain(id);
  });
});

// The seeded Cluj garages, measured from the Cluj test point the browser
// gives: Service Mărăști stands 1 km from it.
// @traces 271-garage-distance-FR-001
// @traces 271-garage-distance-FR-004
// @traces 271-garage-distance-FR-006
// @traces 271-garage-distance-FR-008
test.describe('Results measured from where the driver is @seeded', () => {
  test.use({
    geolocation: { latitude: 46.7712, longitude: 23.6236 },
    permissions: ['geolocation'],
  });

  type LiveMap = { project(at: [number, number]): { x: number; y: number } };

  for (const [lang, km] of [
    ['ro', '1,0 km'],
    ['en', '1.0 km'],
  ] as const) {
    test(`reads "${km}" on Service Mărăști and marks the place, with no tap (${lang})`, async ({
      page,
    }) => {
      await ownMap(page);
      await page.goto(`/${lang}/garages?brand=dacia`);

      await expect(page).toHaveURL(/[?&]near=46\.771,23\.624(&|$)/);
      await expect(
        page.locator('mf-result-card').filter({ hasText: 'Service Mărăști' }),
      ).toContainText(km);

      const marker = page.locator('.here');
      await expect(marker).toHaveCount(1);
      await expect(marker).toBeVisible();
      await expect(marker).toHaveAttribute('aria-hidden', 'true');
      // Centred on the place on the live map, within a pixel or two.
      await page.waitForFunction(
        () => (window as { __MF_MAP?: unknown }).__MF_MAP !== undefined,
      );
      const spot = await page.evaluate(() => {
        const map = (window as { __MF_MAP?: LiveMap }).__MF_MAP as LiveMap;
        const canvas = document
          .querySelector('.maplibregl-canvas')
          ?.getBoundingClientRect();
        const { x, y } = map.project([23.624, 46.771]);
        return { x: (canvas?.left ?? 0) + x, y: (canvas?.top ?? 0) + y };
      });
      await expect
        .poll(async () => {
          const box = await marker.boundingBox();
          if (!box) return Number.POSITIVE_INFINITY;
          return Math.max(
            Math.abs(box.x + box.width / 2 - spot.x),
            Math.abs(box.y + box.height / 2 - spot.y),
          );
        })
        .toBeLessThanOrEqual(2);
    });
  }

  test('holds 320 px with no sideways scroll, while it asks and with the marker', async ({
    page,
  }) => {
    await ownMap(page);
    await page.setViewportSize({ height: 800, width: 320 });
    const sideways = () =>
      page.evaluate(() => document.documentElement.scrollWidth > 320);

    // A browser that never answers keeps the status line up.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: () => undefined },
      });
    });
    await page.goto('/ro/garages?brand=dacia');
    await expect(
      page.getByRole('status').filter({ hasText: 'Se caută locația…' }),
    ).toBeVisible();
    expect(await sideways()).toBe(false);

    const answered = await page.context().newPage();
    await ownMap(answered);
    await answered.setViewportSize({ height: 800, width: 320 });
    await answered.goto('/en/garages?brand=dacia');
    await expect(answered.locator('.here')).toBeVisible();
    expect(
      await answered.evaluate(() => document.documentElement.scrollWidth > 320),
    ).toBe(false);
  });
});

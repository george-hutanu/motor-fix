import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { headers, openSignIn, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// @traces 1397-FR-001 1397-FR-002 1397-FR-005 1397-FR-008 1397-FR-012

const OWNER = 'militari@example.test';
const MECHANIC = 'mecanic-militari@example.test';
const NEWEST_VIEWS = 1240;
// The Wednesday of each of the eight complete weeks before this one, k = 1 the newest.
const DAYS = `SELECT (date_trunc('week', now() AT TIME ZONE 'Europe/Bucharest')::date
                    - 7 * k + 2) AS day, k
                  FROM generate_series(1, 8) AS k`;

interface Week {
  conversion: number | null;
  key: string;
  requests: number | null;
  views: number | null;
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signedIn(page: Page, email: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await openSignIn(page);
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
}

// Eight weeks of profile views for Service Auto Militari, one row on the
// Wednesday of each complete week before this one on the Bucharest clock,
// as the night job writes them. The rows found there first are put back
// afterwards. It needs DATABASE_URL, which CI's end-to-end job sets.
test.describe('the weekly figures on the garage overview @seeded', () => {
  let db: Client;
  let garageId: string;
  let before: { day: string; views: number; sources: unknown }[];

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM garage WHERE slug = 'service-auto-militari'",
    );
    const [garage] = rows;
    if (!garage)
      throw new Error('the seeded garage service-auto-militari is missing');
    garageId = garage.id;
    before = (
      await db.query<{ day: string; views: number; sources: unknown }>(
        `SELECT f.day::text AS day, f.profile_views AS views,
                f.profile_views_by_source AS sources
         FROM garage_daily_figures f JOIN (${DAYS}) d ON d.day = f.day
         WHERE f.garage_id = $1`,
        [garageId],
      )
    ).rows;
    await db.query(
      `INSERT INTO garage_daily_figures (garage_id, day, profile_views, written_at)
       SELECT $1::uuid, d.day, CASE WHEN d.k = 1 THEN $2::int ELSE 300 + 10 * d.k END, now()
       FROM (${DAYS}) d
       ON CONFLICT (garage_id, day) DO UPDATE
       SET profile_views = EXCLUDED.profile_views,
           profile_views_by_source = '{}'`,
      [garageId, NEWEST_VIEWS],
    );
  });

  test.afterAll(async () => {
    await db.query(
      `DELETE FROM garage_daily_figures
       WHERE garage_id = $1 AND day IN (SELECT day FROM (${DAYS}) d)`,
      [garageId],
    );
    for (const row of before) {
      await db.query(
        `INSERT INTO garage_daily_figures
           (garage_id, day, profile_views, profile_views_by_source, written_at)
         VALUES ($1, $2, $3, $4, now())`,
        [garageId, row.day, row.views, row.sources],
      );
    }
    await db.end();
  });

  test("shows the owner last week's figures, its sentence and the eight weeks at 320 px", async ({
    page,
    request,
  }) => {
    const read = await request.get(
      `/api/v1/garages/${garageId}/figures/weekly`,
      { headers: await headers(request, OWNER) },
    );
    expect(read.ok(), await read.text()).toBe(true);
    const { weeks } = (await read.json()) as { weeks: Week[] };
    const newest = weeks.at(-1);
    if (!newest) throw new Error('the weekly read returned no weeks');
    expect(newest.views).toBe(NEWEST_VIEWS);

    await page.setViewportSize({ height: 800, width: 320 });
    await signedIn(page, OWNER);

    const panel = page.locator('mf-weekly-figures-panel');
    await expect(panel.locator('[data-figure="views"]')).toHaveText('1.240');
    await expect(panel.locator('[data-figure="requests"]')).toHaveText(
      (newest.requests ?? 0).toLocaleString('de-DE'),
    );
    await expect(panel.locator('[data-sentence]')).toHaveText(
      newest.conversion === null
        ? 'Săptămâna trecută nu a avut vizualizări.'
        : `Săptămâna trecută, ${newest.conversion.toFixed(1).replace('.', ',')}% din vizualizări au devenit cereri.`,
    );

    const views = panel.locator('mf-bar-chart').first();
    await views.getByRole('button', { name: 'Vezi ca tabel' }).click();
    const rows = views.locator('tbody tr');
    await expect(rows).toHaveCount(8);
    await expect(rows.last()).toContainText(`S${newest.key.slice(-2)}`);
    await expect(rows.last()).toContainText('1.240');
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test("shows the garage's mechanic no panel and sends no weekly read", async ({
    page,
  }) => {
    const reads: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/figures/weekly')) reads.push(r.url());
    });

    await signedIn(page, MECHANIC);

    await expect(page.locator('mf-own-jobs-section')).toBeVisible();
    await expect(page.locator('[data-section="funnel"]')).toHaveCount(0);
    await expect(page.locator('mf-weekly-figures-panel')).toHaveCount(0);
    expect(reads).toEqual([]);
  });
});

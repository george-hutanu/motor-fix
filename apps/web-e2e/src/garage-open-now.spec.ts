import { expect } from '@playwright/test';
import { Client } from 'pg';

import { test } from './fixtures.js';

// The browser's clock decides the line once the page starts, while the closed
// days come from the server's real today. So each test fixes the browser at a
// day the server's window holds, chosen in PostgreSQL.
// @traces 309-FR-009 309-FR-012 309-FR-013
test.describe('whether a garage is open now @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its garage and a holiday straight to PostgreSQL, which needs DATABASE_URL',
  );
  test.describe.configure({ mode: 'serial' });
  const slug = `e2e-deschis-${Date.now().toString(36)}`;
  const DAY = [['08:00', '19:00']];
  const hours = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, DAY]),
  );
  let db: Client;
  let holiday: string | undefined;

  const at1015 = async (sql: string) => {
    const { rows } = await db.query<{ day: string; at: Date }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              (d + time '10:15') AT TIME ZONE 'Europe/Bucharest' AS at
         FROM (${sql}) AS chosen(d)`,
    );
    return rows[0] as { day: string; at: Date };
  };

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    await db.query(
      `INSERT INTO garage (id, name, slug, status, approved_at, address,
         latitude, longitude, hours)
       VALUES (gen_random_uuid(), 'Service Deschis E2E', $1, 'approved', now(),
         'Strada Exemplu 1, București', 44.43, 26.1, $2)`,
      [slug, JSON.stringify(hours)],
    );
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE slug = $1', [slug]);
    if (holiday)
      await db.query('DELETE FROM public_holiday WHERE day = $1', [holiday]);
    await db.end();
  });

  test('says the garage is open until its closing time', async ({ page }) => {
    const { at } = await at1015(
      `SELECT d::date FROM generate_series(
          (now() AT TIME ZONE 'Europe/Bucharest')::date + 1,
          (now() AT TIME ZONE 'Europe/Bucharest')::date + 14, interval '1 day') AS d
        WHERE d::date NOT IN (SELECT day FROM public_holiday)
        ORDER BY d LIMIT 1`,
    );
    await page.clock.setFixedTime(at);

    await page.goto(`/ro/garages/${slug}`);

    await expect(page.getByText('Deschis azi până la 19:00')).toBeVisible();
  });

  test('says a legal holiday shuts the garage today', async ({ page }) => {
    const { day, at } = await at1015(
      `SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date + 14`,
    );
    const inserted = await db.query(
      `INSERT INTO public_holiday (day, name_ro, name_en)
       VALUES ($1, 'Sărbătoare E2E', 'E2E holiday') ON CONFLICT (day) DO NOTHING`,
      [day],
    );
    if (inserted.rowCount) holiday = day;
    await page.clock.setFixedTime(at);

    await page.goto(`/ro/garages/${slug}`);

    await expect(
      page.getByText(
        'Închis azi · sărbătoare legală · deschide mâine la 08:00',
      ),
    ).toBeVisible();
  });

  // FR-012: the longest line wraps on a phone instead of scrolling sideways.
  for (const width of [320, 390]) {
    test(`shows the holiday line at ${width} px with no sideways scroll`, async ({
      page,
    }) => {
      const { at } = await at1015(
        `SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date + 14`,
      );
      await page.setViewportSize({ height: 800, width });
      await page.clock.setFixedTime(at);

      await page.goto(`/ro/garages/${slug}`);

      await expect(
        page.getByText(
          'Închis azi · sărbătoare legală · deschide mâine la 08:00',
        ),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }
});

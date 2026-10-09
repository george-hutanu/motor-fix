import { expect, type Page } from '@playwright/test';
import { Queue, QueueEvents } from 'bullmq';
import { Client } from 'pg';

import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const SIZES = [
  { height: 640, width: 320 },
  { height: 844, width: 390 },
  { height: 1180, width: 820 },
  { height: 900, width: 1440 },
];

// Garages, a driver and requests of this file's own, written straight to
// PostgreSQL, and the night's job queued by hand on the worker's queue. A
// deployed address, whose run has neither DATABASE_URL nor REDIS_URL, skips it.
// @traces 384-FR-008 384-FR-009 384-FR-011
test.describe('the response rate on a garage profile @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'] || !process.env['REDIS_URL'],
    'seeds requests in PostgreSQL and runs the night job through Redis',
  );
  test.describe.configure({ mode: 'serial' });
  const tag = Date.now().toString(36);
  const slugs = {
    fresh: `e2e-nou-${tag}`,
    quiet: `e2e-linistit-${tag}`,
    rated: `e2e-rata-${tag}`,
  };
  let db: Client;
  let driverId: string;
  let carId: string;
  const ids: Record<keyof typeof slugs, string> = {
    fresh: '',
    quiet: '',
    rated: '',
  };

  async function arrived(
    garageId: string,
    hoursAgo: number,
    answeredAfterHours: number | null,
  ) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO quote_request (id, driver_id, car_id, car_brand, car_model,
         car_year, car_fuel, created_at, expires_at, idempotency_key)
       VALUES (gen_random_uuid(), $1, $2, 'Dacia', 'Logan', 2018, 'petrol',
         now() - make_interval(hours => $3), now() + interval '7 days',
         gen_random_uuid()::text)
       RETURNING id`,
      [driverId, carId, hoursAgo],
    );
    await db.query(
      `INSERT INTO request_recipient (id, request_id, garage_id, source, status,
         created_at, answered_at)
       VALUES (gen_random_uuid(), $1, $2, 'search', $3, now() - make_interval(hours => $4),
         now() - make_interval(hours => $4) + make_interval(hours => $5))`,
      [
        rows[0]?.id,
        garageId,
        answeredAfterHours === null ? 'waiting' : 'quoted',
        hoursAgo,
        answeredAfterHours,
      ],
    );
  }

  async function runTheNight() {
    const connection = { url: process.env['REDIS_URL'] as string };
    const queue = new Queue('insights', { connection });
    const events = new QueueEvents('insights', { connection });
    try {
      await events.waitUntilReady();
      const job = await queue.add('response-stats', {});
      await job.waitUntilFinished(events, 30_000);
    } finally {
      await events.close();
      await queue.close();
    }
  }

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    for (const key of Object.keys(slugs) as (keyof typeof slugs)[]) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO garage (id, name, slug, status, approved_at)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now())
         RETURNING id`,
        [`Service E2E ${key}`, slugs[key]],
      );
      ids[key] = rows[0]?.id as string;
    }
    const driver = await db.query<{ id: string }>(
      `INSERT INTO account (id, name, last_role) VALUES (gen_random_uuid(), 'Șofer E2E ${tag}', 'driver')
       RETURNING id`,
    );
    driverId = driver.rows[0]?.id as string;
    const car = await db.query<{ id: string }>(
      `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, odometer_km,
         idempotency_key)
       VALUES (gen_random_uuid(), $1, (SELECT id FROM brand ORDER BY key LIMIT 1), 'Logan', 2018,
         'petrol', 120000, gen_random_uuid()::text)
       RETURNING id`,
      [driverId],
    );
    carId = car.rows[0]?.id as string;

    for (let day = 2; day < 13; day++) await arrived(ids.rated, day * 24, 2);
    await arrived(ids.rated, 72, null);
    for (let day = 2; day < 11; day++) await arrived(ids.fresh, day * 24, 2);
    for (let day = 40; day < 50; day++) await arrived(ids.quiet, day * 24, 2);

    await runTheNight();
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM account WHERE id = $1', [driverId]);
    await db.query('DELETE FROM garage WHERE slug = ANY($1)', [
      Object.values(slugs),
    ]);
    await db.end();
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`says the rate in Romanian at every size, ${colorScheme}, never sideways at 320 px`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.goto(`/ro/garages/${slugs.rated}`);

        await expect(
          page.getByText('Răspunde la 91% din cereri într‑o zi'),
        ).toBeVisible();
        if (size.width === 320) {
          expect(await sideways(page)).toBeLessThanOrEqual(0);
        }
      }
    });
  }

  test('says the rate in English', async ({ page }) => {
    await page.goto(`/en/garages/${slugs.rated}`);

    await expect(
      page.getByText('Answers 91% of requests within a day'),
    ).toBeVisible();
  });

  test('says a garage with 9 requests is new, and shows nothing for one quiet for 30 days', async ({
    page,
  }) => {
    await page.goto(`/ro/garages/${slugs.fresh}`);
    await expect(page.getByText('Nou pe MotorFix')).toBeVisible();

    await page.goto(`/ro/garages/${slugs.quiet}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/Răspunde la|Nou pe MotorFix/)).toHaveCount(0);
  });

  test('changes the open profile in place when the night changes the rate', async ({
    page,
  }) => {
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto(`/ro/garages/${slugs.rated}`);
    await expect(
      page.getByText('Răspunde la 91% din cereri într‑o zi'),
    ).toBeVisible();
    await stream;
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    await arrived(ids.rated, 36, 2);
    await runTheNight();

    await expect(
      page.getByText('Răspunde la 92% din cereri într‑o zi'),
    ).toBeVisible({ timeout: 15_000 });
    expect(navigations).toBe(0);
  });
});

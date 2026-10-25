import { expect, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { Client } from 'pg';

import { ACCOUNTS, headers } from './accounts.js';
import { test } from './fixtures.js';

// @traces 024-FR-001
// @traces 024-FR-002
// @traces 024-FR-004
// @traces 024-FR-011
// @traces 024-FR-013
// @traces 024-FR-023

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const section = (page: Page, name = 'Ce spun șoferii') =>
  page.getByRole('region', { exact: true, name });

test.describe('the reviews on a garage profile @seeded', () => {
  test('shows a garage nobody reviewed as such, with no rows', async ({
    page,
  }) => {
    await page.goto('/ro/garages/service-titan');

    const reviews = section(page);
    await expect(reviews).toBeVisible();
    await expect(reviews).toContainText('Încă nu are recenzii.');
    await expect(reviews.getByText('5 stele')).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('says the section in English', async ({ page }) => {
    await page.goto('/en/garages/service-titan');

    await expect(section(page, 'What drivers say')).toContainText(
      'No reviews yet.',
    );
  });
});

// The seeded driver's review of Atelier Test, written straight to PostgreSQL
// by the seed; a second review another browser posts through the API on a
// done job written here; and the seeded review's edit announced on Redis as
// the API announces one. It needs DATABASE_URL and REDIS_URL, which CI's
// end-to-end job sets; release runs only the @core flows against a deployed
// address.
test.describe('a reviewed garage’s profile @seeded', () => {
  const SEEDED = 'Schimb de ulei făcut repede, mașina predată la timp.';
  let db: Client;
  let garageId: string;
  let reviewId: string;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const { rows } = await db.query<{ garage: string; review: string }>(
      `SELECT g.id AS garage, r.id AS review
       FROM review r JOIN garage g ON g.id = r.garage_id
       WHERE g.slug = 'atelier-test' AND r.text = $1`,
      [SEEDED],
    );
    const [seeded] = rows;
    if (!seeded)
      throw new Error('the seeded review of atelier-test is missing');
    garageId = seeded.garage;
    reviewId = seeded.review;
  });

  test.afterAll(async () => {
    await db.query('UPDATE review SET text = $2 WHERE id = $1', [
      reviewId,
      SEEDED,
    ]);
    await db.end();
  });

  test('shows the breakdown and the review with its author and month', async ({
    page,
  }) => {
    await page.goto('/ro/garages/atelier-test');

    const reviews = section(page);
    await expect(reviews.getByText('5 stele')).toBeVisible();
    await expect(reviews.getByText('1 stea')).toBeVisible();
    const card = reviews.locator('article.review', { hasText: SEEDED });
    await expect(card).toBeVisible();
    await expect(card).toContainText('5,0 / 5');
    await expect(card.locator('.author')).toHaveText(/^\S+( \S\.)?$/);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('shows a review another browser posts at the top without a reload', async ({
    browser,
    page,
  }) => {
    const jobId = await doneJob(db, garageId);
    const before = await db.query<{ rating: string | null; n: number }>(
      'SELECT rating::text AS rating, review_count AS n FROM garage WHERE id = $1',
      [garageId],
    );
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto('/ro/garages/atelier-test');
    const reviews = section(page);
    await expect(reviews.getByText(SEEDED)).toBeVisible();
    await stream;
    const fours = reviews.locator('.breakdown li', { hasText: '4 stele' });
    const fourCount = Number(await fours.locator('.n').innerText());
    const count = await reviews.locator('.count').innerText();
    let reloads = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads++;
    });

    const text = `Frâne verificate și reglate (${Date.now().toString(36)}).`;
    const other = await browser.newContext();
    try {
      const posted = await other.request.post('/api/v1/reviews', {
        data: { jobId, rating: 4, text },
        headers: await headers(other.request, ACCOUNTS.otherDriver),
      });
      expect(posted.status(), await posted.text()).toBe(201);

      await expect(reviews.locator('article.review').first()).toContainText(
        text,
        { timeout: 5_000 },
      );
      await expect(fours.locator('.n')).toHaveText(String(fourCount + 1), {
        timeout: 5_000,
      });
      // The stored count follows once the worker has recomputed it.
      await expect(reviews.locator('.count')).not.toHaveText(count, {
        timeout: 15_000,
      });
      expect(reloads).toBe(0);
    } finally {
      await other.close();
      await removeJob(db, jobId);
      const [was] = before.rows;
      await db.query(
        'UPDATE garage SET rating = $2::numeric, review_count = $3 WHERE id = $1',
        [garageId, was?.rating ?? null, was?.n ?? 0],
      );
    }
  });

  test('shows a review’s change without a reload', async ({ page }) => {
    // A stream that failed a few times in a row waits 1, 2, 5 and 10 s
    // (live/stream.ts) before its resync shows the change: past 30 s.
    test.slow();
    // The stream is open once its answer has come back: a request alone may
    // still be refused (the visitors' streams share one address here) and
    // retried after the message has gone out, which Redis does not replay.
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto('/ro/garages/atelier-test');
    const reviews = section(page);
    await expect(reviews.getByText(SEEDED)).toBeVisible();
    await stream;
    let reloads = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads++;
    });

    const changed = `Revenit după o lună: totul în regulă (${Date.now().toString(36)}).`;
    await db.query('UPDATE review SET text = $2 WHERE id = $1', [
      reviewId,
      changed,
    ]);
    // Redis hands a message only to the streams open as it goes out; one
    // that re-opened in between learns of the change from its resync, after
    // a backoff that can outlast one wait. So the edit is announced again
    // until the page shows it, as a second edit would be.
    const redis = new Redis(process.env['REDIS_URL'] as string);
    const announce = () =>
      redis.publish(
        'live:events',
        JSON.stringify({
          audience: [`public:garage:${garageId}`],
          event: {
            at: new Date().toISOString(),
            id: reviewId,
            kind: 'review.edited',
          },
        }),
      );
    try {
      await expect(async () => {
        await announce();
        await expect(reviews.getByText(changed)).toBeVisible({
          timeout: 3_000,
        });
      }).toPass({ intervals: [0], timeout: 40_000 });
    } finally {
      redis.disconnect();
    }
    expect(reloads).toBe(0);
  });
});

// A done job at the garage for the seeded second driver, with the request,
// quote and booking it rests on, so the driver can post a review of it; its id
// is returned. Written straight to the tables, as the seed writes its own.
async function doneJob(db: Client, garageId: string) {
  const { rows } = await db.query<{ job: string }>(
    `WITH driver AS (
       SELECT a.id, c.id AS car FROM account a JOIN car c ON c.owner_id = a.id
       WHERE a.email = $2 ORDER BY c.created_at LIMIT 1
     ), request AS (
       INSERT INTO quote_request (id, driver_id, car_id, car_brand, car_model, car_year, car_fuel,
                                  car_engine, description, status, created_at, expires_at,
                                  idempotency_key)
       SELECT gen_random_uuid(), d.id, d.car, 'Dacia', 'Logan', 2018, 'petrol', '1.0 TCe',
              'Frânele scârțâie', 'done', now() - interval '3 days', now() + interval '4 days',
              'e2e-reviews-' || gen_random_uuid()::text
       FROM driver d
       RETURNING id, driver_id, car_id
     ), recipient AS (
       INSERT INTO request_recipient (id, request_id, garage_id, status, source, answered_at)
       SELECT gen_random_uuid(), r.id, $1, 'quoted', 'search', now() FROM request r
       RETURNING id, request_id
     ), quote AS (
       INSERT INTO quote (id, request_id, recipient_id, garage_id, from_bani, to_bani,
                          duration_minutes, slot, status, accepted_at, expires_at, idempotency_key)
       SELECT gen_random_uuid(), p.request_id, p.id, $1, 45000, 60000, 90,
              now() - interval '1 day', 'accepted', now() - interval '2 days',
              now() + interval '4 days', gen_random_uuid()::text
       FROM recipient p
       RETURNING id, request_id, slot
     ), booking AS (
       INSERT INTO booking (id, quote_id, request_id, garage_id, driver_id, starts_at,
                            duration_minutes, status, confirm_by, confirmed_at, completed_at)
       SELECT gen_random_uuid(), q.id, q.request_id, $1, r.driver_id, q.slot, 90, 'completed',
              q.slot, now() - interval '2 days', now()
       FROM quote q JOIN request r ON r.id = q.request_id
       RETURNING id, driver_id
     )
     INSERT INTO job (id, booking_id, garage_id, car_id, driver_id, status, started_at,
                      finished_at, handed_over_at)
     SELECT gen_random_uuid(), b.id, $1, r.car_id, b.driver_id, 'done',
            now() - interval '1 day', now(), now()
     FROM booking b JOIN request r ON r.driver_id = b.driver_id
     RETURNING id AS job`,
    [garageId, ACCOUNTS.otherDriver],
  );
  const [made] = rows;
  if (!made) throw new Error('the seeded second driver has no car');
  return made.job;
}

// The job, its review and everything it rests on, gone again: each row
// down from the request is removed with it.
async function removeJob(db: Client, jobId: string) {
  await db.query(
    `DELETE FROM quote_request WHERE id = (
       SELECT b.request_id FROM job j JOIN booking b ON b.id = j.booking_id
       WHERE j.id = $1)`,
    [jobId],
  );
}

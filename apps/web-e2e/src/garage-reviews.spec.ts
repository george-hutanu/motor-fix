import { expect, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { Client } from 'pg';

import { ACCOUNTS, headers } from './accounts.js';
import { test } from './fixtures.js';
import { doneJob, removeJob } from './review-jobs.js';

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

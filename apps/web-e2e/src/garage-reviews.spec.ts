import { expect, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { Client } from 'pg';

import { test } from './fixtures.js';

// @traces 024-FR-001
// @traces 024-FR-002
// @traces 024-FR-004
// @traces 024-FR-011
// @traces 024-FR-013

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
// by the seed, and its edit announced on Redis as the API announces one. It
// needs DATABASE_URL and REDIS_URL, which CI's end-to-end job sets; release
// runs only the @core flows against a deployed address.
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

  test('shows a review’s change without a reload', async ({ page }) => {
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
    const redis = new Redis(process.env['REDIS_URL'] as string);
    try {
      await redis.publish(
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
    } finally {
      redis.disconnect();
    }

    await expect(reviews.getByText(changed)).toBeVisible({ timeout: 5_000 });
    expect(reloads).toBe(0);
  });
});

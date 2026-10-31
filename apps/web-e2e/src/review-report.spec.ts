import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, headers, openSignIn, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import {
  doneJob,
  holdReviews,
  releaseReviews,
  removeJob,
} from './review-jobs.js';
import { keepSeededLanguage } from './seeded-language.js';

// @traces 1382-FR-001
// @traces 1382-FR-003
// @traces 1382-FR-005
// @traces 1382-FR-009

async function signedIn(page: Page, email: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await openSignIn(page);
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
}

// The owner of Atelier Test reports a review the seeded second driver posted.
// It needs DATABASE_URL, which CI's end-to-end job sets; the review and its
// report go with the job afterwards.
test.describe('the owner reports a review @seeded', () => {
  let db: Client;
  let garageId: string;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM garage WHERE slug = 'atelier-test'",
    );
    const [garage] = rows;
    if (!garage) throw new Error('the seeded garage atelier-test is missing');
    garageId = garage.id;
  });

  test.beforeEach(() => holdReviews(db, garageId));
  test.afterEach(() => releaseReviews(db, garageId));

  test.afterAll(async () => {
    await db.end();
  });

  test('reports a review for insults and the row shows it hidden until an admin decides', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const jobId = await doneJob(db, garageId);
    const before = await db.query<{ rating: string | null; n: number }>(
      'SELECT rating::text AS rating, review_count AS n FROM garage WHERE id = $1',
      [garageId],
    );
    const text = `Nepoliticoși la telefon (${Date.now().toString(36)}).`;
    try {
      const posted = await request.post('/api/v1/reviews', {
        data: { jobId, rating: 1, text },
        headers: await headers(request, ACCOUNTS.otherDriver),
      });
      expect(posted.status(), await posted.text()).toBe(201);

      await signedIn(page, ACCOUNTS.garage);
      await page.goto('/app/garage/reviews');
      const row = page
        .locator('mf-garage-reviews-panel article[mf-garage-review-row]')
        .filter({ hasText: text });
      await row.getByRole('button', { name: 'Raportează' }).click();

      const task = page.getByRole('dialog', { name: 'Raportează recenzia' });
      await expect(task).toBeVisible();
      await task.getByRole('radio', { name: 'Insulte' }).check();
      await task.getByRole('button', { name: 'Trimite raportul' }).click();

      await expect(task).toBeHidden();
      await expect(
        page.getByText('Raportată. Un admin decide în 48 de ore.'),
      ).toBeVisible();
      await expect(row.locator('[data-reported]')).toBeVisible();
      await expect(row.getByRole('button', { name: 'Raportează' })).toHaveCount(
        0,
      );
      const stored = await db.query<{ status: string }>(
        `SELECT r.status FROM review r JOIN job j ON j.id = r.job_id
         WHERE j.id = $1`,
        [jobId],
      );
      expect(stored.rows[0]?.status).toBe('reported');

      // The public profile no longer lists it.
      const shown = await request.get(`/api/v1/reviews/garage/${garageId}`);
      expect(shown.status()).toBe(200);
      const { items } = (await shown.json()) as { items: { text: string }[] };
      expect(items.map((item) => item.text)).not.toContain(text);
    } finally {
      await removeJob(db, jobId);
      const [kept] = before.rows;
      await db.query(
        'UPDATE garage SET rating = $2::numeric, review_count = $3 WHERE id = $1',
        [garageId, kept?.rating ?? null, kept?.n ?? 0],
      );
    }
  });
});

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

// @traces 1389-reported-reviews-admin-FR-001
// @traces 1389-reported-reviews-admin-FR-002
// @traces 1389-reported-reviews-admin-FR-005
// @traces 1389-reported-reviews-admin-FR-006

const waiting = async (page: Page) => {
  const name =
    (await page
      .getByRole('navigation')
      .getByRole('link', { name: /^Recenzii raportate/ })
      .first()
      .getAttribute('aria-label')) ??
    (await page
      .getByRole('navigation')
      .getByRole('link', { name: /^Recenzii raportate/ })
      .first()
      .innerText());
  return Number(/(\d+) în așteptare/.exec(name)?.[1] ?? 0);
};

// The admin keeps Recenzii raportate open while Atelier Test's owner reports
// a review the seeded second driver posted. It needs DATABASE_URL, which CI's
// end-to-end job sets; it shares Atelier Test's reviews with the
// garage-reviews flows, so it holds their lock.
test.describe('reported reviews on the admin dashboard @seeded', () => {
  test.describe.configure({ mode: 'default' });

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

  test('shows a review the garage reports, with its reason and facts, without a reload', async ({
    browser,
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const jobId = await doneJob(db, garageId);
    const before = await db.query<{ rating: string | null; n: number }>(
      'SELECT rating::text AS rating, review_count AS n FROM garage WHERE id = $1',
      [garageId],
    );
    const other = await browser.newContext();
    try {
      const text = `Nu recomand, m-au tratat urât (${Date.now().toString(36)}).`;
      const posted = await other.request.post('/api/v1/reviews', {
        data: { jobId, rating: 1, text },
        headers: await headers(other.request, ACCOUNTS.otherDriver),
      });
      expect(posted.status(), await posted.text()).toBe(201);
      const { id: reviewId } = (await posted.json()) as { id: string };

      await keepSeededLanguage(page);
      await ready(page, '/ro');
      await openSignIn(page);
      const live = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/live') && r.ok(),
      );
      await signIn(page, ACCOUNTS.admin);
      await expect(page).toHaveURL('/app/admin');
      await live;
      await page.goto('/app/admin/reviews');
      const view = page.locator('mf-admin-reviews');
      await expect(
        view.getByRole('heading', { name: 'Recenzii raportate' }),
      ).toBeVisible();
      await expect(view.locator('ul[aria-busy="true"]')).toHaveCount(0);
      const was = await waiting(page);
      let reloads = 0;
      page.on('load', () => reloads++);

      const reported = await other.request.post(
        `/api/v1/reviews/${reviewId}/reports`,
        {
          data: { reason: 'insults' },
          headers: await headers(other.request, ACCOUNTS.garage),
        },
      );
      expect(reported.status(), await reported.text()).toBe(201);

      const item = view.getByRole('article', {
        name: 'Atelier Test · recenzie de 1,0',
      });
      const ours = item.filter({ hasText: text });
      await expect(ours).toBeVisible({ timeout: 5_000 });
      await expect(ours.locator('mf-lamp')).toHaveText(
        'Raportată de service: Insulte',
      );
      const facts = ours.locator('.facts li');
      await expect(facts).toHaveCount(4);
      await expect(facts.nth(0)).toContainText('Lucrare confirmată: ');
      await expect(facts.nth(1)).toContainText('Cont creat: ');
      await expect(facts.nth(2)).toHaveText(
        'Recenzii identice de la același cont: 0',
      );
      await expect(facts.nth(3)).toHaveText(
        /^Recenzii raportate de service înainte: \d+, păstrate \d+$/,
      );
      await expect.poll(() => waiting(page), { timeout: 5_000 }).toBe(was + 1);
      expect(reloads).toBe(0);
    } finally {
      await other.close();
      await removeJob(db, jobId);
      const [stored] = before.rows;
      await db.query(
        'UPDATE garage SET rating = $2::numeric, review_count = $3 WHERE id = $1',
        [garageId, stored?.rating ?? null, stored?.n ?? 0],
      );
    }
  });
});

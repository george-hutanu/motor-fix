import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, headers, openSignIn, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { doneJob, removeJob } from './review-jobs.js';
import { keepSeededLanguage } from './seeded-language.js';

// @traces 074-FR-001
// @traces 074-FR-002
// @traces 074-FR-006
// @traces 074-FR-014

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function signedIn(page: Page, email: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await openSignIn(page);
  const live = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/live') && r.ok(),
  );
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
  await live;
}

// The owner of Atelier Test keeps the dashboard open while the seeded second
// driver posts a review of a job Vlad Stan did. It needs DATABASE_URL, which
// CI's end-to-end job sets; release runs only the @core flows.
test.describe('new reviews on the garage dashboard @seeded', () => {
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

  test.afterAll(async () => {
    await db.end();
  });

  test('shows Recenzii noi on Panou with no sideways scroll at 320 px', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 320 });
    await signedIn(page, ACCOUNTS.garage);

    const panel = page.locator('mf-garage-reviews-panel');
    await expect(
      panel.getByRole('heading', { name: 'Recenzii noi' }),
    ).toBeVisible();
    await expect(
      panel.locator('article[mf-garage-review-row]').first(),
    ).toBeVisible();
    await expect(panel.locator('a[data-all]')).toHaveText('Vezi toate');
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('shows a review a driver posts at the top, with the mechanic, and the new figures without a reload', async ({
    browser,
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const jobId = await doneJob(db, garageId, ACCOUNTS.mechanic);
    const before = await db.query<{ rating: string | null; n: number }>(
      'SELECT rating::text AS rating, review_count AS n FROM garage WHERE id = $1',
      [garageId],
    );
    await signedIn(page, ACCOUNTS.garage);
    await page.goto('/app/garage/reviews');
    const panel = page.locator('mf-garage-reviews-panel');
    const figure = panel.locator('[data-figure]');
    await expect(figure).toBeVisible();
    const was = await figure.innerText();
    let reloads = 0;
    page.on('load', () => reloads++);

    const text = `Ambreiaj schimbat fără surprize (${Date.now().toString(36)}).`;
    const other = await browser.newContext();
    try {
      const posted = await other.request.post('/api/v1/reviews', {
        data: { jobId, rating: 4, text },
        headers: await headers(other.request, ACCOUNTS.otherDriver),
      });
      expect(posted.status(), await posted.text()).toBe(201);

      const top = panel.locator('article[mf-garage-review-row]').first();
      await expect(top).toContainText(text, { timeout: 5_000 });
      await expect(top.locator('[data-mechanic]')).toHaveText('Vlad S.');
      await expect(top.locator('[data-new]')).toHaveText('Nou');
      // The worker recomputes the stored figures and announces them, within
      // the same 5 seconds.
      await expect(figure).not.toHaveText(was, { timeout: 5_000 });
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

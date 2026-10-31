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

// @traces 1387-FR-001 1387-FR-002 1387-FR-003 1387-FR-004 1387-FR-007

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

// The seeded second driver reviews a job at Atelier Test; its owner answers
// from Recenzii while a visitor keeps the profile open. It needs DATABASE_URL,
// which CI's end-to-end job sets.
test.describe('replying to a review @seeded', () => {
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

  test('the owner replies and edits from the dashboard; the open profile and the driver see it without a reload', async ({
    browser,
    page,
    request,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    const jobId = await doneJob(db, garageId, ACCOUNTS.mechanic);
    const before = await db.query<{ rating: string | null; n: number }>(
      'SELECT rating::text AS rating, review_count AS n FROM garage WHERE id = $1',
      [garageId],
    );
    const visitor = await browser.newContext();
    try {
      const driver = await headers(request, ACCOUNTS.otherDriver);
      const text = `Distribuție schimbată la timp (${Date.now().toString(36)}).`;
      const posted = await request.post('/api/v1/reviews', {
        data: { jobId, rating: 5, text },
        headers: driver,
      });
      expect(posted.status(), await posted.text()).toBe(201);

      const profile = await visitor.newPage();
      const stream = profile.waitForResponse(
        (r) => r.url().includes('/api/v1/live/public?') && r.ok(),
      );
      await profile.goto('/ro/garages/atelier-test');
      const card = profile
        .getByRole('region', { exact: true, name: 'Ce spun șoferii' })
        .locator('article.review', { hasText: text });
      await expect(card).toBeVisible();
      await stream;
      let reloads = 0;
      profile.on('framenavigated', (frame) => {
        if (frame === profile.mainFrame()) reloads++;
      });

      await signedIn(page, ACCOUNTS.garage);
      await page.goto('/app/garage/reviews');
      const row = page
        .locator('mf-garage-reviews-panel article[mf-garage-review-row]')
        .filter({ hasText: text });
      await row.getByRole('button', { name: 'Răspunde' }).click();

      const dialog = page.getByRole('dialog', { name: 'Răspunde la recenzie' });
      const field = dialog.getByRole('textbox', { name: 'Răspunsul tău' });
      await expect(field).toBeFocused();
      const reply = `Mulțumim! Vă mai așteptăm (${Date.now().toString(36)}).`;
      await field.fill(reply);
      await expect(dialog.locator('[data-count]')).toHaveText(
        `${[...reply].length} / 1.000`,
      );
      await dialog.getByRole('button', { name: 'Publică răspunsul' }).click();
      await expect(dialog.getByRole('status')).toHaveText(
        'Răspunsul e public, sub recenzie.',
      );
      await dialog.getByRole('button', { name: 'Gata' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(row.locator('[data-reply-text]')).toHaveText(reply);
      await expect(
        row.getByRole('button', { name: 'Editează răspunsul' }),
      ).toBeFocused();

      await expect(card.locator('[data-reply-text]')).toHaveText(reply, {
        timeout: 5_000,
      });
      await expect(card.locator('.reply-label')).toHaveText(
        'Răspunsul service‑ului',
      );

      await row.getByRole('button', { name: 'Editează răspunsul' }).click();
      const editing = page.getByRole('dialog', { name: 'Editează răspunsul' });
      await expect(
        editing.getByRole('textbox', { name: 'Răspunsul tău' }),
      ).toHaveValue(reply);
      const edited = `${reply} Garanție 12 luni.`;
      await editing
        .getByRole('textbox', { name: 'Răspunsul tău' })
        .fill(edited);
      await editing.getByRole('button', { name: 'Publică răspunsul' }).click();
      await editing.getByRole('button', { name: 'Gata' }).click();
      await expect(row.locator('[data-reply-edited]')).toContainText('Editat');

      await expect(card.locator('[data-reply-text]')).toHaveText(edited, {
        timeout: 5_000,
      });
      await expect(card.locator('[data-reply-edited]')).toContainText('Editat');
      expect(reloads).toBe(0);

      const bell = await browser.newContext();
      const reader = await bell.newPage();
      try {
        await keepSeededLanguage(reader);
        await ready(reader, '/ro');
        await openSignIn(reader);
        await signIn(reader, ACCOUNTS.otherDriver);
        await expect(reader).toHaveURL(/\/app\/driver/);
        await reader.getByRole('button', { name: /^Notificări/ }).click();
        await expect(
          reader.getByRole('dialog', { name: 'Notificări' }),
        ).toContainText(/ți-a răspuns la recenzie\./, { timeout: 10_000 });
      } finally {
        await bell.close();
      }
    } finally {
      await visitor.close();
      await removeJob(db, jobId);
      const [stored] = before.rows;
      await db.query(
        'UPDATE garage SET rating = $2::numeric, review_count = $3 WHERE id = $1',
        [garageId, stored?.rating ?? null, stored?.n ?? 0],
      );
    }
  });
});

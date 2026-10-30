import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, signedIn } from './accounts.js';
import { test } from './fixtures.js';

// The seeded mechanic's Panou on a phone, and a permission the owner gives her
// reaching her open tab. The owner has no screen yet to tick a mechanic's
// permission after the invite (an invite keeps the permissions of a mechanic
// already there), so the flow saves the tick as that save would: the card's
// column and its `mechanic.updated` event in the same transaction, which the
// worker relays to her stream. It runs after the chromium project
// (playwright.config.mts), so no flow beside it reads her menu or the seeded
// job's steps while it changes them. A deployed address, whose run has no
// database, leaves @database out (playwright.config.mts); every other run has
// DATABASE_URL, so the flow fails without it.

// On a phone the menu is the tab bar, whose entry is the short "Cereri" with
// its count; "Cereri de ofertă" is the wide menu's, which a phone never shows.
const requestsTab = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Panou service' })
    .getByRole('link', { name: /^Cereri/ });

// Saves the mechanic's quote permission as the owner's save does.
async function answerQuotes(db: Client, mechanicId: string, on: boolean) {
  await db.query('BEGIN');
  try {
    const card = await db.query<{ garage_id: string }>(
      `UPDATE mechanic SET can_answer_quotes = $2 WHERE id = $1
       RETURNING garage_id`,
      [mechanicId, on],
    );
    const garageId = card.rows[0]?.garage_id ?? '';
    await db.query(
      `INSERT INTO outbox_event (kind, subject_id, payload, audience)
       VALUES ('mechanic.updated', $1, $2, $3)`,
      [
        mechanicId,
        JSON.stringify({ fields: ['canAnswerQuotes'], garageId, mechanicId }),
        [`garage:${garageId}`, `mechanic:${mechanicId}`],
      ],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

// @traces 423-FR-006 423-FR-010
test.describe("a mechanic's Panou on a phone @seeded @database", () => {
  let db: Client;
  let mechanicId = '';

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const card = await db.query<{ id: string }>(
      `SELECT m.id FROM mechanic m JOIN account a ON a.id = m.account_id
       WHERE a.email = $1`,
      [ACCOUNTS.mechanic],
    );
    mechanicId = card.rows[0]?.id ?? '';
    expect(mechanicId).not.toBe('');
    // Whatever an earlier run left: the seeded mechanic may not answer quotes.
    await answerQuotes(db, mechanicId, false);
  });

  test.afterAll(async () => {
    try {
      if (mechanicId) await answerQuotes(db, mechanicId, false);
    } finally {
      await db.end();
    }
  });

  test('she sees only her job, opens it, ticks a step, and Cereri de ofertă appears without a reload once she may answer quotes', async ({
    page,
  }) => {
    // Signing in, a step written and ticked, and a live update: more than one
    // page's time.
    test.setTimeout(60_000);
    await page.setViewportSize({ height: 844, width: 390 });
    await signedIn(page, ACCOUNTS.mechanic, '/app/garage');

    const own = page.locator('mf-own-jobs-section');
    const rows = own.locator('[data-job]');
    await expect(rows.first()).toBeVisible();
    await expect(rows.filter({ hasText: 'B101QAT' })).toHaveCount(1);
    for (const row of await rows.all())
      await expect(row).not.toContainText('Andrei');
    await expect(page.locator('[data-verified-pill]')).toHaveCount(0);
    await expect(page.locator('mf-garage-legal-check')).toHaveCount(0);
    await expect(page.locator('mf-garage-requests-panel')).toHaveCount(0);
    await expect(requestsTab(page)).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    await rows.filter({ hasText: 'B101QAT' }).click();
    const job = page.getByRole('dialog');
    await expect(
      job.getByText(/\d+ din \d+ gata|Niciun pas încă/).first(),
    ).toBeVisible();
    const step = `Verificare mecanic ${Date.now().toString(36)}`;
    const steps = job.locator('[data-step]');
    await job.getByRole('button', { name: 'Adaugă un pas' }).click();
    await job.getByRole('textbox').fill(step);
    await job.getByRole('button', { exact: true, name: 'Adaugă' }).click();
    const mine = steps.filter({ hasText: step });
    await expect(mine).toHaveCount(1);
    await mine.locator('button[aria-pressed]').click();
    await expect(mine.locator('button[aria-pressed]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await mine.locator('button.menu-button').click();
    await page.getByRole('button', { name: 'Șterge' }).click();
    await expect(mine).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(job).toHaveCount(0);

    await answerQuotes(db, mechanicId, true);
    await expect(requestsTab(page)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('mf-garage-requests-panel')).toBeVisible({
      timeout: 5_000,
    });

    await answerQuotes(db, mechanicId, false);
    await expect(requestsTab(page)).toHaveCount(0, { timeout: 5_000 });
  });
});

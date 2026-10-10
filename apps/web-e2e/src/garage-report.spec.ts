import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, hydrated, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const TEXT = 'Au cerut plata înainte și nu au reparat mașina.';
const THANKS = 'Mulțumim. Raportarea a ajuns la echipa MotorFix.';

const report = (page: Page) =>
  page.getByRole('dialog', { name: 'Ce s‑a întâmplat?' });

async function send(page: Page) {
  const task = report(page);
  await task.getByRole('textbox').fill(TEXT);
  await task.getByRole('button', { name: 'Trimite raportarea' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: THANKS }),
  ).toBeVisible();
}

// The tests report a listed garage no other spec names, and put its file back
// after each: a garage of their own would change the counts Home shows to the
// specs running beside them. A deployed address, whose run has no
// DATABASE_URL, skips them.
test.describe('a report of a garage from its profile @seeded', () => {
  // The preset runs tests fully parallel; these share one garage, so they
  // take turns in one worker.
  test.describe.configure({ mode: 'default' });
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its garage straight to PostgreSQL, which needs DATABASE_URL',
  );
  const slug = 'atelier-drumul-taberei';
  let db: Client;
  let garageId: string;
  let since: Date;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM garage WHERE slug = $1',
      [slug],
    );
    garageId = rows[0]?.id as string;
  });

  test.beforeEach(async () => {
    since = (
      await db.query<{ now: Date }>(
        "SELECT clock_timestamp() - interval '1 millisecond' AS now",
      )
    ).rows[0]?.now as Date;
  });

  test.afterEach(async () => {
    await db.query(
      `DELETE FROM notification WHERE event_id IN (
         SELECT 'garage.reported:' || id FROM garage_report WHERE garage_id = $1)`,
      [garageId],
    );
    await db.query('DELETE FROM garage_report WHERE garage_id = $1', [
      garageId,
    ]);
    await db.query(
      `UPDATE verification_file SET status = 'approved', reopen_reason = NULL,
         reopened_at = NULL, reopened_by = NULL
       WHERE garage_id = $1`,
      [garageId],
    );
  });

  test.afterAll(async () => {
    await db.end();
  });

  // @traces 312-FR-002 312-FR-008 312-FR-015
  test('a driver reports the garage, and its file goes back to the admins', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');
    await hydrated(page, `/ro/garages/${slug}`);

    await page.getByRole('button', { name: 'Raportează service‑ul' }).click();
    await send(page);

    await expect(
      page.getByRole('button', { name: 'Raportează service‑ul' }),
    ).toHaveCount(0);
    const stored = await db.query<{ text: string; status: string }>(
      'SELECT text, status FROM garage_report WHERE garage_id = $1',
      [garageId],
    );
    expect(stored.rows).toEqual([{ status: 'open', text: TEXT }]);
    const file = await db.query<{
      reopen_reason: string;
      reopened_by: string | null;
      status: string;
    }>(
      `SELECT status, reopen_reason, reopened_by FROM verification_file
       WHERE garage_id = $1`,
      [garageId],
    );
    expect(file.rows).toEqual([
      {
        reopen_reason: 'garage_report',
        reopened_by: null,
        status: 'in_review',
      },
    ]);
    const garage = await db.query<{ status: string }>(
      'SELECT status FROM garage WHERE id = $1',
      [garageId],
    );
    expect(garage.rows[0]?.status).toBe('approved');
    const events = await db.query<{ kind: string }>(
      `SELECT kind FROM outbox_event
       WHERE payload->>'garageId' = $1 AND created_at >= $2 ORDER BY kind`,
      [garageId, since],
    );
    expect(events.rows.map(({ kind }) => kind)).toEqual([
      'garage.reported',
      'verification.reopened',
    ]);
    const audit = await db.query<{ subject_type: string }>(
      `SELECT subject_type FROM activity_log
       WHERE garage_id = $1 AND at >= $2 ORDER BY subject_type`,
      [garageId, since],
    );
    expect(audit.rows.map(({ subject_type }) => subject_type)).toEqual([
      'garage_report',
      'verification_file',
    ]);
  });

  // @traces 312-FR-003
  test('asks a visitor to sign in, then opens the report on the same page', async ({
    page,
  }) => {
    const profile = `/ro/garages/${slug}`;
    await hydrated(page, profile);

    await page.getByRole('button', { name: 'Raportează service‑ul' }).click();
    await signIn(page, ACCOUNTS.otherDriver);

    await expect(report(page)).toBeVisible();
    await expect(page).toHaveURL(profile);
    await send(page);
  });

  test('leaves the page as it was when the visitor closes the sign-in', async ({
    page,
  }) => {
    const profile = `/ro/garages/${slug}`;
    await hydrated(page, profile);

    await page.getByRole('button', { name: 'Raportează service‑ul' }).click();
    const gate = page.getByRole('dialog', { name: 'Autentificare' });
    await expect(gate.locator('mf-overlay-panel')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(gate).toHaveCount(0);
    await expect(report(page)).toHaveCount(0);
    await expect(page).toHaveURL(profile);
    await expect(
      page.getByRole('button', { name: 'Raportează service‑ul' }),
    ).toBeVisible();
  });
});

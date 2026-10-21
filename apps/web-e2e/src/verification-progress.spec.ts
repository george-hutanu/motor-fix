import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ownAddress, ownMap, signInAsAdmin2 } from './accounts.js';
import { test } from './fixtures.js';
import {
  answerSurvey,
  confirmation,
  fillListing,
  signUp,
  unique,
} from './listing-send.js';

test.beforeEach(({ context }) => ownMap(context));

const page$ = (page: Page) => page.locator('mf-verification-progress');
const lit = (page: Page) =>
  page$(page).locator('mf-verification-stages li[aria-current="step"] .name');
const menuLinks = (page: Page) =>
  page.getByRole('navigation', { name: 'Meniu' }).getByRole('link');
const drawer = (page: Page) => page.locator('mf-verification-file');
const footer = (page: Page) => drawer(page).locator('[data-section="footer"]');

// The owner of a listing just sent follows its file on the dashboard while an
// admin opens it, asks for more and approves it, with no reload.
// @traces 101-FR-013
test.describe('the owner follows the verification on the dashboard @seeded @database', () => {
  let db: Client;
  let garageId: string | undefined;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterEach(async () => {
    if (!garageId) return;
    await db.query(
      'DELETE FROM outbox_event WHERE subject_id IN (SELECT id::text FROM verification_file WHERE garage_id = $1)',
      [garageId],
    );
    // A file left waiting would push the queue's own test row off the
    // overview's few.
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
    garageId = undefined;
  });

  test.afterAll(async () => {
    await db.end();
  });

  // @traces 101-FR-001 101-FR-002 101-FR-003 101-FR-005 101-FR-006 101-FR-007
  test('"Trimis", then "În verificare", "Cerute completări" and the dashboard once approved', async ({
    browser,
    context,
    page,
  }) => {
    // A send, a sign-up and an admin's three decisions in a second browser.
    test.slow();
    await ownAddress(page, '198.18.4');
    const name = `Service Urmărit ${unique()}`;
    await fillListing(context, page, name);
    const email = await page.getByLabel('E‑mail').inputValue();
    await page.locator('.actions .send').click();
    await expect(confirmation(page).locator('.complete')).toBeVisible();
    await answerSurvey(page);
    await signUp(page, email);

    await page.goto('/app/garage');
    await expect(page.locator('header h1')).toHaveText(
      'Profilul tău e în verificare',
    );
    await expect(lit(page)).toHaveText(/^Trimis · /);
    await expect(menuLinks(page)).toHaveCount(0);
    const loads = await page.evaluate(
      () => performance.getEntriesByType('navigation').length,
    );

    const { rows } = await db.query<{ file: string; garage: string }>(
      `SELECT f.id::text AS file, g.id::text AS garage
       FROM garage g JOIN verification_file f ON f.garage_id = g.id
       WHERE g.name = $1`,
      [name],
    );
    garageId = rows[0]?.garage;
    const fileId = rows[0]?.file;
    expect(fileId).toBeTruthy();

    const admin = await browser.newContext();
    try {
      const desk = await admin.newPage();
      // Signed in once the admin's dashboard opens, then the file's drawer.
      await signInAsAdmin2(desk);
      await desk.goto(`/app/admin/garages/${fileId}`);
      await expect(drawer(desk).locator('h3')).toHaveText(name);

      await expect(lit(page)).toHaveText('În verificare');

      await footer(desk)
        .getByRole('button', { name: 'Cere completări' })
        .click();
      const ask = desk
        .getByRole('dialog')
        .filter({ hasText: 'Trimite cererea' });
      await ask.getByRole('textbox').fill('Lipsește o fotografie a fațadei.');
      await ask.getByRole('checkbox', { name: 'Fotografiile' }).check();
      await ask.getByRole('button', { name: 'Trimite cererea' }).click();
      await expect(footer(desk)).toContainText('Completări cerute de');

      await expect(lit(page)).toHaveText('Cerute completări');
      await expect(page$(page).locator('.items li')).toHaveText([
        'Fotografiile',
      ]);

      // The garage's resend, then every check passed, as the approval needs.
      await db.query(
        `UPDATE verification_file SET status = 'in_review', submitted_at = now() WHERE id = $1`,
        [fileId],
      );
      await db.query(
        `UPDATE verification_check SET result = 'ok' WHERE file_id = $1`,
        [fileId],
      );
      await db.query(
        `INSERT INTO legal_document (id, verification_file_id, kind, pages)
         SELECT gen_random_uuid(), $1::uuid, kind, ARRAY[kind || '/1.pdf']
         FROM unnest(ARRAY['onrc_certificate', 'rar_authorisation']::text[]) AS kind
         WHERE NOT EXISTS (SELECT 1 FROM legal_document d WHERE d.verification_file_id = $1::uuid AND d.kind = kind)`,
        [fileId],
      );
      await desk.reload();
      await footer(desk)
        .getByRole('button', { name: 'Aprobă și publică' })
        .click();
      await desk
        .getByRole('dialog')
        .filter({ hasText: 'Toate verificările sunt în regulă.' })
        .getByRole('button', { name: 'Aprobă și publică' })
        .click();
      await expect(footer(desk)).toContainText('Aprobat de');
    } finally {
      await admin.close();
    }

    await expect(page$(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('header h1')).toHaveText('Panou service');
    await expect(page.locator('header h1')).toBeFocused();
    await expect(menuLinks(page).first()).toHaveText('Panou');
    expect(
      await page.evaluate(
        () => performance.getEntriesByType('navigation').length,
      ),
    ).toBe(loads);
  });
});

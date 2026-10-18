import { randomUUID } from 'node:crypto';

import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

async function signInAsAdmin2(page: Page) {
  await ready(page, '/ro/garages');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { exact: true, name: 'Cont' })
      .click();
  } else {
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
  }
  await signIn(page, ACCOUNTS.admin2);
  await expect(page).toHaveURL('/app/admin');
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const drawer = (page: Page) => page.locator('mf-verification-file');
const footer = (page: Page) => drawer(page).locator('[data-section="footer"]');

const NOTE = 'Autorizația RAR a expirat în septembrie.';

// The admin rejects a file through the button and its dialog: the footer and
// the queue row follow without a reload, the garage stays hidden, and the
// owner's notice carries the reason and the note.
// @traces 305-FR-002 305-FR-006 305-FR-011
test.describe('rejecting a garage with a reason @seeded @database', () => {
  let db: Client;
  let garageId: string;
  let fileId: string;
  let name: string;
  let slug: string;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.beforeEach(async () => {
    garageId = randomUUID();
    name = `Respingere ${garageId.slice(0, 8)}`;
    slug = `respingere-${garageId}`;
    await db.query(
      `INSERT INTO garage (id, name, slug, city_key, city_name, business_kind, address, phone, cui)
       VALUES ($1, $2, $3, 'bucuresti', 'București', 'company', 'Str. Fabricii 12, București', '+40712345678', '1234567897')`,
      [garageId, name, slug],
    );
    const { rows } = await db.query<{ id: string }>(
      // The oldest sending heads the queue, so the row is on its first page.
      `INSERT INTO verification_file (id, garage_id, status, submitted_at)
       VALUES (gen_random_uuid(), $1, 'submitted', '2000-01-01T08:00:00Z') RETURNING id::text`,
      [garageId],
    );
    fileId = rows[0]?.id ?? '';
    // Every check left not run: a rejection never waits for the checks.
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind)
       SELECT gen_random_uuid(), $1, kind
       FROM unnest(enum_range(NULL::verification_check_kind)) AS kind`,
      [fileId],
    );
  });

  test.afterEach(async () => {
    await db.query('DELETE FROM outbox_event WHERE subject_id = $1', [fileId]);
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
  });

  test.afterAll(async () => {
    await db.end();
  });

  for (const width of [undefined, 320]) {
    test(`rejects through the dialog and keeps the queue row${width ? ` at ${width} px` : ''}`, async ({
      page,
    }) => {
      if (width) await page.setViewportSize({ height: 640, width });
      await signInAsAdmin2(page);
      await page.goto('/app/admin/garages');
      const row = page.locator('li.row').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await row.getByRole('link').click();
      await expect(page).toHaveURL(`/app/admin/garages/${fileId}`);

      const reject = footer(page).getByRole('button', { name: 'Respinge' });
      await expect(reject).toBeEnabled();
      await reject.click();
      const dialog = page
        .getByRole('dialog')
        .filter({ hasText: 'Mesaj pentru service' });
      // On a phone the dialog's own box is empty; its panel is what shows.
      await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
      expect(await sideways(page)).toBe(0);

      const confirm = dialog.getByRole('button', { name: 'Respinge' });
      await confirm.click();
      await expect(dialog.getByRole('alert')).toHaveText('Alege un motiv.');
      await dialog.getByRole('radio', { name: 'Autorizația RAR' }).check();
      await dialog.getByRole('textbox').fill('Prea scurt');
      await expect(dialog).toContainText('10/1000');
      await dialog.getByRole('textbox').fill('Scurt');
      await confirm.click();
      await expect(dialog.getByRole('alert')).toHaveText(
        'Mesajul are cel puțin 10 caractere.',
      );
      await dialog.getByRole('textbox').fill(NOTE);
      await confirm.click();

      await expect(footer(page)).toContainText('Respins de');
      await expect(footer(page)).toContainText(NOTE);
      await expect(footer(page).getByRole('button')).toHaveCount(0);
      expect(await sideways(page)).toBe(0);

      await page.keyboard.press('Escape');
      await expect(drawer(page)).toHaveCount(0);
      await expect(row).toContainText('Respins');
      await expect(row.getByRole('link')).toBeVisible();
      expect(await sideways(page)).toBe(0);

      expect((await page.request.get(`/api/v1/garages/${slug}`)).status()).toBe(
        404,
      );
      const { rows } = await db.query<{
        file: string;
        garage: string;
        payload: { note?: string; reason?: string };
      }>(
        `SELECT f.status::text AS file, g.status::text AS garage, e.payload
         FROM verification_file f JOIN garage g ON g.id = f.garage_id
         JOIN outbox_event e ON e.subject_id = f.id::text AND e.kind = 'verification.decided'
         WHERE f.id = $1`,
        [fileId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        file: 'rejected',
        garage: 'draft',
        payload: { note: NOTE, reason: 'rar' },
      });
    });
  }
});

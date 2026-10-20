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
      .getByRole('banner')
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

const PHONE = '+40712345678';
const NEW_PHONE = '+40722000000';
const NOTE = 'Adăugați fotografii cu intrarea și cu zona de lucru.';

// The admin asks a garage for more through the button and its dialog: the
// footer and the queue row follow without a reload. The garage's return is
// done through the database, as no screen offers it yet: the row comes back
// marked "Actualizat" and the drawer lists what changed since the request.
// @traces 304-FR-001
// @traces 304-FR-006
// @traces 304-FR-007
// @traces 304-FR-009
// @traces 304-FR-014
test.describe('asking a garage for more and getting the file back @seeded @database', () => {
  let db: Client;
  let garageId: string;
  let fileId: string;
  let name: string;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.beforeEach(async () => {
    garageId = randomUUID();
    name = `Completari ${garageId.slice(0, 8)}`;
    await db.query(
      `INSERT INTO garage (id, name, slug, city_key, city_name, business_kind, address, phone, cui)
       VALUES ($1, $2, $3, 'bucuresti', 'București', 'company', 'Str. Fabricii 12, București', $4, '1234567897')`,
      [garageId, name, `completari-${garageId}`, PHONE],
    );
    const { rows } = await db.query<{ id: string }>(
      // The oldest sending heads the queue, so the row is on its first page.
      `INSERT INTO verification_file (id, garage_id, status, submitted_at)
       VALUES (gen_random_uuid(), $1, 'submitted', '2000-01-01T08:00:00Z') RETURNING id::text`,
      [garageId],
    );
    fileId = rows[0]?.id ?? '';
    // Every check left not run: a request for more never waits for them.
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

  // What the garage's resend does to the file: back to waiting, announced to
  // the admins; and one change of its profile after the request.
  async function returned() {
    await db.query(
      `UPDATE verification_file SET status = 'submitted', submitted_at = now() WHERE id = $1`,
      [fileId],
    );
    await db.query(
      `INSERT INTO activity_log (id, action, subject_type, subject_id, field, old_value, new_value, actor_role, actor_name, garage_id)
       VALUES (gen_random_uuid(), 'update', 'garage', $1, 'phone', to_jsonb($2::text), to_jsonb($3::text), 'owner', 'Proprietar', $1)`,
      [garageId, PHONE, NEW_PHONE],
    );
    await db.query(`UPDATE garage SET phone = $2 WHERE id = $1`, [
      garageId,
      NEW_PHONE,
    ]);
    await db.query(
      `INSERT INTO outbox_event (audience, kind, payload, subject_id)
       VALUES ($1, 'verification.submitted', $2, $3)`,
      [
        ['admin', `garage:${garageId}`],
        JSON.stringify({ fileId, garageId }),
        fileId,
      ],
    );
  }

  for (const width of [undefined, 320]) {
    test(`asks for photos, then reads the returned file${width ? ` at ${width} px` : ''}`, async ({
      page,
    }) => {
      if (width) await page.setViewportSize({ height: 640, width });
      await signInAsAdmin2(page);
      await page.goto('/app/admin/garages');
      const row = page.locator('li.row').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await row.getByRole('link').click();
      await expect(page).toHaveURL(`/app/admin/garages/${fileId}`);

      const ask = footer(page).getByRole('button', { name: 'Cere completări' });
      await expect(ask).toBeEnabled();
      await ask.click();
      const dialog = page
        .getByRole('dialog')
        .filter({ hasText: 'Trimite cererea' });
      // On a phone the dialog's container has no box of its own.
      await expect(dialog.getByRole('textbox')).toBeVisible();
      await expect(dialog.getByRole('textbox')).toBeFocused();
      expect(await sideways(page)).toBe(0);

      const confirm = dialog.getByRole('button', { name: 'Trimite cererea' });
      await confirm.click();
      await expect(dialog.getByRole('alert')).toHaveText('Scrie ce lipsește.');
      await dialog.getByRole('textbox').fill('Scurt');
      await confirm.click();
      await expect(dialog.getByRole('alert')).toHaveText(
        'Cel puțin 10 caractere.',
      );
      await dialog.getByRole('textbox').fill(NOTE);
      await dialog.getByRole('checkbox', { name: 'Fotografiile' }).check();
      await confirm.click();

      await expect(footer(page)).toContainText('Completări cerute de');
      await expect(footer(page)).toContainText(NOTE);
      await expect(footer(page)).toContainText('Fotografiile');
      expect(await sideways(page)).toBe(0);

      const { rows } = await db.query<{
        file: string;
        garage: string;
        items: string[];
        payload: { note?: string };
      }>(
        `SELECT f.status::text AS file, g.status::text AS garage, f.requested_items::text[] AS items, e.payload
         FROM verification_file f JOIN garage g ON g.id = f.garage_id
         JOIN outbox_event e ON e.subject_id = f.id::text AND e.kind = 'verification.decided'
         WHERE f.id = $1`,
        [fileId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        file: 'more_requested',
        garage: 'draft',
        items: ['photos'],
        payload: { note: NOTE },
      });

      await page.keyboard.press('Escape');
      await expect(drawer(page)).toHaveCount(0);
      await expect(row).toContainText('Cerute completări');
      await expect(row.getByRole('link')).toBeVisible();
      expect(await sideways(page)).toBe(0);

      await returned();
      await expect(row.locator('.tag')).toHaveText('Actualizat', {
        timeout: 15_000,
      });
      await expect(row).toHaveCount(1);
      expect(await sideways(page)).toBe(0);

      await row.getByRole('link').click();
      const changes = drawer(page).getByRole('region', {
        name: 'Ce s‑a schimbat',
      });
      await expect(changes).toContainText('de la cererea din');
      await expect(changes.locator('[data-area="profile"]')).toContainText(
        `Telefonul: ${PHONE} → ${NEW_PHONE}`,
      );
      expect(await sideways(page)).toBe(0);
    });
  }
});

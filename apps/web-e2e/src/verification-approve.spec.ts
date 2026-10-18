import { randomUUID } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';
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
// The line boxes the dialog's confirm label lays out in, once its font loaded.
const confirmLines = async (page: Page, dialog: Locator) => {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return dialog.locator('button[type="submit"]').evaluate((button) => {
    const range = document.createRange();
    range.selectNodeContents(button);
    return new Set(
      [...range.getClientRects()]
        .filter((rect) => rect.width > 0)
        .map((rect) => Math.round(rect.top)),
    ).size;
  });
};
// The dialog's two actions as laid out: each one's width and text size.
const actionFaces = (dialog: Locator) =>
  dialog.locator('.actions button').evaluateAll((buttons) =>
    buttons.map((button) => ({
      size: getComputedStyle(button).fontSize,
      width: Math.round(button.getBoundingClientRect().width),
    })),
  );
const drawer = (page: Page) => page.locator('mf-verification-file');
const footer = (page: Page) => drawer(page).locator('[data-section="footer"]');

// The admin approves a clean file through the button and its dialog: the
// footer and the queue row follow without a reload, and the garage is public.
// @traces 303-FR-001 303-FR-002 303-FR-008 303-FR-012
test.describe('approving and publishing a garage @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'seeds a garage and its file in PostgreSQL, which needs DATABASE_URL',
  );

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
    name = `Aprobare ${garageId.slice(0, 8)}`;
    slug = `aprobare-${garageId}`;
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
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind, result)
       SELECT gen_random_uuid(), $1, kind, 'ok'::verification_check_result
       FROM unnest(enum_range(NULL::verification_check_kind)) AS kind`,
      [fileId],
    );
    await db.query(
      `INSERT INTO legal_document (id, verification_file_id, kind, pages)
       SELECT gen_random_uuid(), $1::uuid, kind, ARRAY[kind || '/1.pdf']
       FROM unnest(ARRAY['onrc_certificate', 'rar_authorisation']::text[]) AS kind`,
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
    test(`approves through the dialog and keeps the queue row${width ? ` at ${width} px` : ''}`, async ({
      page,
    }) => {
      if (width) await page.setViewportSize({ height: 640, width });
      expect((await page.request.get(`/api/v1/garages/${slug}`)).status()).toBe(
        404,
      );
      await signInAsAdmin2(page);
      await page.goto('/app/admin/garages');
      const row = page.locator('li.row').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await row.getByRole('link').click();
      await expect(page).toHaveURL(`/app/admin/garages/${fileId}`);

      const approve = footer(page).getByRole('button', {
        name: 'Aprobă și publică',
      });
      await expect(approve).toBeEnabled();
      await approve.click();
      const dialog = page
        .getByRole('dialog')
        .filter({ hasText: 'Toate verificările sunt în regulă.' });
      // On a phone the dialog's own box is empty; its panel is what shows.
      await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
      expect(await sideways(page)).toBe(0);
      await dialog.getByRole('button', { name: 'Aprobă și publică' }).click();

      await expect(footer(page)).toContainText('Aprobat de');
      await expect(footer(page).getByRole('button')).toHaveCount(0);
      expect(await sideways(page)).toBe(0);

      await page.keyboard.press('Escape');
      await expect(drawer(page)).toHaveCount(0);
      await expect(row).toContainText('Aprobat, e pe hartă');
      await expect(row.getByRole('link')).toBeVisible();
      expect(await sideways(page)).toBe(0);

      await expect
        .poll(
          async () =>
            (await page.request.get(`/api/v1/garages/${slug}`)).status(),
          { message: 'the approved garage is not public', timeout: 15_000 },
        )
        .toBe(200);
      const { rows } = await db.query<{ last: string | null }>(
        `SELECT last_checked_on::text AS last FROM garage WHERE id = $1`,
        [garageId],
      );
      expect(rows[0]?.last).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  }

  // English holds the longer label: at the full button size it wraps in a
  // 390 px phone's sheet. The account answers in English for this test only.
  for (const width of [320, 390]) {
    test(`keeps the English confirm label on one line at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 640, width });
      await page.route('**/api/v1/me', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const me = (await response.json()) as Record<string, unknown>;
        await route.fulfill({ json: { ...me, language: 'en' }, response });
      });
      await signInAsAdmin2(page);
      await page.goto('/app/admin/garages');
      const row = page.locator('li.row').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await row.getByRole('link').click();

      await footer(page)
        .getByRole('button', { name: 'Approve and publish' })
        .click();
      const dialog = page
        .getByRole('dialog')
        .filter({ hasText: 'Every check is ok.' });
      // On a phone the dialog's own box is empty; its panel is what shows.
      await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
      expect(await confirmLines(page, dialog)).toBe(1);
      // On a phone the actions stack full width. Cancel keeps the body size,
      // as every other sheet's buttons do; only the wide label face of the
      // confirm takes the small size, which keeps it on one line.
      const [cancel, confirm] = await actionFaces(dialog);
      expect(cancel?.size).toBe('16px');
      expect(confirm?.size).toBe('13px');
      expect(confirm?.width).toBe(cancel?.width);
      expect(await sideways(page)).toBe(0);
    });
  }
});

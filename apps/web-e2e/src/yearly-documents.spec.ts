import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { openSignIn, ready, signIn, signInAsAdmin2 } from './accounts.js';
import { test } from './fixtures.js';

// Approved garages and owners of this file's own, written straight to
// PostgreSQL, their yearly documents due today: the server decides the row
// by its own day, so the due date is set on the clock rather than the clock
// moved to it. The owner uploads both documents, an admin accepts them from
// the drawer, and the row turns green with next year's month; a second
// garage's upload is refused, and its owner reads the note.
// @traces 068-FR-005 068-FR-006 068-FR-009 068-FR-010 068-FR-011 068-FR-012 068-FR-017

// The store checks the first bytes only.
const pdf = (name: string) => ({
  buffer: Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n'),
  mimeType: 'application/pdf',
  name,
});

// Today, a Bucharest calendar day, as the server counts it.
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
    new Date(),
  );
// The product's short Romanian month names, as the row writes them.
const MONTHS = [
  'ian.',
  'feb.',
  'mart.',
  'apr.',
  'mai',
  'iun.',
  'iul.',
  'aug.',
  'sept.',
  'oct.',
  'nov.',
  'dec.',
];
// The browser's own day a few days back, for an issue date the picker takes.
const localDate = (daysBefore: number) => {
  const at = new Date();
  at.setDate(at.getDate() - daysBefore);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const legal = (page: Page) =>
  page.getByRole('region', { name: 'Verificare legală' });
const documentsRow = (page: Page) =>
  legal(page).locator('[data-legal-row="documents"]');
const drawer = (page: Page) => page.locator('mf-verification-file');
const drawerDocument = (page: Page, kind: string) =>
  drawer(page).locator(`li.document[data-kind="${kind}"]`);

test.describe('the yearly documents, from the owner’s row to the admin’s decision @seeded @database', () => {
  test.describe.configure({ mode: 'serial' });

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const password = 'proprietar-anual-2026';
  const NOTE = 'Certificatul nu arată punctul de lucru';
  const renewed = {
    email: `anual-${stamp}@example.test`,
    fileId: '',
    garageId: '',
    name: `Atelier Anual ${stamp}`,
  };
  const refused = {
    email: `anual-refuz-${stamp}@example.test`,
    fileId: '',
    garageId: '',
    name: `Atelier Refuz ${stamp}`,
  };
  let db: Client;

  const garage = async (into: typeof renewed, slug: string) => {
    const made = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, last_checked_on)
       VALUES (gen_random_uuid(), $1, $2, 'approved', now() - interval '1 year', DATE '2026-10-01')
       RETURNING id::text`,
      [into.name, `e2e-${slug}-${stamp}`],
    );
    into.garageId = made.rows[0]?.id ?? '';
    const file = await db.query<{ id: string }>(
      `INSERT INTO verification_file (id, garage_id, status, opened_at, decided_at)
       VALUES (gen_random_uuid(), $1, 'approved', now(), now())
       RETURNING id::text`,
      [into.garageId],
    );
    into.fileId = file.rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind, result, recorded_at)
       SELECT gen_random_uuid(), $1, k::verification_check_kind, 'ok', now()
       FROM unnest(ARRAY['company', 'caen', 'rar', 'documents']) AS k`,
      [into.fileId],
    );
    await db.query(
      `INSERT INTO legal_document (verification_file_id, kind, pages, status, created_at)
       SELECT $1::uuid, k, ARRAY['legal_document/' || $1::text || '/e2e-' || k || '-1'], 'valid', now() - interval '1 year'
       FROM unnest(ARRAY['onrc_certificate', 'rar_authorisation']) AS k`,
      [into.fileId],
    );
    await db.query(
      `INSERT INTO garage_document_cycle (garage_id, due_on, reset_at)
       VALUES ($1, $2::date, now() - interval '1 year')`,
      [into.garageId, today()],
    );
  };

  const owner = async (request: APIRequestContext, into: typeof renewed) => {
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email: into.email,
        language: 'ro',
        name: `Proprietar ${stamp}`,
        password,
      },
      headers: { 'x-forwarded-for': `198.18.68.${(Date.now() + 3) % 250}` },
    });
    expect(signUp.status()).toBe(201);
    const account = await db.query<{ id: string }>(
      'SELECT id FROM account WHERE email = $1',
      [into.email],
    );
    const accountId = account.rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO account_role (account_id, role) VALUES ($1, 'garage')
       ON CONFLICT DO NOTHING`,
      [accountId],
    );
    await db.query(`UPDATE account SET last_role = 'garage' WHERE id = $1`, [
      accountId,
    ]);
    await db.query(
      `INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'owner')`,
      [into.garageId, accountId],
    );
  };

  const signInAt = async (page: Page, email: string, width: number) => {
    await page.setViewportSize({ height: 800, width });
    await ready(page, '/ro/garages');
    await openSignIn(page);
    await signIn(page, email, { password });
    await expect(page).toHaveURL('/app/garage');
  };

  // The queue lists yearly documents by their oldest upload: an upload of
  // the distant past heads it, ahead of every other spec's rows.
  const headTheQueue = (fileId: string) =>
    db.query(
      `UPDATE legal_document SET created_at = '2000-01-01T08:00:00Z'
       WHERE verification_file_id = $1 AND status = 'in_review'`,
      [fileId],
    );

  test.beforeAll(async ({ request }) => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    await garage(renewed, 'anual');
    await garage(refused, 'anual-refuz');
    await owner(request, renewed);
    await owner(request, refused);
  });

  test.afterAll(async () => {
    const files = [renewed.fileId, refused.fileId];
    await db.query('DELETE FROM outbox_event WHERE subject_id = ANY($1)', [
      [...files, renewed.garageId, refused.garageId],
    ]);
    await db.query('DELETE FROM account WHERE email = ANY($1)', [
      [renewed.email, refused.email],
    ]);
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [
      [renewed.garageId, refused.garageId],
    ]);
    await db.end();
  });

  test('the owner reads the amber row on a 390 px phone and uploads both documents', async ({
    page,
  }) => {
    test.slow();
    await signInAt(page, renewed.email, 390);

    await expect(documentsRow(page)).toHaveAttribute('data-lamp', 'amber');
    await expect(documentsRow(page)).toContainText(
      'de reîncărcat o dată pe an, până în',
    );
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    await documentsRow(page)
      .getByRole('button', { name: 'Încarcă documentele' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Încarcă documentele' });
    await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
    for (const kind of ['onrc_certificate', 'rar_authorisation']) {
      const area = dialog.locator(`.area[data-kind="${kind}"]`);
      await area
        .locator('input[type="file"]')
        .setInputFiles([pdf(`${kind}.pdf`)]);
      await expect(area.locator('li.page[data-status="ready"]')).toHaveCount(1);
      await area.getByLabel('Data emiterii').fill(localDate(2));
    }
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    const sent = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        new URL(res.url()).pathname ===
          `/api/v1/garages/${renewed.garageId}/legal-documents`,
    );
    await dialog.getByRole('button', { name: 'Trimite documentele' }).click();
    expect((await sent).status()).toBe(201);
    await expect(dialog).toHaveCount(0);

    await expect(documentsRow(page)).toContainText('în verificare');
    await expect(documentsRow(page)).toHaveAttribute('data-lamp', 'amber');
    await expect(
      documentsRow(page).getByRole('button', { name: 'Încarcă documentele' }),
    ).toHaveCount(0);
  });

  test('an admin finds the garage as Documente anuale in the queue and accepts both from the drawer', async ({
    page,
  }) => {
    await headTheQueue(renewed.fileId);
    await signInAsAdmin2(page);
    await page.goto('/app/admin/garages');
    const row = page.locator('li.row').filter({ hasText: renewed.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Documente anuale');
    await row.getByRole('link').click();
    await expect(page).toHaveURL(
      `/app/admin/garages/${renewed.fileId}#documents`,
    );

    for (const kind of ['onrc_certificate', 'rar_authorisation']) {
      const accept = drawerDocument(page, kind).locator('[data-part="accept"]');
      await expect(accept).toBeEnabled();
      await accept.click();
      await expect(accept).toHaveCount(0);
    }
    expect(await sideways(page)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect(
      page.locator('li.row').filter({ hasText: renewed.name }),
    ).toHaveCount(0);
  });

  test('the owner reads the row green with next year’s month on a 320 px phone', async ({
    page,
  }) => {
    const [year, month] = today().split('-');
    const due = `${MONTHS[Number(month) - 1]} ${Number(year) + 1}`;
    await signInAt(page, renewed.email, 320);

    await expect(documentsRow(page)).toHaveAttribute('data-lamp', 'green');
    await expect(documentsRow(page)).toContainText(
      `de reîncărcat o dată pe an, până în ${due}`,
    );
    await expect(documentsRow(page)).toContainText('în regulă');
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('an admin refuses an upload with a note, and its owner reads the note on a red row', async ({
    browser,
    page,
  }) => {
    await db.query(
      `INSERT INTO legal_document (verification_file_id, kind, pages, status, issued_on)
       VALUES ($1::uuid, 'onrc_certificate', ARRAY['legal_document/' || $1::text || '/e2e-new-1'], 'in_review', CURRENT_DATE)`,
      [refused.fileId],
    );
    await headTheQueue(refused.fileId);
    await signInAsAdmin2(page);
    await page.goto(`/app/admin/garages/${refused.fileId}#documents`);

    await drawerDocument(page, 'onrc_certificate')
      .locator('[data-part="refuse"]')
      .click();
    const dialog = page.getByRole('dialog', { name: 'Refuză documentul' });
    await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
    await dialog.getByLabel('Documente necorespunzătoare').check();
    await dialog.getByLabel('Mesaj pentru service').fill(NOTE);
    await dialog.getByRole('button', { exact: true, name: 'Refuză' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(drawerDocument(page, 'onrc_certificate')).toContainText(
      `Motiv: Documente necorespunzătoare — ${NOTE}`,
    );

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAt(ownerPage, refused.email, 1280);
    await expect(documentsRow(ownerPage)).toHaveAttribute('data-lamp', 'red');
    await expect(documentsRow(ownerPage)).toContainText(`refuzat: ${NOTE}`);
    await expect(
      documentsRow(ownerPage).getByRole('button', {
        name: 'Încarcă documentele',
      }),
    ).toBeVisible();
    await ownerContext.close();
  });
});

import { randomUUID } from 'node:crypto';

import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

async function signInAsAdmin(page: Page) {
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
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const drawer = (page: Page) => page.locator('mf-verification-file');
const manual = (page: Page, kind: string) =>
  drawer(page).locator(`li.manual[data-kind="${kind}"]`);
const MANUAL = ['address', 'photos', 'representative', 'documents'];
const register = (page: Page, kind: string) =>
  drawer(page).locator(`[data-section="register"] li[data-kind="${kind}"]`);

// Each document opens in a new tab at its signed address.
async function openDocuments(page: Page) {
  const buttons = drawer(page).locator(
    '[data-section="documents"] button.action',
  );
  await expect(buttons).toHaveCount(2);
  for (const [n, kind] of [
    [0, 'onrc_certificate'],
    [1, 'rar_authorisation'],
  ] as const) {
    // The page is a PDF, which the browser takes as a download: the request
    // the new tab makes is the evidence, not where the tab lands.
    const [tab, request] = await Promise.all([
      page.waitForEvent('popup'),
      page.context().waitForEvent('request', (r) => {
        const url = new URL(r.url());
        return (
          url.pathname.includes(`e2e-${kind}-1`) &&
          url.searchParams.has('X-Amz-Signature')
        );
      }),
      buttons.nth(n).click(),
    ]);
    expect(request.url()).toContain(`e2e-${kind}-1`);
    await tab.close();
  }
}

// The four manual ticks hold after a reload.
async function tickAll(page: Page, name: string) {
  for (const kind of MANUAL) {
    const box = manual(page, kind).locator('input[type="checkbox"]');
    await expect(box).toBeEnabled();
    // The tick shows only from the server's answer: click, then wait for it.
    await box.click();
    await expect(box).toBeChecked();
    await expect(box).not.toHaveAttribute('aria-busy', 'true');
  }
  await page.reload();
  await expect(drawer(page).locator('h3')).toHaveText(name);
  for (const kind of MANUAL) {
    await expect(
      manual(page, kind).locator('input[type="checkbox"]'),
    ).toBeChecked();
  }
}

// A one-page PDF: enough for the store to answer its type.
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

// No endpoint sends a file with its documents yet, so the test leaves what a
// sending would: a garage, its submitted file with its 8 checks, an ONRC
// certificate and a RAR authorisation, their pages in the bucket.
// @traces 302-FR-003 302-FR-004 302-FR-005 302-FR-006 302-FR-007 302-FR-008 302-FR-011 203-FR-008
test.describe('the verification file @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'] || !process.env['STORAGE_BUCKET'],
    'seeds rows in PostgreSQL and pages in the bucket, which needs DATABASE_URL and STORAGE_*',
  );

  const bucket = process.env['STORAGE_BUCKET'] ?? '';
  let db: Client;
  let s3: S3Client;
  let garageId: string;
  let fileId: string;
  let name: string;
  let keys: string[] = [];

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    s3 = new S3Client({
      credentials: {
        accessKeyId: process.env['STORAGE_ACCESS_KEY_ID'] ?? '',
        secretAccessKey: process.env['STORAGE_SECRET_ACCESS_KEY'] ?? '',
      },
      endpoint: process.env['STORAGE_ENDPOINT'],
      forcePathStyle: true,
      region: process.env['STORAGE_REGION'],
    });
  });

  test.beforeEach(async () => {
    garageId = randomUUID();
    name = `Dosar Test ${garageId.slice(0, 8)}`;
    await db.query(
      `INSERT INTO garage (id, name, slug, city_key, city_name, business_kind, address, phone, cui)
       VALUES ($1, $2, $3, 'bucuresti', 'București', 'company', 'Str. Fabricii 12, București', '+40712345678', '1234567897')`,
      [garageId, name, `dosar-${garageId}`],
    );
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO verification_file (id, garage_id, status)
       VALUES (gen_random_uuid(), $1, 'submitted') RETURNING id::text`,
      [garageId],
    );
    fileId = rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind)
       SELECT gen_random_uuid(), $1, kind
       FROM unnest(enum_range(NULL::verification_check_kind)) AS kind`,
      [fileId],
    );
    keys = [];
    for (const kind of ['onrc_certificate', 'rar_authorisation']) {
      const key = `legal_document/${fileId}/e2e-${kind}-1`;
      keys.push(key);
      await s3.send(
        new PutObjectCommand({
          Body: PDF,
          Bucket: bucket,
          ContentType: 'application/pdf',
          Key: key,
        }),
      );
      await db.query(
        `INSERT INTO legal_document (verification_file_id, kind, pages, issued_on)
         VALUES ($1, $2, $3, current_date)`,
        [fileId, kind, [key]],
      );
    }
  });

  test.afterEach(async () => {
    await db.query('DELETE FROM outbox_event WHERE subject_id = $1', [fileId]);
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
  });

  test.afterAll(async () => {
    await db.end();
    s3.destroy();
  });

  for (const width of [undefined, 320]) {
    test(`opens the file from the queue, its documents, ticks and a problem${width ? ` at ${width} px` : ''}`, async ({
      page,
    }) => {
      if (width) await page.setViewportSize({ height: 640, width });
      await signInAsAdmin(page);
      await page.goto('/app/admin/garages');

      // The row opens the drawer at the file's address, and
      // the opening moves the file to in_review.
      const row = page.locator('mf-admin-queue li.row', { hasText: name });
      await row.locator('a.open').click();
      await expect(page).toHaveURL(`/app/admin/garages/${fileId}`);
      await expect(drawer(page).locator('h3')).toHaveText(name);
      await expect
        .poll(async () => {
          const { rows } = await db.query<{ status: string }>(
            'SELECT status::text FROM verification_file WHERE id = $1',
            [fileId],
          );
          return rows[0]?.status;
        })
        .toBe('in_review');
      const order = await drawer(page)
        .locator('[data-section]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
      expect(order.filter((s) => s !== 'reported' && s !== 'rejected')).toEqual(
        ['header', 'register', 'documents', 'manual', 'history', 'footer'],
      );

      await openDocuments(page);

      // The four manual ticks hold after a reload.
      await tickAll(page, name);

      // A problem on the phone check, with its detail.
      const detail = `Nu răspunde ${garageId.slice(0, 4)}`;
      await manual(page, 'representative')
        .getByRole('button', { name: /^Marchează o problemă: / })
        .click();
      const dialog = page.locator('mf-verification-problem');
      await dialog.getByLabel('Problemă', { exact: true }).check();
      await dialog.locator('textarea').fill(detail);
      await dialog.getByRole('button', { name: 'Salvează' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(manual(page, 'representative')).toContainText(detail);
      await expect(
        manual(page, 'representative').locator('mf-lamp'),
      ).toHaveAttribute('data-state', 'red');

      // No sideways scroll with the drawer open.
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      // Closing returns to the list, whose row names the problem.
      await page.keyboard.press('Escape');
      await expect(drawer(page)).toHaveCount(0);
      await expect(page).toHaveURL('/app/admin/garages');
      await expect(row.locator('mf-lamp')).toHaveAttribute(
        'data-state',
        'red',
        { timeout: 15_000 },
      );
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  test('records the company and its CAEN code by hand', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/app/admin/garages/${fileId}`);
    await expect(drawer(page).locator('h3')).toHaveText(name);

    // The company: OK with the name the register shows.
    const company = register(page, 'company');
    await company.getByRole('button', { name: 'Înregistrează' }).click();
    const companyForm = company.locator('mf-verification-register-form');
    await companyForm.getByRole('button', { exact: true, name: 'OK' }).click();
    await companyForm
      .getByLabel('Denumirea firmei')
      .fill('Auto Vest Motors SRL');
    await companyForm.getByRole('button', { name: 'Salvează' }).click();
    await expect(companyForm).toHaveCount(0);
    await expect(company).toContainText('CUI valid · Auto Vest Motors SRL');
    await expect(company.locator('mf-lamp')).toHaveAttribute(
      'data-state',
      'green',
    );

    // Its CAEN code: OK with the three ticks.
    const caen = register(page, 'caen');
    await caen.getByRole('button', { name: 'Înregistrează' }).click();
    const caenForm = caen.locator('mf-verification-register-form');
    await caenForm.getByRole('button', { exact: true, name: 'OK' }).click();
    for (const tick of [
      '4520 pe certificat',
      '4520 în ONRC',
      'la punctul de lucru',
    ])
      await caenForm.getByLabel(tick).check();
    await caenForm.getByRole('button', { name: 'Salvează' }).click();
    await expect(caenForm).toHaveCount(0);
    await expect(caen).toContainText(
      'Întreținerea și repararea autovehiculelor, la punctul de lucru',
    );
    await expect(caen).toContainText('certificat · ONRC · adresă');
    await expect(caen.locator('mf-lamp')).toHaveAttribute(
      'data-state',
      'green',
    );

    // Both hold after a reload, and the queue line reads the company check.
    await page.reload();
    await expect(register(page, 'company').locator('mf-lamp')).toHaveAttribute(
      'data-state',
      'green',
    );
    await page.goto('/app/admin/garages');
    await expect(
      page.locator('mf-admin-queue li.row', { hasText: name }),
    ).toContainText('CUI verificat', { timeout: 15_000 });
  });
});

import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ownAddress, ownMap, signInAsAdmin2 } from './accounts.js';
import { test } from './fixtures.js';
import { KEPT } from './listing-kept.js';
import {
  answerSurvey,
  confirmation,
  fillListing,
  signUp,
  unique,
} from './listing-send.js';

test.beforeEach(({ context }) => ownMap(context));

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// The listing form's steps.
const brandsStep = (page: Page) => page.locator('mf-brands-step');
const hoursStep = (page: Page) => page.locator('mf-hours-step');
const brandChip = (page: Page, name: string) =>
  brandsStep(page).locator('.chips > li > button', { hasText: name }).first();
const fuel = (page: Page, name: string) =>
  brandsStep(page)
    .locator('.fuels button')
    .and(page.getByRole('button', { name }));
const select = (page: Page, name: string) =>
  hoursStep(page).locator(`select[name="${name}"]`);
const payment = (page: Page, name: string) =>
  hoursStep(page).locator('.payments button', { hasText: name });

// The admin's drawer.
const drawer = (page: Page) => page.locator('mf-verification-file');
const footer = (page: Page) => drawer(page).locator('[data-section="footer"]');

// The profile's sections.
const brands = (page: Page) => page.locator('section[data-slot="brands"]');
const where = (page: Page) => page.locator('section[data-slot="where"]');

// The browser copy is written a moment after the last change.
async function kept(page: Page, text: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (wanted) =>
          Object.keys(localStorage).some((key) =>
            (localStorage.getItem(key) ?? '').includes(wanted),
          ),
        text,
      ),
    )
    .toBe(true);
}

// A garage listed through the form, BMW taken first as fillListing does, then
// Dacia taken without electric, Tesla refused, a paid courtesy car, card
// payment and its own week; sent, approved in the admin's drawer, and read on
// its public profile. The stance change goes out through the outbox as the
// listing's own edits do.
// @traces 308-FR-014 308-FR-015 308-FR-016
test.describe('the brands, facilities and hours on a public profile @seeded @database', () => {
  test.describe.configure({ mode: 'serial' });
  const name = `Service Detalii ${unique()}`;
  let db: Client;
  let email: string;
  let fileId: string | undefined;
  let id: string | undefined;
  let slug: string;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    if (fileId)
      await db.query('DELETE FROM outbox_event WHERE subject_id = $1', [
        fileId,
      ]);
    if (id) {
      await db.query('DELETE FROM outbox_event WHERE subject_id = $1', [id]);
      await db.query('DELETE FROM garage WHERE id = $1', [id]);
    }
    if (email) await db.query('DELETE FROM account WHERE email = $1', [email]);
    await db.end();
  });

  test('lists the garage through the form, sends it and has it approved', async ({
    browser,
    context,
    page,
  }) => {
    // A send, a sign-up and an admin's approval in a second browser.
    test.slow();
    await ownAddress(page, '198.18.8');
    await fillListing(context, page, name);
    email = await page.getByLabel('E‑mail').inputValue();

    await brandChip(page, 'Dacia').click();
    await expect(brandChip(page, 'Dacia')).toHaveText(/lucrezi pe ea/);
    await fuel(page, 'Dacia, Electric').click();
    await expect(fuel(page, 'Dacia, Electric')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await brandChip(page, 'Tesla').click();
    await brandChip(page, 'Tesla').click();
    await expect(brandChip(page, 'Tesla')).toHaveText(/nu o primești/);

    await select(page, 'weekdays-open').selectOption('08:30');
    await select(page, 'weekdays-close').selectOption('18:00');
    await hoursStep(page)
      .locator('input[type="checkbox"][name="sat-closed"]')
      .uncheck();
    await select(page, 'sat-open').selectOption('09:00');
    await select(page, 'sat-close').selectOption('13:00');
    // The kept listing pays in cash; this garage takes cards only.
    await payment(page, 'Numerar').click();
    await payment(page, 'Card').click();
    await hoursStep(page)
      .locator('.facilities button', { hasText: 'Mașină la schimb' })
      .click();
    await hoursStep(page).getByRole('radio', { name: 'Contra cost' }).check();
    await hoursStep(page).locator('input[name="courtesyPrice"]').fill('150');
    await kept(page, '"pricePerDayBani":15000');

    await page.locator('.actions .send').click();
    await expect(confirmation(page).locator('.complete')).toBeVisible();
    await answerSurvey(page);
    await signUp(page, email);

    const { rows } = await db.query<{ file: string; garage: string }>(
      `SELECT f.id::text AS file, g.id::text AS garage
       FROM garage g JOIN verification_file f ON f.garage_id = g.id
       WHERE g.name = $1`,
      [name],
    );
    id = rows[0]?.garage;
    fileId = rows[0]?.file;
    expect(fileId).toBeTruthy();

    const admin = await browser.newContext();
    try {
      const desk = await admin.newPage();
      await signInAsAdmin2(desk);
      await desk.goto(`/app/admin/garages/${fileId}`);
      await expect(drawer(desk).locator('h3')).toHaveText(name);
      // Every check passed and the two documents there, as the approval needs.
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

    const garage = await db.query<{ slug: string }>(
      'SELECT slug FROM garage WHERE id = $1',
      [id],
    );
    slug = garage.rows[0]?.slug ?? '';
    await expect
      .poll(
        async () =>
          (await page.request.get(`/api/v1/garages/${slug}`)).status(),
        { message: 'the approved garage is not public', timeout: 15_000 },
      )
      .toBe(200);
  });

  for (const width of [320, 1280]) {
    test(`shows what was entered, in Romanian and in English, at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 900, width });
      await page.goto(`/ro/garages/${slug}`);

      await expect(brands(page)).toContainText('Lucrează pe');
      await expect(brands(page).locator('.works li')).toHaveText([
        /BMW/,
        /Dacia/,
      ]);
      await expect(
        brands(page).locator('.works li', { hasText: 'Dacia' }),
      ).toContainText('benzină · motorină · hibrid');
      await expect(brands(page)).toContainText('Nu lucrează pe');
      await expect(brands(page).locator('.refuses li')).toHaveText([/Tesla/]);
      await expect(brands(page)).toContainText(
        'Mașină la schimb · 150 lei / zi',
      );
      await expect(brands(page)).toContainText('Plată: card');
      await expect(where(page)).toContainText(
        KEPT.data.steps['5'].place.address,
      );
      await expect(where(page)).toContainText('Luni – vineri');
      await expect(where(page)).toContainText('08:30 – 18:00');
      await expect(where(page)).toContainText('Sâmbătă');
      await expect(where(page)).toContainText('09:00 – 13:00');
      await expect(where(page)).toContainText('Duminică');
      await expect(where(page)).toContainText('Închis');
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      await page.goto(`/en/garages/${slug}`);
      await expect(brands(page)).toContainText('Works on');
      await expect(brands(page)).toContainText('Does not work on');
      await expect(brands(page).locator('.works li')).toHaveText([
        /BMW/,
        /Dacia/,
      ]);
      await expect(brands(page).locator('.refuses li')).toHaveText([/Tesla/]);
      await expect(brands(page)).toContainText('Courtesy car · 150 lei / day');
      await expect(brands(page)).toContainText('Payment: card');
      await expect(where(page)).toContainText(
        KEPT.data.steps['5'].place.address,
      );
      await expect(where(page)).toContainText('Monday – Friday');
      await expect(where(page)).toContainText('08:30 – 18:00');
      await expect(where(page)).toContainText('Closed');
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  test('shows a brand the garage stops taking without reloading the page', async ({
    page,
  }) => {
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto(`/ro/garages/${slug}`);
    await expect(brands(page).locator('.works li')).toHaveCount(2);
    await stream;
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    // A refused brand keeps no fuels, as the listing's own write leaves it.
    await db.query('BEGIN');
    await db.query(
      `UPDATE garage_brand SET stance = 'does_not_take', petrol = false,
         diesel = false, hybrid = false, electric = false, updated_at = now()
        WHERE garage_id = $1 AND brand_id = (SELECT id FROM brand WHERE key = 'dacia')`,
      [id],
    );
    await db.query(
      `INSERT INTO outbox_event (kind, subject_id, audience)
       VALUES ('garage.updated', $1, $2)`,
      [id, [`garage:${id}`, `public:garage:${id}`]],
    );
    await db.query('COMMIT');

    await expect(brands(page).locator('.refuses li')).toHaveText(
      [/Dacia/, /Tesla/],
      { timeout: 15_000 },
    );
    await expect(brands(page).locator('.works li')).toHaveText([/BMW/]);
    expect(navigations).toBe(0);
  });
});

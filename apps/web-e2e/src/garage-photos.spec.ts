import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import sharp from 'sharp';

import { hydrated } from './accounts.js';
import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const section = (page: Page) => page.locator('section[data-slot="photos"]');
const tiles = (page: Page) => section(page).locator('button.tile');
const view = (page: Page) => page.getByRole('dialog');
// The dark the view draws: the dialog container around it, fixed to the
// screen, can have no box of its own.
const backdrop = (page: Page) =>
  view(page).locator('[data-slot="viewer-backdrop"]');
const insideView = (page: Page) =>
  page.evaluate(
    () =>
      !!document.activeElement?.closest('[role="dialog"]') ||
      !!document.activeElement?.closest('.cdk-overlay-container'),
  );

const jpeg = (side: number, hue: number) =>
  sharp({
    create: {
      background: { b: 40, g: hue, r: 200 - hue },
      channels: 3,
      height: Math.round(side * 0.75),
      width: side,
    },
  })
    .jpeg()
    .toBuffer();

// Seeds a garage with three processed photos: rows straight into PostgreSQL,
// their copies straight into the bucket, as the worker would leave them.
// @traces 310-FR-006 310-FR-007 310-FR-008 310-FR-010 310-FR-011 310-FR-012
test.describe('the photos of a garage profile @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'] || !process.env['STORAGE_BUCKET'],
    'seeds rows in PostgreSQL and copies in the bucket, which needs DATABASE_URL and STORAGE_*',
  );
  test.describe.configure({ mode: 'serial' });

  const slug = `e2e-poze-${Date.now().toString(36)}`;
  const bucket = process.env['STORAGE_BUCKET'] ?? '';
  const keys: string[] = [];
  let garageId: string;
  let db: Client;
  let s3: S3Client;

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
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at)
       VALUES (gen_random_uuid(), 'Atelier Foto E2E', $1, 'approved', now())
       RETURNING id`,
      [slug],
    );
    garageId = rows[0]?.id ?? '';
    for (const position of [0, 1, 2]) {
      const key = `garage_photo/${garageId}/e2e-${position}`;
      keys.push(key);
      for (const [copy, side] of [
        ['thumb', 400],
        ['display', 1600],
      ] as const) {
        await s3.send(
          new PutObjectCommand({
            Body: await jpeg(side, position * 60),
            Bucket: bucket,
            ContentType: 'image/jpeg',
            Key: `${key}.${copy}`,
          }),
        );
      }
      await db.query(
        `INSERT INTO garage_photo (garage_id, file_key, position, width, height)
         VALUES ($1, $2, $3, 1600, 1200)`,
        [garageId, key, position],
      );
    }
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE slug = $1', [slug]);
    await db.end();
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: keys.flatMap((key) => [
            { Key: `${key}.thumb` },
            { Key: `${key}.display` },
          ]),
        },
      }),
    );
    s3.destroy();
  });

  test('opens, moves and closes the view from the keyboard, back on the tile at the same scroll', async ({
    page,
  }) => {
    await hydrated(page, `/ro/garages/${slug}`);
    await expect(tiles(page)).toHaveCount(3);
    await tiles(page).nth(1).scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => window.scrollY);

    await tiles(page).nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(view(page)).toContainText('2 / 3');
    await page.keyboard.press('ArrowRight');
    await expect(view(page)).toContainText('3 / 3');
    await page.keyboard.press('Escape');

    await expect(view(page)).toHaveCount(0);
    await expect(tiles(page).nth(1)).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  });

  test('keeps Tab inside the open view', async ({ page }) => {
    await hydrated(page, `/ro/garages/${slug}`);
    await tiles(page).first().click();
    await expect(backdrop(page)).toBeVisible();

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await insideView(page)).toBe(true);
    }
  });

  test('moves between photos with a swipe on a phone', async ({ page }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    await hydrated(page, `/ro/garages/${slug}`);
    await tiles(page).first().click();
    await expect(view(page)).toContainText('1 / 3');
    const photo = view(page).locator('img');
    const box = await photo.boundingBox();
    if (!box) throw new Error('the photo has no box');
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, y + 5);
    await page.mouse.up();
    await expect(view(page)).toContainText('2 / 3');

    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, y - 5);
    await page.mouse.up();
    await expect(view(page)).toContainText('1 / 3');
  });

  test('holds every tile in place while its image arrives', async ({
    page,
  }) => {
    const held: (() => Promise<void>)[] = [];
    await page.route(
      (url) => /\.(thumb|display)$/.test(url.pathname),
      (route) => {
        held.push(() => route.continue());
      },
    );
    await hydrated(page, `/ro/garages/${slug}`);
    await expect(tiles(page)).toHaveCount(3);
    const before = await tiles(page).evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().toJSON()),
    );

    await expect.poll(() => held.length).toBeGreaterThan(0);
    await page.unroute((url) => /\.(thumb|display)$/.test(url.pathname));
    for (const release of held) await release();
    await expect(tiles(page).first()).toHaveAttribute('data-loaded', 'true');
    const after = await tiles(page).evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().toJSON()),
    );

    expect(after).toEqual(before);
  });

  test('names the photos in Romanian and in English', async ({ page }) => {
    await hydrated(page, `/ro/garages/${slug}`);
    await expect(section(page)).toHaveAttribute('aria-label', 'Fotografii');
    await expect(tiles(page).nth(1).locator('img')).toHaveAttribute(
      'alt',
      'Fotografie 2 din 3 · Atelier Foto E2E',
    );

    await hydrated(page, `/en/garages/${slug}`);
    await expect(section(page)).toHaveAttribute('aria-label', 'Photos');
    await tiles(page).nth(1).click();
    await expect(view(page).locator('img')).toHaveAttribute(
      'alt',
      'Photo 2 of 3 · Atelier Foto E2E',
    );
  });

  test('never scrolls sideways on a 320 px phone, with the view shut or open', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await hydrated(page, `/ro/garages/${slug}`);
    await expect(tiles(page)).toHaveCount(3);
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    await tiles(page).first().click();
    await expect(backdrop(page)).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('keeps the view within the list when the photo it shows is deleted', async ({
    page,
  }) => {
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await hydrated(page, `/ro/garages/${slug}`);
    await stream;
    await tiles(page).nth(2).click();
    await expect(view(page)).toContainText('3 / 3');

    await db.query('BEGIN');
    await db.query('DELETE FROM garage_photo WHERE file_key = $1', [keys[2]]);
    await db.query(
      `INSERT INTO outbox_event (kind, subject_id, audience)
       VALUES ('garage.updated', $1, $2)`,
      [garageId, [`garage:${garageId}`, `public:garage:${garageId}`]],
    );
    await db.query('COMMIT');

    await expect(view(page)).toContainText('2 / 2', { timeout: 15_000 });
    await expect(tiles(page)).toHaveCount(2);
  });
});

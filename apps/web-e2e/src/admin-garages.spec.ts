import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { accessToken } from './platform-rules.js';

// The seeded admin reads the "Service-uri" view: the counts line, then the
// suspended garages under the queue. A garage of this file's own is suspended
// through the real route from a second context, as suspending a seeded one
// (the seeded Atelier Dinamo) would take it from every spec running beside this one; the
// line and the panel move without a reload. A deployed address, whose run has
// no DATABASE_URL, skips the file.
// @traces 066-FR-006 066-FR-007 066-FR-008 066-FR-011
// How far a line's text starts from the view title's text, in px: the counts
// line under the title starts where the title and the cards' text start.
const offTitle = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const textLeft = (el: Element | null) => {
      if (!el) return Number.NaN;
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getClientRects()[0]?.left ?? Number.NaN;
    };
    return Math.abs(
      textLeft(document.querySelector(sel)) -
        textLeft(document.querySelector('header h1')),
    );
  }, selector);

test.describe('the suspended garages @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its garage straight to PostgreSQL, which needs DATABASE_URL',
  );

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';
  const COUNTS =
    /^\d{1,3}(\.\d{3})* (de )?listat[e]? · \d{1,3}(\.\d{3})* de verificat · \d{1,3}(\.\d{3})* (de )?suspendat[e]?$/;
  let db: Client;
  const garageIds: string[] = [];

  const counts = (page: Page) => page.locator('mf-admin-garages .counts');
  const panel = (page: Page) => page.locator('mf-admin-suspended');
  const suspended = async (page: Page) =>
    Number(
      (await counts(page).textContent())?.split('·')[2]?.replace(/\D/g, '') ??
        Number.NaN,
    );
  const sideways = (page: Page) =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

  const signInAsAdmin = async (page: Page) => {
    await ready(page, '/ro/garages');
    if ((page.viewportSize()?.width ?? 1280) < 768) {
      await page
        .getByRole('navigation', { name: 'Navigare principală' })
        .getByRole('link', { name: 'Cont' })
        .click();
    } else {
      await page
        .getByRole('button', { exact: true, name: 'Autentificare' })
        .click();
    }
    await signIn(page, ACCOUNTS.admin);
    await expect(page).toHaveURL('/app/admin');
  };

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [garageIds]);
    await db.end();
  });

  for (const [device, width, height] of [
    ['a 320 px phone', 320, 640],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`shows the counts and a garage suspended in another session without a reload on ${device}`, async ({
      page,
      request,
    }) => {
      const name = `Atelier Dinamo ${stamp} ${width}`;
      const made = await db.query<{ id: string }>(
        `INSERT INTO garage (id, name, slug, status, approved_at, city_name)
         VALUES (gen_random_uuid(), $1, $2, 'approved', now(), 'Pantelimon') RETURNING id`,
        [name, `e2e-oprit-${stamp}-${width}`],
      );
      const id = made.rows[0]?.id ?? '';
      garageIds.push(id);

      await page.setViewportSize({ height, width });
      await signInAsAdmin(page);
      await page.goto('/app/admin/garages');
      await expect(counts(page)).toHaveText(COUNTS);
      await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
        /^Service‑uri suspendate · \d+/,
      );
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(
        await offTitle(page, 'mf-admin-garages .counts'),
      ).toBeLessThanOrEqual(1);
      const before = await suspended(page);
      let navigations = 0;
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations++;
      });

      const res = await request.post(`/api/v1/admin/garages/${id}/suspend`, {
        data: { cause: 'recheck_failed', reason: REASON },
        headers: { Authorization: `Bearer ${await accessToken(request)}` },
      });
      expect(res.status()).toBe(200);

      const row = panel(page).locator('li.row').filter({ hasText: name });
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      await expect(row.locator('.state')).toHaveText(
        'suspendat · autorizație RAR expirată',
      );
      await expect(row.locator('.reason')).toHaveText(REASON);
      await expect
        .poll(() => suspended(page), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(before + 1);
      expect(navigations).toBe(0);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});

import { randomUUID } from 'node:crypto';

import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// The panel's h2 keeps the template's spaces around its text.
const HEADING = /^\s*Service‑uri de verificat · (\d+)\s*$/;

async function signInAsAdmin(page: Page) {
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
}

const queue = (page: Page) => page.locator('mf-admin-queue');
const heading = (page: Page) => queue(page).locator('h2');
const counted = async (page: Page) =>
  Number(HEADING.exec((await heading(page).textContent())?.trim() ?? '')?.[1]);
// The dashboard menu: the side menu from a tablet up, the tab bar on a phone.
const menu = (page: Page) =>
  (page.viewportSize()?.width ?? 1280) < 768
    ? page.locator('mf-dashboard-tab-bar nav')
    : page.locator('aside nav');
const chip = (page: Page) =>
  menu(page).locator('a[href="/app/admin/garages"] .chip');
const line = (page: Page) => page.locator('.admin-line');
const LINE = /· (\d+) (?:de )?service/;
// The heading, the menu counter and the header line read the same number.
// Other workers send and decide files meanwhile, so each count is compared
// with the others at one moment, never with a number read earlier.
async function countsAgree(page: Page) {
  await expect
    .poll(
      async () => {
        const counter = Number((await chip(page).textContent())?.trim());
        const header = Number(
          LINE.exec((await line(page).textContent()) ?? '')?.[1],
        );
        const panel = await counted(page);
        return panel > 0 && panel === counter && counter === header;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// No endpoint sends a file yet, so the test records a sending as the
// verification service would: a new garage, its waiting file and the
// `verification.submitted` event; the relay carries it to the open queue.
// Every run that boots the stack has the database, so the flow needs
// DATABASE_URL.
test.describe('the verification queue @seeded', () => {
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
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
    garageId = undefined;
  });

  test.afterAll(async () => {
    await db.end();
  });

  // @traces 301-FR-001 301-FR-005 301-FR-006 301-FR-009 301-FR-013
  for (const width of [undefined, 320]) {
    test(`lists the waiting files oldest first and gains a new one without a reload${width ? ` at ${width} px` : ''}`, async ({
      page,
    }) => {
      if (width) await page.setViewportSize({ height: 640, width });
      await signInAsAdmin(page);
      await page.goto('/app/admin/garages');

      // The seed's two: Service Dobre sent a week ago and is flagged.
      const dobre = queue(page).locator('li.row', { hasText: 'Service Dobre' });
      await expect(dobre.locator('.waiting')).toHaveText(
        /^așteaptă de \d+ (de )?zile lucrătoare$/,
      );
      await expect(dobre.locator('mf-lamp')).toHaveAttribute(
        'data-state',
        'amber',
      );
      const names = await queue(page).locator('li.row .name').allTextContents();
      expect(names.indexOf('Service Dobre')).toBeLessThan(
        names.indexOf('Atelier Dinamo'),
      );

      await expect(heading(page)).toHaveText(HEADING);
      await countsAgree(page);

      garageId = randomUUID();
      const name = `Coada Test ${garageId.slice(0, 8)}`;
      await db.query(
        "INSERT INTO garage (id, name, slug, city_key, city_name) VALUES ($1, $2, $3, 'bucuresti', 'București')",
        [garageId, name, `coada-${garageId}`],
      );
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO verification_file (id, garage_id, status)
         VALUES (gen_random_uuid(), $1, 'submitted') RETURNING id::text`,
        [garageId],
      );
      const fileId = rows[0]?.id ?? '';
      await db.query(
        `INSERT INTO outbox_event (audience, kind, payload, subject_id)
         VALUES ($1, 'verification.submitted', $2, $3)`,
        [
          ['admin', `garage:${garageId}`],
          JSON.stringify({ fileId, garageId }),
          fileId,
        ],
      );

      const fresh = queue(page).locator('li.row', { hasText: name });
      await expect(fresh).toBeVisible({ timeout: 15_000 });
      await expect(fresh.locator('.area')).toHaveText(
        'București · 0 mărci · 0 mecanici',
      );
      await expect(fresh.locator('a.open')).toHaveAttribute(
        'href',
        `/app/admin/garages/${fileId}`,
      );
      // The four counts: the view's heading, the menu counter, the header
      // line and, one router step away with no reload, the overview's panel.
      await countsAgree(page);
      await expect(line(page)).toContainText('așteaptă verificarea');
      await menu(page).locator('a[href="/app/admin"]').click();
      await expect(page).toHaveURL('/app/admin');
      // The panel reads afresh here while the menu and the header keep the
      // shell's read, which other spec files' direct database writes (no
      // event) can leave behind: the panel shows the new file, and its count
      // agrees with the view's own, compared above.
      await expect(heading(page)).toHaveText(HEADING);
      await expect(
        queue(page).locator('li.row', { hasText: name }),
      ).toBeVisible();
      expect(await counted(page)).toBeGreaterThan(0);
    });
  }

  // @traces 301-FR-005 301-FR-012
  for (const width of [320, 834]) {
    test(`reads ${width} px wide with no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ height: 640, width });
      await signInAsAdmin(page);

      await expect(heading(page)).toHaveText(HEADING);
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      await page.goto('/app/admin/garages');
      await expect(
        queue(page).locator('li.row', { hasText: 'Service Dobre' }),
      ).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});

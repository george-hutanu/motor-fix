import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

// The seeded garages: Militari works on Dacia, Colentina does not, Titan has
// no brand rows, and Dinamo is still in review.
// @traces 307-FR-008 307-FR-010 307-FR-011 307-FR-012 307-FR-015 307-FR-016
test.describe('the public garage profile @seeded', () => {
  test('shows a verified garage that works on the brand in context, with the way back to that brand', async ({
    page,
  }) => {
    await page.goto('/ro/garages/service-auto-militari?brand=dacia');

    await expect(heading(page)).toHaveText(/Service Auto Militari/i);
    await expect(page.getByText('Lucrează pe Dacia')).toBeVisible();
    await expect(page.getByText(/Verificat/).first()).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Service‑uri pentru Dacia/ }),
    ).toHaveAttribute('href', '/ro/garages?brand=dacia');
  });

  test('says when a garage does not work on the brand in context', async ({
    page,
  }) => {
    await page.goto('/ro/garages/service-colentina?brand=dacia');

    // The lamp; the quote button's note under it says the same.
    await expect(
      page.locator('mf-lamp', { hasText: 'Nu lucrează pe Dacia' }),
    ).toBeVisible();
  });

  test('leads home and shows no lamp without a brand in context', async ({
    page,
  }) => {
    await page.goto('/ro/garages/service-titan');

    await expect(heading(page)).toHaveText(/Service Titan/i);
    await expect(page.getByRole('link', { name: 'Acasă' })).toHaveAttribute(
      'href',
      '/ro',
    );
    await expect(page.getByText(/Lucrează pe|Nu lucrează pe/)).toHaveCount(0);
  });

  test('answers 404 for a garage still in review', async ({ page }) => {
    const response = await page.goto('/ro/garages/atelier-dinamo');

    expect(response?.status()).toBe(404);
    await expect(heading(page)).toHaveText('Pagina nu există');
  });

  test('opens the same profile in English with the brand kept', async ({
    page,
  }) => {
    // The page holds its live stream open, so the network never goes idle;
    // the browser opening that stream says the client has taken over.
    const live = page.waitForRequest(/\/api\/v1\/live\/public\?/);
    await page.goto('/ro/garages/service-auto-militari?brand=dacia');
    await expect(page.getByText('Lucrează pe Dacia')).toBeVisible();
    await live;

    await page
      .getByRole('group', { name: 'Limba' })
      .getByRole('button', { name: 'EN' })
      .click();

    await expect(page).toHaveURL(
      /\/en\/garages\/service-auto-militari\?brand=dacia$/,
    );
    await expect(page.getByText('Works on Dacia')).toBeVisible();
  });

  test('never scrolls sideways on a 320 px phone, the account button standing in for the links', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto('/ro/garages/service-auto-militari?brand=dacia');
    await expect(heading(page)).toBeVisible();

    await expect(page.getByRole('button', { name: 'Cont' })).toBeVisible();
    await expect(
      page.getByRole('button', { exact: true, name: 'Autentificare' }),
    ).toBeHidden();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  for (const path of ['/ro', '/ro/garages/service-auto-militari']) {
    test(`fits the site bar's controls on one row inside the bar at 320 px on ${path}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 640, width: 320 });
      await page.goto(path);
      const bar = page.locator('mf-public-frame header.bar');
      await expect(bar).toBeVisible();

      const boxes = await bar.evaluate((header) => {
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { bottom: r.bottom, left: r.left, right: r.right, top: r.top };
        };
        return {
          bar: box(header),
          controls: [
            ...header.querySelectorAll(
              '.logo, mf-language-switch button, .account',
            ),
          ].map(box),
          languages: [
            ...header.querySelectorAll('mf-language-switch button'),
          ].map(box),
        };
      });
      expect(boxes.controls).toHaveLength(4);
      for (const c of boxes.controls) {
        expect(c.left).toBeGreaterThanOrEqual(0);
        expect(c.right).toBeLessThanOrEqual(320);
        expect(c.top).toBeGreaterThanOrEqual(boxes.bar.top);
        expect(c.bottom).toBeLessThanOrEqual(boxes.bar.bottom);
      }
      expect(boxes.languages[0]?.top).toBe(boxes.languages[1]?.top);
    });
  }

  test('keeps the public frame on the phone type floor and the 4 px grid', async ({
    page,
  }) => {
    await page.goto('/ro/garages/service-auto-militari');
    await expect(heading(page)).toBeVisible();

    const measure = () =>
      page.evaluate(() => {
        const css = (selector: string) =>
          [...document.querySelectorAll(selector)].map((el) =>
            getComputedStyle(el),
          );
        const px = (v: string) => Number.parseFloat(v);
        const offGrid = (s: CSSStyleDeclaration) =>
          [
            s.paddingTop,
            s.paddingRight,
            s.paddingBottom,
            s.paddingLeft,
            s.rowGap,
            s.columnGap,
          ]
            .map(px)
            .filter(
              (v) =>
                Number.isFinite(v) &&
                Math.abs(v / 4 - Math.round(v / 4)) > 0.01,
            );
        return {
          offGrid: [
            'mf-public-frame header.bar',
            'mf-garage-profile',
            'mf-garage-profile header.head',
            'mf-public-tab-bar nav',
            'mf-public-tab-bar nav a',
            'mf-language-switch button',
          ].flatMap((selector) => css(selector).flatMap(offGrid)),
          sizes: css(
            'mf-public-tab-bar nav a span, mf-language-switch button',
          ).map((s) => px(s.fontSize)),
        };
      });
    // A tablet lays the profile's header side by side; a phone shows the tab bar.
    await page.setViewportSize({ height: 1180, width: 820 });
    expect((await measure()).offGrid).toEqual([]);
    await page.setViewportSize({ height: 844, width: 390 });
    const measured = await measure();
    expect(measured.offGrid).toEqual([]);
    expect(measured.sizes.length).toBe(5);
    for (const size of measured.sizes) expect(size).toBeGreaterThanOrEqual(16);
  });
});

// A mobile mechanic of this file's own, written straight to PostgreSQL: it
// holds no brand rows, so no other spec's brand counts move while it lives.
// Its suspension commits with its event, as the admin's does, and the
// worker's relay carries it to the open page. No route suspends a garage yet,
// so a deployed address, which has no such database, leaves @database out.
// @traces 307-FR-013 307-FR-017 307-FR-018
test.describe('a mobile mechanic, then suspended @seeded @database', () => {
  test.describe.configure({ mode: 'serial' });
  const slug = `e2e-mobil-${Date.now().toString(36)}`;
  let db: Client;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    await db.query(
      `INSERT INTO garage (id, name, slug, status, approved_at, business_kind,
         service_radius_km, known_for)
       VALUES (gen_random_uuid(), 'Mecanic Mobil E2E', $1, 'approved', now(),
         'mobile', 25, 'Diagnoză la domiciliu')`,
      [slug],
    );
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE slug = $1', [slug]);
    await db.end();
  });

  test('shows a mobile mechanic with its area and no address', async ({
    page,
  }) => {
    await page.goto(`/ro/garages/${slug}`);

    await expect(heading(page)).toHaveText('Mecanic Mobil E2E');
    await expect(page.getByText('Mecanic mobil · zonă de 25 km')).toBeVisible();
    await expect(page.getByText('Diagnoză la domiciliu')).toBeVisible();
    await expect(page.getByText('Nicio recenzie încă').first()).toBeVisible();
  });

  test('turns into the no-longer-available view in place when the garage is suspended', async ({
    page,
  }) => {
    // The stream is open once its answer has come back: a request alone may
    // still be refused (the visitors' streams share one address here) and
    // retried after the event has gone out.
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto(`/ro/garages/${slug}`);
    await expect(heading(page)).toHaveText('Mecanic Mobil E2E');
    await stream;
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    await db.query('BEGIN');
    const { rows } = await db.query<{ id: string }>(
      `UPDATE garage SET status = 'suspended' WHERE slug = $1 RETURNING id`,
      [slug],
    );
    const id = rows[0]?.id;
    await db.query(
      `INSERT INTO outbox_event (kind, subject_id, audience)
       VALUES ('garage.suspended', $1, $2)`,
      [id, [`garage:${id}`, `public:garage:${id}`]],
    );
    await db.query('COMMIT');

    await expect(heading(page)).toHaveText(
      'Acest service nu mai este disponibil',
      { timeout: 15_000 },
    );
    expect(navigations).toBe(0);
    expect((await page.request.get(`/api/v1/garages/${slug}`)).status()).toBe(
      410,
    );
  });
});

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

    await expect(page.getByText('Nu lucrează pe Dacia')).toBeVisible();
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
    await page.goto('/ro/garages/service-auto-militari?brand=dacia');
    await expect(page.getByText('Lucrează pe Dacia')).toBeVisible();
    await page.waitForLoadState('networkidle');

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
});

// A mobile mechanic of this file's own, written straight to PostgreSQL: it
// holds no brand rows, so no other spec's brand counts move while it lives.
// Its suspension commits with its event, as the admin's does, and the
// worker's relay carries it to the open page.
// @traces 307-FR-013 307-FR-017 307-FR-018
test.describe('a mobile mechanic, then suspended @seeded', () => {
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
    const stream = page.waitForRequest('**/api/v1/live/public*');
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

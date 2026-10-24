import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

type Handed = { shared: unknown[]; copied: string[] };

// What the page hands the share menu and the clipboard, kept for the test to
// read: the real menu is the system's and cannot be driven.
const watchSharing = (page: Page, { menu }: { menu: boolean }) =>
  page.addInitScript((withMenu) => {
    const handed: Handed = { copied: [], shared: [] };
    Object.assign(window, { handed });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: withMenu
        ? (data: unknown) => {
            handed.shared.push(data);
            return Promise.resolve();
          }
        : undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          handed.copied.push(text);
          return Promise.resolve();
        },
      },
    });
  }, menu);

const handed = (page: Page) =>
  page.evaluate(() => (window as unknown as { handed: Handed }).handed);

// @traces 385-FR-001 385-FR-002 385-FR-003 385-FR-004
test.describe('sharing a garage profile @seeded', () => {
  test('opens the share menu with the garage and its address, brand and share marker', async ({
    page,
  }) => {
    await watchSharing(page, { menu: true });
    await page.goto('/ro/garages/service-auto-militari?brand=dacia');
    await expect(heading(page)).toHaveText(/Service Auto Militari/i);

    await page
      .getByRole('button', { name: 'Distribuie Service Auto Militari' })
      .click();

    await expect.poll(async () => (await handed(page)).shared).toHaveLength(1);
    const [data] = (await handed(page)).shared as {
      title: string;
      url: string;
    }[];
    expect(data?.title).toBe('Service Auto Militari');
    expect(new URL(data?.url ?? '').pathname).toBe(
      '/ro/garages/service-auto-militari',
    );
    expect(new URL(data?.url ?? '').search).toBe('?brand=dacia&src=share');
  });

  test('copies the address on a computer with no share menu, and says so', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await watchSharing(page, { menu: false });
    await page.goto('/en/garages/service-auto-militari');
    await expect(heading(page)).toHaveText(/Service Auto Militari/i);

    await page.getByRole('button', { name: /^Share / }).click();

    await expect(page.getByText('Link copied')).toBeVisible();
    const { copied } = await handed(page);
    expect(copied).toHaveLength(1);
    expect(new URL(copied[0] ?? '').pathname).toBe(
      '/en/garages/service-auto-militari',
    );
    expect(new URL(copied[0] ?? '').search).toBe('?src=share');
  });

  // @traces 385-FR-006 385-FR-007
  test('opens a shared link with the brand it was shared for, and a dead one on the not-found page', async ({
    page,
  }) => {
    await page.goto('/ro/garages/service-auto-militari?brand=dacia&src=share');
    await expect(heading(page)).toHaveText(/Service Auto Militari/i);
    await expect(page.getByText('Service‑uri pentru Dacia')).toBeVisible();

    const answer = await page.goto('/ro/garages/nu-exista-e2e?src=share');
    expect(answer?.status()).toBe(404);
    await expect(heading(page)).toHaveText('Pagina nu există');
  });

  test('fits a 320 px phone with the button beside the name', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto('/ro/garages/service-auto-militari?brand=dacia');

    const button = page.getByRole('button', {
      name: 'Distribuie Service Auto Militari',
    });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

// A garage of this file's own, next to Service Auto Militari and working on
// Dacia, written straight to PostgreSQL as suspended (the admin's suspension
// itself is the suspension spec's): suspending a seeded garage would take it
// from every other spec running beside this one. A deployed address, whose
// run has no DATABASE_URL, skips it, as the suspension spec does.
// @traces 385-FR-008 385-FR-009 385-FR-010 385-FR-011
test.describe('a shared link to a garage no longer listed @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its suspended garage straight to PostgreSQL, which needs DATABASE_URL',
  );
  const slug = `e2e-suspendat-${Date.now().toString(36)}`;
  let db: Client;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, latitude, longitude)
       VALUES (gen_random_uuid(), 'Service Suspendat E2E', $1, 'suspended', now(),
         44.436, 26.016)
       RETURNING id`,
      [slug],
    );
    await db.query(
      `INSERT INTO garage_brand (garage_id, brand_id, stance, updated_at)
       SELECT $1, id, 'works_on', now() FROM brand WHERE slug = 'dacia'`,
      [rows[0]?.id],
    );
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE slug = $1', [slug]);
    await db.end();
  });

  for (const viewport of [
    { height: 640, width: 320 },
    { height: 900, width: 1440 },
  ]) {
    test(`says the garage is gone and lists up to 3 similar garages nearby at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);

      const answer = await page.goto(
        `/ro/garages/${slug}?brand=dacia&src=share`,
      );

      expect(answer?.status()).toBe(410);
      await expect(heading(page)).toHaveText(
        'Acest service nu mai este disponibil pe MotorFix.',
      );
      await expect(
        page.getByText('Service‑uri similare în apropiere'),
      ).toBeVisible();
      const cards = page.locator('mf-gone li mf-result-card');
      await expect(cards.first()).toBeVisible();
      expect(await cards.count()).toBeLessThanOrEqual(3);
      await expect(page.getByText('Service Suspendat E2E')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /^Distribuie/ }),
      ).toHaveCount(0);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  test('answers the similar garages to a visitor, without the suspended one', async ({
    page,
  }) => {
    const res = await page.request.get(
      `/api/v1/garages/${slug}/similar?brand=dacia`,
    );

    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      brand: { slug: string };
      items: { slug: string }[];
    };
    expect(body.brand.slug).toBe('dacia');
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(3);
    expect(body.items.map((item) => item.slug)).not.toContain(slug);
  });
});

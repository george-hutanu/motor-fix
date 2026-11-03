// @traces 1425-FR-011 1425-FR-003 1425-FR-004 1425-FR-005 1425-FR-007
import { expect, type Locator, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

async function openAsAdmin(page: Page, path: string) {
  await ready(page, '/ro/garages');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { name: 'Cont' })
      .click();
  } else {
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
  }
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
  // Loaded afresh so the live stream's answer is the one awaited: an event
  // published before the stream opens is never seen.
  const live = page.waitForResponse((r) => r.url().endsWith('/api/v1/live'));
  await page.goto(path);
  expect((await live).status()).toBe(200);
}

// Maps slow since 10:40 today in Bucharest, freshly checked, announced to
// the admins; the panel follows within five seconds without a navigation.
async function slowMaps(db: Client, page: Page, panel: Locator) {
  let reloads = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) reloads++;
  });
  const { rows } = await db.query<{ at: Date }>(
    `INSERT INTO status_tile (key, state, since, detail, checked_at)
     VALUES ('maps', 'amber',
       (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest')
         + interval '10 hours 40 minutes') AT TIME ZONE 'Europe/Bucharest',
       '{"latency_ms":1900}', now())
     ON CONFLICT (key) DO UPDATE
       SET state = EXCLUDED.state, since = EXCLUDED.since,
           detail = EXCLUDED.detail, checked_at = EXCLUDED.checked_at,
           pending_state = NULL, pending_since = NULL
     RETURNING checked_at AS at`,
  );
  const redis = new Redis(process.env['REDIS_URL'] as string);
  try {
    await redis.publish(
      'live:events',
      JSON.stringify({
        audience: ['admin'],
        event: {
          at: rows[0].at.toISOString(),
          id: 'maps',
          kind: 'status_tile.changed',
        },
      }),
    );
  } finally {
    redis.disconnect();
  }

  const maps = panel.locator('ul.tiles > li[data-state]').nth(2);
  await expect(maps).toHaveAttribute('data-state', 'amber', {
    timeout: 5_000,
  });
  await expect(maps).toContainText('Hărți');
  await expect(maps).toContainText('degradat');
  await expect(maps).toContainText('lent · 1,9 s');
  await expect(panel).toContainText(
    'Hărțile răspund lent din 10:40. Căutarea după distanță poate întârzia.',
  );
  expect(reloads).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

type Row = {
  checked_at: Date;
  detail: unknown;
  pending_since: Date | null;
  pending_state: string | null;
  since: Date;
  state: string;
};

test.describe('the Starea sistemului panel @seeded @database', () => {
  // Writes a tile to PostgreSQL and announces it on Redis: the e2e job and the
  // PR QA run set DATABASE_URL and REDIS_URL.
  let db: Client;
  let before: Row | undefined;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const { rows } = await db.query<Row>(
      `SELECT state, since, detail, checked_at, pending_state, pending_since
         FROM status_tile WHERE key = 'maps'`,
    );
    before = rows[0];
  });

  // Each test starts from the row as the seed left it.
  test.afterEach(async () => {
    if (before) {
      await db.query(
        `UPDATE status_tile
            SET state = $1, since = $2, detail = $3, checked_at = $4,
                pending_state = $5, pending_since = $6
          WHERE key = 'maps'`,
        [
          before.state,
          before.since,
          JSON.stringify(before.detail),
          before.checked_at,
          before.pending_state,
          before.pending_since,
        ],
      );
    } else {
      await db.query(`DELETE FROM status_tile WHERE key = 'maps'`);
    }
  });

  test.afterAll(async () => {
    await db.end();
  });

  test('a slow Maps tile turns amber with its sentence, without a reload', async ({
    page,
  }) => {
    await openAsAdmin(page, '/app/admin/settings');
    const panel = page.getByRole('region', {
      exact: true,
      name: 'Starea sistemului',
    });
    await expect(panel).toBeVisible();
    await expect(panel.locator('ul.tiles > li')).toHaveCount(6);
    await slowMaps(db, page, panel);
  });

  // @traces 1430-FR-007 1430-FR-004
  test('the same tile turns amber on Panou, without a reload', async ({
    page,
  }) => {
    await openAsAdmin(page, '/app/admin');
    const panel = page.locator('mf-admin-panel').getByRole('region', {
      exact: true,
      name: 'Starea sistemului',
    });
    await expect(panel).toBeVisible();
    await expect(panel.locator('ul.tiles > li')).toHaveCount(6);
    await slowMaps(db, page, panel);
  });
});

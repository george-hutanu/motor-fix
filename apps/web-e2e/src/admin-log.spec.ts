// @traces 298-FR-003 298-FR-009 298-FR-011
import { expect, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

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
  const live = page.waitForResponse((r) => r.url().endsWith('/api/v1/live'));
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
  expect((await live).status()).toBe(200);
}

test.describe('the Jurnal panel @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'] || !process.env['REDIS_URL'],
    'writes its entry to PostgreSQL and announces it on Redis, which need DATABASE_URL and REDIS_URL',
  );

  let db: Client;
  const ids: string[] = [];

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM system_log_entry WHERE id = ANY($1)', [ids]);
    await db.end();
  });

  test('a new entry shows at the top of Jurnal without a reload', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const jurnal = page.getByRole('region', { exact: true, name: 'Jurnal' });
    await expect(jurnal).toBeVisible();
    let reloads = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads++;
    });

    // A fresh version is a new entry by construction: the writer groups by it.
    const version = `e2e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const { rows } = await db.query<{ id: string; at: Date }>(
      `INSERT INTO system_log_entry
         (id, at, minute, kind, source, severity, fingerprint, message, context)
       VALUES (gen_random_uuid(), now(), date_trunc('minute', now()),
         'deploy', 'worker', 'info', $1, $2, $3)
       RETURNING id, at`,
      [version, `Deployed ${version}.`, JSON.stringify({ version })],
    );
    ids.push(rows[0].id);
    const redis = new Redis(process.env['REDIS_URL'] as string);
    try {
      await redis.publish(
        'live:events',
        JSON.stringify({
          audience: ['admin'],
          event: {
            at: rows[0].at.toISOString(),
            id: rows[0].id,
            kind: 'system_log.added',
          },
        }),
      );
    } finally {
      redis.disconnect();
    }

    await expect(jurnal.locator('ol > li').first()).toContainText(
      `Versiune nouă instalată: ${version}.`,
      { timeout: 5_000 },
    );
    expect(reloads).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});

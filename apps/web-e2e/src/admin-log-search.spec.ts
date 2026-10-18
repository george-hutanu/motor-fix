import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

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

// The seeded admin reads Romanian; only the language is changed.
async function inEnglish(page: Page) {
  await page.route('**/api/v1/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), language: 'en' },
      response,
    });
  });
}

const day = (daysAgo: number) => {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  return { at, iso: at.toISOString().slice(0, 10) };
};

// @traces 299-FR-018
test.describe('searching the whole log @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its entries to PostgreSQL, which needs DATABASE_URL',
  );

  let db: Client;
  const ids: string[] = [];
  const word = `disk${Date.now().toString(36)}`;

  const write = async (
    daysAgo: number,
    kind: string,
    source: string,
    severity: string,
    message: string,
  ) => {
    const { at } = day(daysAgo);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO system_log_entry
         (id, at, minute, kind, source, severity, fingerprint, message, context)
       VALUES (gen_random_uuid(), $1, date_trunc('minute', $1::timestamptz),
         $2, $3, $4, gen_random_uuid()::text, $5, '{}')
       RETURNING id`,
      [at, kind, source, severity, message],
    );
    ids.push(rows[0].id);
  };

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    await write(
      2,
      'backup_failed',
      'backup',
      'error',
      `Backup failed: ${word} full.`,
    );
    await write(3, 'backup_completed', 'backup', 'info', 'Backup done.');
    await write(
      2,
      'job_failed',
      'worker',
      'error',
      `Job failed: ${word} quota.`,
    );
    await write(
      20,
      'backup_failed',
      'backup',
      'error',
      `Backup failed: ${word} old.`,
    );
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.query('DELETE FROM system_log_entry WHERE id = ANY($1)', [ids]);
    await db.end();
  });

  const texts = (page: Page) =>
    page.locator('mf-admin-log-view mf-log-lines li .text');

  test('opens the whole log from Jurnal, narrows it to one backup failure and keeps it on reload', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);

    await page
      .getByRole('region', { exact: true, name: 'Jurnal' })
      .getByRole('link', { name: 'Vezi tot jurnalul' })
      .click();
    await expect(page).toHaveURL('/app/admin/log');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Jurnal de sistem' }),
    ).toBeVisible();

    await page.getByRole('combobox', { name: 'Tip' }).selectOption('backup');
    await page.getByLabel('De la').fill(day(5).iso);
    await page.getByLabel('Până la').fill(day(0).iso);
    await page.getByRole('searchbox', { name: 'Caută în jurnal' }).fill(word);

    await expect(page).toHaveURL(new RegExp(`q=${word}`));
    await expect(texts(page)).toHaveCount(1);
    await expect(texts(page).first()).toContainText(word);

    await page.reload();
    await expect(texts(page)).toHaveCount(1);
    await expect(
      page.getByRole('searchbox', { name: 'Caută în jurnal' }),
    ).toHaveValue(word);
  });

  test('narrows the log through the filter sheet on a phone, in English', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 740, width: 320 });
    await inEnglish(page);
    await signInAsAdmin(page);
    await page.goto('/app/admin/log');

    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('combobox', { name: 'Type' }).selectOption('backup');
    await sheet.getByLabel('From').fill(day(5).iso);
    await sheet.getByLabel('To', { exact: true }).fill(day(0).iso);
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(new RegExp(`from=${day(5).iso}`));
    await expect(page).toHaveURL(new RegExp(`to=${day(0).iso}`));
    await page.getByRole('searchbox', { name: 'Search the log' }).fill(word);

    await expect(texts(page)).toHaveCount(1);
    await expect(texts(page).first()).toContainText(word);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('says there is nothing for a search that finds nothing and clears the filters', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await signInAsAdmin(page);
    await page.goto(`/app/admin/log?q=${word}zz`);

    await expect(
      page.getByText('Nicio intrare pentru acești filtri.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Șterge filtrele' }).click();
    await expect(page).toHaveURL('/app/admin/log');
  });
});

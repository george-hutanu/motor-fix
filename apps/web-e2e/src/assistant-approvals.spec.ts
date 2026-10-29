// @traces 1254-FR-004
// @traces 1254-FR-010
import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { headers, ready, signIn, signUpDriver } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';

type Row = { kind: 'book' | 'move' | 'cancel'; status: 'pending' | 'expired' };

// A driver of the test's own, with an assistant and its actions waiting, the
// oldest first. Their tool is in no catalogue, so Aprobă ends failed: nothing
// is ever booked. Written straight to PostgreSQL, as an assistant's call
// would leave them.
async function driverWith(request: APIRequestContext, rows: Row[]) {
  const email = await signUpDriver(request, 'aprobari');
  const ids = rows.map(() => randomUUID());
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    const {
      rows: [grant],
    } = await db.query<{ account_id: string; id: string }>(
      `INSERT INTO assistant_grant (account_id, client_id, client_name, can_read, can_act)
       SELECT id, 'e2e-assistant', 'Claude', true, true FROM account WHERE email = $1
       RETURNING id, account_id`,
      [email],
    );
    for (const [i, row] of rows.entries()) {
      const expired = row.status === 'expired';
      await db.query(
        `INSERT INTO assistant_approval (id, grant_id, account_id, tool, kind, summary,
           arguments, editable, status, expires_at, outcome, created_at, decided_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'e2e_book_service', $4::assistant_approval_kind,
           $5::text, $6::jsonb, $7::text[], $8::assistant_approval_status,
           now() + CASE WHEN $9::boolean THEN interval '-1 minute' ELSE interval '30 minutes' END,
           CASE WHEN $9 THEN '{"code":"timeout"}'::jsonb END,
           now() - make_interval(mins => $10::int),
           CASE WHEN $9 THEN now() - interval '1 minute' END)`,
        [
          ids[i],
          grant?.id,
          grant?.account_id,
          row.kind,
          `Acțiunea ${i + 1} a asistentului.`,
          JSON.stringify(row.kind === 'book' ? { shareHistory: true } : {}),
          row.kind === 'book' ? ['shareHistory'] : null,
          row.status,
          expired,
          10 - i,
        ],
      );
    }
  } finally {
    await db.end();
  }
  return { email, ids };
}

async function signedIn(page: Page, email: string) {
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/driver');
}

const strip = (page: Page) => page.locator('mf-approval-strip a');
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

// @seeded: the flows sign in, and write the assistant's actions to
// PostgreSQL; a deployed address, whose run has no DATABASE_URL, skips them.
test.describe('approving an assistant action @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    "writes the assistant's actions straight to PostgreSQL",
  );

  test('the strip counts across two tabs; Aprobă fails safely, Refuză refuses, then the sheet closes', async ({
    page,
    request,
  }) => {
    const { email, ids } = await driverWith(request, [
      { kind: 'book', status: 'pending' },
      { kind: 'move', status: 'pending' },
    ]);
    await page.setViewportSize({ height: 900, width: 1280 });
    await signedIn(page, email);
    const other = await page.context().newPage();
    await other.goto('/app/driver');
    await expect(strip(other)).toHaveText('2 acțiuni așteaptă aprobarea ta');

    await expect(strip(page)).toHaveText('2 acțiuni așteaptă aprobarea ta');
    await strip(page).click();
    await expect(page).toHaveURL(`/app/assistant/approvals/${ids[0]}`);
    const sheet = page.getByRole('dialog', {
      name: 'Asistentul tău (Claude) vrea să:',
    });
    await expect(sheet).toContainText('Acțiunea 1 a asistentului.');
    const tick = sheet.getByLabel('Trimite service‑ului istoricul mașinii');
    await expect(tick).toBeChecked();
    expect(
      await violations(page, {}, { include: [['.cdk-overlay-container']] }),
    ).toEqual([]);

    await tick.uncheck();
    await sheet.getByRole('button', { exact: true, name: 'Aprobă' }).click();
    await expect(sheet.getByRole('status')).toHaveText(
      'Nu s‑a putut face: acțiunea nu mai este disponibilă.',
    );
    await expect(strip(other)).toHaveText('1 acțiune așteaptă aprobarea ta', {
      timeout: 5_000,
    });

    await sheet.getByRole('button', { exact: true, name: 'Gata' }).click();
    await expect(page).toHaveURL(`/app/assistant/approvals/${ids[1]}`);
    await expect(sheet).toContainText('Acțiunea 2 a asistentului.');
    await sheet.getByRole('button', { exact: true, name: 'Refuză' }).click();
    await expect(sheet.getByRole('status')).toHaveText('Refuzată');
    await expect(strip(other)).toHaveCount(0, { timeout: 5_000 });

    await sheet.getByRole('button', { exact: true, name: 'Gata' }).click();
    await expect(page).toHaveURL('/app/driver');
    await expect(sheet).toHaveCount(0);
    await other.close();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`on a 320 px phone in ${scheme}, in English, an expired action says so and nothing scrolls sideways`, async ({
      page,
      request,
    }) => {
      const { email, ids } = await driverWith(request, [
        { kind: 'cancel', status: 'expired' },
        { kind: 'book', status: 'pending' },
      ]);
      const language = await request.patch('/api/v1/me', {
        data: { language: 'en' },
        headers: await headers(request, email),
      });
      expect(language.ok()).toBe(true);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 900, width: 1280 });
      await signedIn(page, email);
      await page.setViewportSize({ height: 640, width: 320 });

      await expect(strip(page)).toHaveText('1 action awaits your approval');
      expect(await sideways(page)).toBe(false);

      await page.goto(`/app/assistant/approvals/${ids[0]}`);
      const sheet = page.getByRole('dialog', {
        name: 'Your assistant (Claude) wants to:',
      });
      await expect(sheet.locator('mf-overlay-panel')).toBeVisible();
      await expect(sheet.getByRole('status')).toHaveText('Expired');
      await expect(
        sheet.getByRole('button', { exact: true, name: 'Approve' }),
      ).toHaveCount(0);
      expect(await sideways(page)).toBe(false);

      await page.goto(`/app/assistant/approvals/${ids[1]}`);
      await expect(
        sheet.getByLabel("Send the garage your car's history"),
      ).toBeChecked();
      await expect(
        sheet.getByRole('button', { exact: true, name: 'Approve' }),
      ).toBeVisible();
      await expect(
        sheet.getByRole('button', { exact: true, name: 'Refuse' }),
      ).toBeVisible();
      expect(await sideways(page)).toBe(false);
      expect(
        await violations(page, {}, { include: [['.cdk-overlay-container']] }),
      ).toEqual([]);
    });
  }
});

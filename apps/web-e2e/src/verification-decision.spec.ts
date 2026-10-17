import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

async function headers(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

async function signInAsAdmin2(page: Page) {
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
  await signIn(page, ACCOUNTS.admin2);
  await expect(page).toHaveURL('/app/admin');
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const drawer = (page: Page) => page.locator('mf-verification-file');
const footer = (page: Page) => drawer(page).locator('[data-section="footer"]');
const DECISIONS = ['Aprobă și publică', 'Cere completări', 'Respinge'];

// One admin decides through the endpoint while the other has the file open:
// the open drawer follows each decision live, and reopens on its own button.
// @traces 306-FR-002 306-FR-005 306-FR-007 306-FR-009 306-FR-010
test.describe('deciding a file while another admin has it open @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'seeds a garage and its file in PostgreSQL, which needs DATABASE_URL',
  );

  let db: Client;
  let garageId: string;
  let fileId: string;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.beforeEach(async () => {
    garageId = randomUUID();
    await db.query(
      `INSERT INTO garage (id, name, slug, city_key, city_name, business_kind, address, phone, cui)
       VALUES ($1, $2, $3, 'bucuresti', 'București', 'company', 'Str. Fabricii 12, București', '+40712345678', '1234567897')`,
      [garageId, `Decizie ${garageId.slice(0, 8)}`, `decizie-${garageId}`],
    );
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO verification_file (id, garage_id, status)
       VALUES (gen_random_uuid(), $1, 'submitted') RETURNING id::text`,
      [garageId],
    );
    fileId = rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind, result)
       SELECT gen_random_uuid(), $1, kind,
         CASE WHEN kind IN ('rar', 'caen') THEN 'ok' ELSE 'not_run' END::verification_check_result
       FROM unnest(enum_range(NULL::verification_check_kind)) AS kind`,
      [fileId],
    );
  });

  test.afterEach(async () => {
    await db.query('DELETE FROM outbox_event WHERE subject_id = $1', [fileId]);
    await db.query('DELETE FROM garage WHERE id = $1', [garageId]);
  });

  test.afterAll(async () => {
    await db.end();
  });

  for (const width of [undefined, 320]) {
    test(`follows a rejection, reopens and follows the approval${width ? ` at ${width} px` : ''}`, async ({
      page,
      request,
    }) => {
      if (width) await page.setViewportSize({ height: 640, width });
      const first = await headers(request, ACCOUNTS.admin);
      await signInAsAdmin2(page);
      await page.goto(`/app/admin/garages/${fileId}`);
      await expect(footer(page).getByRole('button')).toHaveText(DECISIONS);

      const rejection = await request.post(
        `/api/v1/admin/verification-files/${fileId}/decision`,
        {
          data: {
            decision: 'rejected',
            note: 'Lipsește certificatul ONRC.',
            reason: 'documents',
          },
          headers: first,
        },
      );
      expect(rejection.status()).toBe(200);

      await expect(footer(page)).toContainText('Respins de');
      await expect(footer(page)).toContainText(
        'Service‑ul primește decizia pe e‑mail.',
      );
      await expect(footer(page).getByRole('button')).toHaveCount(0);
      expect(await sideways(page)).toBe(0);

      const again = await request.post(
        `/api/v1/admin/verification-files/${fileId}/decision`,
        { data: { decision: 'approved' }, headers: first },
      );
      expect(again.status()).toBe(409);
      expect(await again.json()).toMatchObject({
        code: 'verification_transition_refused',
        currentStatus: 'rejected',
      });

      await drawer(page)
        .getByRole('button', { name: 'Redeschide dosarul' })
        .click();
      const confirm = page.getByRole('dialog').filter({
        hasText: 'Redeschizi dosarul? Decizia rămâne până iei una nouă.',
      });
      expect(await sideways(page)).toBe(0);
      await confirm.getByRole('button', { name: 'Redeschide' }).click();

      await expect(footer(page).getByRole('button')).toHaveText(DECISIONS);
      await expect(
        drawer(page).getByRole('button', { name: 'Redeschide dosarul' }),
      ).toHaveCount(0);

      const approval = await request.post(
        `/api/v1/admin/verification-files/${fileId}/decision`,
        { data: { decision: 'approved' }, headers: first },
      );
      expect(approval.status()).toBe(200);

      await expect(footer(page)).toContainText('Aprobat de');
      const history = drawer(page).locator('[data-section="history"] li');
      await expect(history.filter({ hasText: 'Respins de' })).toHaveCount(1);
      await expect(history.filter({ hasText: 'Redeschis de' })).toHaveCount(1);
      await expect(history.filter({ hasText: 'Aprobat de' })).toHaveCount(1);
      expect(await sideways(page)).toBe(0);
    });
  }
});

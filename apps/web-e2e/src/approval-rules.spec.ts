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
      .getByRole('link', { exact: true, name: 'Cont' })
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

// An admin's approval refused by the RAR gate leaves its line in the file's
// history, written by the endpoint after the refusal rolled back; the seeded
// stack keeps both test-only rules off, as every environment starts. The RAR
// switch is not turned on here: it is one platform-wide value, and the suite's
// other workers approve files under the gate it would lift. Every run that
// boots the stack has the database, so the flow needs DATABASE_URL.
// @traces 259-FR-005 259-FR-006 259-FR-008
test.describe('a refused approval in the history @seeded', () => {
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
      [garageId, `Refuz ${garageId.slice(0, 8)}`, `refuz-${garageId}`],
    );
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO verification_file (id, garage_id, status)
       VALUES (gen_random_uuid(), $1, 'submitted') RETURNING id::text`,
      [garageId],
    );
    fileId = rows[0]?.id ?? '';
    // As a sending leaves it: every check present, none run.
    await db.query(
      `INSERT INTO verification_check (id, file_id, kind)
       SELECT gen_random_uuid(), $1, kind
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
    test(`shows the refused attempt first in the drawer${width ? ` at ${width} px` : ''}`, async ({
      page,
      request,
    }) => {
      if (width) await page.setViewportSize({ height: 640, width });
      const first = await headers(request, ACCOUNTS.admin);
      const read = await request.get('/api/v1/admin/platform-rules', {
        headers: first,
      });
      const { rules } = (await read.json()) as {
        rules: { key: string; value: unknown }[];
      };
      for (const key of ['skip_manual_approval', 'skip_rar_check']) {
        expect(rules.find((rule) => rule.key === key)?.value).toBe(false);
      }

      const refused = await request.post(
        `/api/v1/admin/verification-files/${fileId}/decision`,
        { data: { decision: 'approved' }, headers: first },
      );
      expect(refused.status()).toBe(409);
      expect(await refused.json()).toMatchObject({
        code: 'rar_check_required',
      });

      await signInAsAdmin2(page);
      await page.goto(`/app/admin/garages/${fileId}`);
      const history = drawer(page).locator('[data-section="history"]');
      await history.scrollIntoViewIfNeeded();
      await expect(history.locator('li').first()).toHaveText(
        /^Aprobare refuzată: verificarea RAR nu e în regulă — \S+, azi, \d\d:\d\d$/,
      );
      const approve = drawer(page).locator('[data-part="approve"]');
      await approve.scrollIntoViewIfNeeded();
      await expect(approve).toBeDisabled();
      await expect(drawer(page).locator('[data-part="gate-hint"]')).toHaveText(
        'Verificarea RAR e obligatorie',
      );
      expect(await sideways(page)).toBe(0);
    });
  }
});

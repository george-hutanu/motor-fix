import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from '@playwright/test';
import { Client } from 'pg';

import { openSignIn, ready, signIn } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';

// An admin of this file's own: hiding and moving a section saves that
// admin's layout, which no other spec may see change under it.
test.describe('customising the admin Panou @seeded @database', () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const admin = {
    email: `panou-admin-${stamp}@example.test`,
    password: 'admin-panou-2026',
  };
  let db: Client;

  test.beforeAll(async ({ request }) => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    const signUp = await request.post('/api/v1/auth/sign-up', {
      data: {
        consent: CURRENT_CONSENT,
        email: admin.email,
        language: 'ro',
        name: `Admin ${stamp}`,
        password: admin.password,
      },
      headers: { 'x-forwarded-for': `203.0.113.${(Date.now() + 83) % 250}` },
    });
    expect(signUp.status()).toBe(201);
    const account = await db.query<{ id: string }>(
      'SELECT id FROM account WHERE email = $1',
      [admin.email],
    );
    const accountId = account.rows[0]?.id ?? '';
    await db.query(
      `INSERT INTO account_role (account_id, role) VALUES ($1, 'admin')
       ON CONFLICT DO NOTHING`,
      [accountId],
    );
    await db.query(`UPDATE account SET last_role = 'admin' WHERE id = $1`, [
      accountId,
    ]);
  });

  test.afterAll(async () => {
    try {
      await db.query('DELETE FROM account WHERE email = $1', [admin.email]);
    } finally {
      await db.end();
    }
  });

  const signedIn = async (page: Page) => {
    await ready(page, '/ro');
    await openSignIn(page);
    await signIn(page, admin.email, { password: admin.password });
    await expect(page).toHaveURL('/app/admin');
  };
  // The second browser of a test, closed after it whether it passed or not.
  let second: BrowserContext | undefined;
  test.afterEach(async () => {
    await second?.close();
    second = undefined;
  });
  const secondPage = async (browser: Browser) => {
    const context = await browser.newContext();
    second = context;
    const page = await context.newPage();
    await signedIn(page);
    return { page };
  };
  const panel = (page: Page) =>
    page.getByRole('dialog', { name: 'Alege ce vezi pe panou' });
  const open = async (page: Page) => {
    await page.getByRole('button', { name: 'Personalizează panoul' }).click();
    await expect(panel(page)).toBeVisible();
  };
  const rows = (page: Page) =>
    panel(page)
      .locator('[data-row]')
      .evaluateAll((all) => all.map((el) => el.getAttribute('data-key')));
  const drawn = (page: Page) =>
    page
      .locator('mf-admin-panel')
      .locator('mf-admin-queue, mf-admin-growth, mf-admin-demand, mf-admin-log')
      .evaluateAll((all) => all.map((el) => el.tagName.toLowerCase()));
  const sideways = (page: Page) =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

  // @traces 1391-FR-013 1391-FR-011 1391-FR-006
  test('the admin hides and moves sections, keeps them everywhere and goes back to the default', async ({
    browser,
    page,
  }) => {
    await signedIn(page);
    await expect(page.getByText('5 din 5 secțiuni afișate')).toBeVisible();
    const other = await secondPage(browser);

    await open(page);
    const growth = panel(page).getByRole('switch', {
      name: 'Ascunde: Creștere, ultimele 12 luni',
    });
    await growth.click();
    await expect(growth).toHaveAttribute('aria-checked', 'false');
    await panel(page)
      .getByRole('button', { name: 'Mută mai sus: Jurnal' })
      .click();
    await expect
      .poll(() => rows(page))
      .toEqual(['numbers', 'verification', 'growth', 'log', 'demand']);
    await expect(page.getByText('4 din 5 secțiuni afișate')).toBeVisible();

    // The other page follows within five seconds, without a reload.
    await expect(other.page.getByText('4 din 5 secțiuni afișate')).toBeVisible({
      timeout: 5_000,
    });
    await expect
      .poll(() => drawn(other.page), { timeout: 5_000 })
      .toEqual(['mf-admin-queue', 'mf-admin-log', 'mf-admin-demand']);

    await panel(page).getByRole('button', { name: 'Gata' }).click();
    await expect(panel(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('4 din 5 secțiuni afișate')).toBeVisible();
    expect(await drawn(page)).toEqual([
      'mf-admin-queue',
      'mf-admin-log',
      'mf-admin-demand',
    ]);

    await open(page);
    await panel(page)
      .getByRole('button', { name: 'Revino la varianta implicită' })
      .click();
    await expect(page.getByText('5 din 5 secțiuni afișate')).toBeVisible();
    await expect
      .poll(() => rows(page))
      .toEqual(['numbers', 'verification', 'growth', 'demand', 'log']);
    await expect(other.page.getByText('5 din 5 secțiuni afișate')).toBeVisible({
      timeout: 5_000,
    });
  });

  // The language switch sits in the desktop header: the language is turned
  // there and the panel is then checked at the phone width.
  const language = async (page: Page, to: 'ro' | 'en', width: number) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    const button = page
      .getByRole('group', { name: /^(Limba|Language)$/ })
      .getByRole('button', { exact: true, name: to.toUpperCase() });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('lang', to);
    await page.setViewportSize({ height: 800, width });
  };
  const scan = async (page: Page) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      const found = await violations(
        page,
        { resultTypes: ['violations'] },
        { include: [['[role="dialog"]']] },
      );
      expect(found.map((v) => `${scheme}: ${v.id}`)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: null });
  };

  // @traces 1391-FR-012 1391-FR-018
  for (const width of [320, 390]) {
    test(`the open panel fits ${width} px in both schemes and languages, with no axe finding`, async ({
      page,
    }) => {
      await signedIn(page);
      await language(page, 'ro', width);
      await open(page);
      await scan(page);
      await panel(page).getByRole('button', { name: 'Gata' }).click();
      await expect(panel(page)).toHaveCount(0);

      await language(page, 'en', width);
      await page
        .getByRole('button', { name: 'Customise the dashboard' })
        .click();
      const english = page.getByRole('dialog', {
        name: 'Choose what the dashboard shows',
      });
      await expect(english).toBeVisible();
      await expect(
        english.getByRole('button', { name: 'Move up: Log' }),
      ).toBeVisible();
      await scan(page);
      await english.getByRole('button', { name: 'Done' }).click();
      await language(page, 'ro', 1280);
    });
  }
});

import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  test,
} from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';

const MAINTENANCE = 'Mod mentenanță';

// A signed-in dashboard holds the live stream open, so the network never goes
// idle there: wait for the rules block instead.
async function settled(page: Page) {
  await page.goto('/app/admin/settings');
  await expect(maintenance(page)).toBeVisible();
}

async function accessToken(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email: ACCOUNTS.admin, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

// Maintenance goes back off, so the suite can run twice against one database.
async function restore(request: APIRequestContext) {
  const headers = { Authorization: `Bearer ${await accessToken(request)}` };
  const read = await request.get('/api/v1/admin/platform-rules', { headers });
  const { rules } = (await read.json()) as {
    rules: { key: string; value: unknown }[];
  };
  const seen = rules.find((r) => r.key === 'maintenance_mode')?.value;
  if (seen === false) return;
  const saved = await request.patch(
    '/api/v1/admin/platform-rules/maintenance_mode',
    { data: { seen, value: false }, headers },
  );
  expect(saved.ok()).toBe(true);
}

async function openSettings(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
  await settled(page);
}

async function secondAdmin(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openSettings(page);
  return { context, page };
}

const maintenance = (page: Page) =>
  page.getByRole('switch', { exact: true, name: MAINTENANCE });

test.describe('the platform rules in Setări @seeded', () => {
  test.beforeEach(({ request }) => restore(request));
  test.afterEach(({ request }) => restore(request));

  test('open the admin Setări view, above the push panel', async ({ page }) => {
    await openSettings(page);

    const heading = page.getByRole('heading', { name: 'Setări platformă' });
    await expect(heading).toBeVisible();
    await expect(
      page.getByText('Regulile care se aplică tuturor service‑urilor'),
    ).toBeVisible();
    await expect(page.getByRole('switch')).not.toHaveCount(0);
    await expect(maintenance(page)).toHaveAttribute('aria-checked', 'false');
    const block = await page.locator('mf-platform-rules').boundingBox();
    const push = await page.locator('mf-push-panel').boundingBox();
    expect(block?.y ?? 0).toBeLessThan(push?.y ?? 0);
  });

  test('keep a switched rule over a reload', async ({ page }) => {
    await openSettings(page);

    const saved = page.waitForResponse(
      (res) =>
        res.request().method() === 'PATCH' &&
        res.url().includes('/admin/platform-rules/maintenance_mode'),
    );
    await maintenance(page).click();
    await expect(maintenance(page)).toHaveAttribute('aria-checked', 'true');
    expect((await saved).ok()).toBe(true);
    await page.reload();

    await expect(maintenance(page)).toHaveAttribute('aria-checked', 'true');
  });

  test("follow another admin's change without a reload", async ({
    browser,
    page,
  }) => {
    await openSettings(page);
    const other = await secondAdmin(browser);

    await maintenance(page).click();

    await expect(maintenance(other.page)).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 5000 },
    );
    await other.context.close();
  });

  test('read at 320 px without sideways scroll', async ({ page }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, '/ro');
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { name: 'Cont' })
      .click();
    await signIn(page, ACCOUNTS.admin);
    await expect(page).toHaveURL('/app/admin');
    await settled(page);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});

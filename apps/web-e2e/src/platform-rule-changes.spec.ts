import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
} from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const REVIEWS = 'Recenzii doar după o lucrare confirmată';
const KEY = 'reviews_only_after_confirmed_job';
const REASON = 'Testăm recenziile din profilul service-ului.';

// Each request carries its own reason, so a history line left by an earlier
// test or a retry never answers for this one.
const reasonFor = () => `${REASON} ${Date.now()}`;

async function headers(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

// No request left waiting and the rule back on, so the suite can run twice
// against one database.
async function restore(request: APIRequestContext) {
  const first = await headers(request, ACCOUNTS.admin);
  const second = await headers(request, ACCOUNTS.admin2);
  const read = await request.get(
    `/api/v1/admin/platform-rule-changes?key=${KEY}`,
    { headers: first },
  );
  const { waiting } = (await read.json()) as {
    waiting: { id: string; mine: boolean } | null;
  };
  if (waiting) {
    const step = waiting.mine ? 'cancel' : 'refuse';
    await request.post(
      `/api/v1/admin/platform-rule-changes/${waiting.id}/${step}`,
      { headers: first },
    );
  }
  const rules = await request.get('/api/v1/admin/platform-rules', {
    headers: second,
  });
  const { rules: list } = (await rules.json()) as {
    rules: { key: string; value: unknown }[];
  };
  if (list.find((r) => r.key === KEY)?.value === false) {
    const back = await request.patch(`/api/v1/admin/platform-rules/${KEY}`, {
      data: { seen: false, value: true },
      headers: second,
    });
    expect(back.ok()).toBe(true);
  }
}

async function openSettings(page: Page, email: string) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/admin');
  await page.goto('/app/admin/settings');
  await expect(reviews(page)).toBeVisible();
}

async function otherAdmin(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openSettings(page, ACCOUNTS.admin2);
  return { context, page };
}

const reviews = (page: Page) =>
  page.getByRole('switch', { exact: true, name: REVIEWS });

// The modal dialog hides the page behind it from the accessibility tree.
const behind = (page: Page) =>
  page.getByRole('switch', { exact: true, includeHidden: true, name: REVIEWS });

const decided = (page: Page, reason: string) =>
  page.locator('[data-decided] p').filter({ hasText: reason });

async function ask(page: Page, reason: string) {
  await reviews(page).click();
  const dialog = page.getByRole('dialog', {
    name: `Oprești regula „${REVIEWS}”?`,
  });
  await dialog.getByLabel('Motiv').fill(reason);
  await dialog.getByRole('button', { name: 'Trimite cererea' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('a second admin confirms switching a rule off @seeded', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(({ request }) => restore(request));
  test.afterEach(({ request }) => restore(request));

  test('ask as one admin, approve as another, without a reload', async ({
    browser,
    page,
  }) => {
    await openSettings(page, ACCOUNTS.admin);
    const other = await otherAdmin(browser);
    const reason = reasonFor();

    await ask(page, reason);

    await expect(reviews(page)).toHaveAttribute('aria-checked', 'true');
    await expect(reviews(page)).toBeDisabled();
    await expect(
      page.getByText('Așteaptă aprobarea altui admin'),
    ).toBeVisible();
    await expect(
      other.page.getByText('Așteaptă aprobarea altui admin'),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      other.page.locator('[data-waiting]').getByText(reason, { exact: true }),
    ).toBeVisible();

    await other.page.getByRole('button', { name: 'Aprobă' }).click();

    await expect(reviews(other.page)).toHaveAttribute('aria-checked', 'false');
    await expect(reviews(page)).toHaveAttribute('aria-checked', 'false', {
      timeout: 5000,
    });
    await expect(decided(page, reason)).toContainText(/Aprobată de Mihai · /);
    await other.context.close();
  });

  test('ask as one admin, refused by another, without a reload', async ({
    browser,
    page,
  }) => {
    await openSettings(page, ACCOUNTS.admin);
    const other = await otherAdmin(browser);
    const reason = reasonFor();

    await ask(page, reason);
    await expect(
      other.page.locator('[data-waiting]').getByText(reason, { exact: true }),
    ).toBeVisible({ timeout: 5000 });
    await other.page.getByRole('button', { name: 'Refuză' }).click();

    await expect(decided(page, reason)).toContainText(/Refuzată de Mihai · /, {
      timeout: 5000,
    });
    await expect(page.locator('[data-waiting]')).toHaveCount(0);
    await expect(reviews(page)).toBeEnabled();
    await expect(reviews(page)).toHaveAttribute('aria-checked', 'true');
    await expect(reviews(other.page)).toHaveAttribute('aria-checked', 'true');
    await other.context.close();
  });

  test('withdraw a request as its asker', async ({ page }) => {
    await openSettings(page, ACCOUNTS.admin);
    const reason = reasonFor();
    await ask(page, reason);

    await page.getByRole('button', { name: 'Retrage cererea' }).click();

    await expect(decided(page, reason)).toContainText(/Retrasă de Admin · /);
    await expect(reviews(page)).toBeEnabled();
    await expect(reviews(page)).toHaveAttribute('aria-checked', 'true');
  });

  test('cancel the dialog and send nothing', async ({ page }) => {
    await openSettings(page, ACCOUNTS.admin);
    let sent = 0;
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/admin/platform-rule')) {
        sent++;
      }
    });

    await reviews(page).click();
    await expect(page.getByLabel('Motiv')).toBeVisible();
    await expect(behind(page)).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Renunță' }).click();

    await expect(reviews(page)).toHaveAttribute('aria-checked', 'true');
    await expect(reviews(page)).toBeFocused();
    expect(sent).toBe(0);
  });

  test('ask with the keyboard: the focus stays in the dialog and Escape gives it back', async ({
    page,
  }) => {
    await openSettings(page, ACCOUNTS.admin);
    let sent = 0;
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/admin/platform-rule')) {
        sent++;
      }
    });
    const dialog = page.getByRole('dialog', {
      name: `Oprești regula „${REVIEWS}”?`,
    });

    await reviews(page).focus();
    await page.keyboard.press('Space');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      await expect(dialog.locator(':focus')).toHaveCount(1);
    }
    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(reviews(page)).toBeFocused();
    await expect(reviews(page)).toHaveAttribute('aria-checked', 'true');
    expect(sent).toBe(0);
  });

  test('read the dialog and the card at 320 px in dark without sideways scroll', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openSettings(page, ACCOUNTS.admin);
    await page.setViewportSize({ height: 640, width: 320 });
    const wide = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );

    await reviews(page).click();
    await expect(page.getByLabel('Motiv')).toBeVisible();
    expect(await wide()).toBeLessThanOrEqual(0);
    await page.getByLabel('Motiv').fill(reasonFor());
    await page.getByRole('button', { name: 'Trimite cererea' }).click();
    await expect(
      page.getByText('Așteaptă aprobarea altui admin'),
    ).toBeVisible();
    expect(await wide()).toBeLessThanOrEqual(0);
  });
});

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';

// @traces 398-FR-009 398-FR-010 398-FR-012 398-FR-014

async function teamOn(request: APIRequestContext) {
  const signedIn = await request.post('/api/v1/auth/sign-in', {
    data: { email: ACCOUNTS.twoRoles, password: PASSWORD, remember: false },
  });
  const { accessToken } = (await signedIn.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const me = (await (await request.get('/api/v1/me', { headers })).json()) as {
    garageId: string;
  };
  const res = await request.put(
    `/api/v1/garages/${me.garageId}/features/team_mechanics`,
    { data: { enabled: true }, headers },
  );
  expect(res.status()).toBe(200);
}

async function openDashboard(page: Page, path: string) {
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  const live = page.waitForResponse((r) => r.url().endsWith('/api/v1/live'));
  await signIn(page, ACCOUNTS.twoRoles);
  await expect(page).toHaveURL('/app/garage');
  expect((await live).status()).toBe(200);
  await page.goto(path);
}

const menu = (page: Page) => page.getByRole('navigation').first();

// Service Dobre's owner: a garage with no mechanic of its own.
test.describe("the garage's feature switches @seeded", () => {
  test.beforeEach(async ({ request }) => {
    await teamOn(request);
  });

  test.afterEach(async ({ request }) => {
    await teamOn(request);
  });

  test('switching the team off in one tab takes Mecanici away from another open tab, and back', async ({
    browser,
  }) => {
    const a = await (await browser.newContext()).newPage();
    const b = await (await browser.newContext()).newPage();
    await openDashboard(a, '/app/garage/settings');
    await openDashboard(b, '/app/garage/team');
    await b.evaluate(() => {
      (window as { kept?: boolean }).kept = true;
    });

    const team = a.getByRole('switch', { name: 'Echipă și mecanici' });
    await expect(team).toBeChecked();
    await team.click();
    const confirm = a.getByRole('dialog');
    await expect(confirm).toBeVisible();
    expect(await violations(a, {}, { include: [['[role="dialog"]']] })).toEqual(
      [],
    );
    await confirm.getByRole('button', { name: 'Oprește' }).click();
    await expect(team).not.toBeChecked();

    await expect(b).toHaveURL('/app/garage', { timeout: 5000 });
    expect(await b.evaluate(() => (window as { kept?: boolean }).kept)).toBe(
      true,
    );
    await expect(
      menu(b).getByRole('link', { exact: true, name: 'Mecanici' }),
    ).toHaveCount(0, { timeout: 5000 });

    await team.click();
    await expect(team).toBeChecked();
    await expect(
      menu(b).getByRole('link', { exact: true, name: 'Mecanici' }),
    ).toBeVisible({ timeout: 5000 });
    expect(
      await violations(a, {}, { include: [['mf-feature-switches']] }),
    ).toEqual([]);
  });

  test('cancelling the confirmation leaves the switch on', async ({ page }) => {
    await openDashboard(page, '/app/garage/settings');

    const lifts = page.getByRole('switch', { name: 'Program pe elevatoare' });
    await lifts.click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(lifts).toBeChecked();
    await expect(lifts).toBeFocused();
  });
});

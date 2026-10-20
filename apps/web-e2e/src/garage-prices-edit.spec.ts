import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, headers, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seed's Service Auto Militari: front brakes at 890–1.400 lei, 2 h. The
// other flows read that range, so this file runs in its own project after
// them (playwright.config.mts) and puts the seeded range back after each test.
const OWNER = 'militari@example.test';
const PROFILE = '/ro/garages/service-auto-militari';
const BRAKES = 'Plăcuțe și discuri de frână față';
const SEEDED = { durationMinutes: 120, fromBani: 89_000, toBani: 140_000 };

const language = (page: Page) =>
  page.getByRole('group', { name: /^(Limba|Language)$/ });
const brakesRow = (page: Page) =>
  page
    .locator('[data-row]')
    .filter({ has: page.locator('[data-name]', { hasText: BRAKES }) });
const profileRange = (page: Page) =>
  page
    .locator('section[data-slot="prices"] .row')
    .filter({ hasText: BRAKES })
    .locator('.range');

async function signedIn(page: Page) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, OWNER);
  await expect(page).toHaveURL('/app/garage');
  await language(page).getByRole('button', { exact: true, name: 'RO' }).click();
}

// Puts the seeded front brakes back through the owner's own write.
async function restore(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email: OWNER, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const me = await request.get('/api/v1/me', { headers });
  const { garageId } = (await me.json()) as { garageId: string };
  const list = await request.get(`/api/v1/garages/${garageId}/prices`, {
    headers,
  });
  const { items } = (await list.json()) as {
    items: { nameRo: string; priceId?: string; updatedAt?: string }[];
  };
  const row = items.find((item) => item.nameRo === BRAKES);
  if (!row?.priceId) throw new Error('the seeded front brakes row is missing');
  console.log(
    `DIAG restore ${new Date().toISOString()} ${JSON.stringify(row).slice(0, 300)}`,
  );
  const put = await request.patch(
    `/api/v1/garages/${garageId}/prices/${row.priceId}`,
    { data: { ...SEEDED, expectedUpdatedAt: row.updatedAt }, headers },
  );
  expect(put.ok()).toBe(true);
}

// @seeded: signs in as the seeded owner against the real API.
// @traces 173-FR-001 173-FR-002 173-FR-009 173-FR-016
test.describe('the owner changes a price range in place @seeded', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ request }) => {
    await restore(request);
  });

  for (const [size, width, height] of [
    ['a desktop', 1440, 900],
    ['a 390 px phone', 390, 844],
  ] as const) {
    test(`front brakes to 950–1.450 lei on ${size}, an open profile following without a reload`, async ({
      browser,
      page,
    }) => {
      const visitor = await browser.newContext();
      const seen: string[] = [];
      page.on('response', async (r) => {
        const u = r.url();
        if (!/\/api\/v1\/(garages\/[^/]+\/prices|live)/.test(u)) return;
        const body = await r.text().catch(() => '');
        const brakes =
          body.match(
            /"priceId":"[^"]+","updatedAt":"[^"]+"[^}]*?frân|frână față[^}]{0,400}/,
          )?.[0] ?? '';
        seen.push(
          `${new Date().toISOString()} ${r.request().method()} ${u.slice(21, 120)} ${r.status()} req=${(r.request().postData() ?? '').slice(0, 200)} res=${(brakes || body).slice(0, 400)}`,
        );
      });
      try {
        const profile = await visitor.newPage();
        const stream = profile.waitForResponse(
          (r) =>
            r.url().includes('/api/v1/live/public?') &&
            r.url().includes('garages=') &&
            r.ok(),
        );
        await profile.goto(PROFILE);
        await expect(profileRange(profile)).toHaveText('890–1.400 lei');
        await stream;

        // Signed in at desktop width, where the header carries the button.
        await signedIn(page);
        await page.setViewportSize({ height, width });
        await page.goto('/app/garage/prices');
        await expect(brakesRow(page).locator('[data-price]')).toHaveText(
          '890–1.400 lei',
        );

        const toggle = page.getByRole('button', {
          exact: true,
          name: 'Modifică prețurile',
        });
        await toggle.click();
        await expect(
          page.getByRole('button', { exact: true, name: 'Gata' }),
        ).toHaveAttribute('aria-pressed', 'true');
        await page
          .getByRole('button', { exact: true, name: `Modifică ${BRAKES}` })
          .click();

        const editor = page.locator('mf-overlay-panel');
        await expect(editor.getByRole('heading')).toHaveText(BRAKES);
        if (width < 768) await expect(editor).toHaveClass(/mf-overlay-sheet/);
        await expect(editor.getByLabel('Durată')).toHaveValue('120');
        await editor.getByLabel('De la').fill('950');
        await editor.getByLabel('Până la').fill('1.450');
        await editor
          .getByRole('button', { exact: true, name: 'Salvează' })
          .click();

        await expect(editor).toHaveCount(0);
        await expect(brakesRow(page).locator('[data-price]')).toHaveText(
          '950–1.450 lei',
        );
        await expect(brakesRow(page).locator('[data-duration]')).toHaveText(
          '2 h',
        );
        // The profile opened before the save reads the new range by itself.
        await expect(profileRange(profile)).toHaveText('950–1.450 lei');
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        ).toBe(0);

        await page.getByRole('button', { exact: true, name: 'Gata' }).click();
        await expect(page.locator('[data-row] button')).toHaveCount(0);
      } catch (error) {
        console.log(`DIAG garage-prices-edit\n${seen.join('\n')}`);
        throw error;
      } finally {
        await visitor.close();
      }
    });
  }
});

// @seeded: the admin reads the entry through the audit history API, which no admin screen reads yet.
// @traces 176-FR-012
test.describe('a price change in the audit history @seeded', () => {
  test.afterEach(async ({ request }) => {
    await restore(request);
  });

  test('an admin finds the old and new front brakes range after the owner saves it', async ({
    page,
    request,
  }) => {
    const since = new Date().toISOString();
    await signedIn(page);
    await page.goto('/app/garage/prices');
    await page
      .getByRole('button', { exact: true, name: 'Modifică prețurile' })
      .click();
    await page
      .getByRole('button', { exact: true, name: `Modifică ${BRAKES}` })
      .click();
    const editor = page.locator('mf-overlay-panel');
    await editor.getByLabel('De la').fill('950');
    await editor.getByLabel('Până la').fill('1.450');
    await editor.getByRole('button', { exact: true, name: 'Salvează' }).click();
    await expect(editor).toHaveCount(0);

    const res = await request.get('/api/v1/audit-history', {
      headers: await headers(request, ACCOUNTS.admin),
      params: { area: 'prices', from: since },
    });
    expect(res.ok()).toBe(true);
    const { items } = (await res.json()) as {
      items: {
        field: string;
        kind: string;
        newValue: unknown;
        oldValue: unknown;
      }[];
    };
    expect(items).toContainEqual(
      expect.objectContaining({
        field: 'range',
        kind: 'price_list',
        newValue: { from: 95_000, to: 145_000 },
        oldValue: { from: 89_000, to: 140_000 },
      }),
    );
  });
});

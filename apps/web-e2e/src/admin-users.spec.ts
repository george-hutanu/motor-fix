import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const recent = (page: Page) =>
  page.locator('mf-panel').filter({
    has: page.getByRole('heading', { name: /Conturi recente|Recent accounts/ }),
  });
const row = (page: Page, name: string) =>
  recent(page)
    .locator('li.row')
    .filter({
      has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }),
    });

// Other tests add accounts, so a seeded one may sit past the first page:
// bring the list's end into view until the row has loaded.
async function findRow(page: Page, name: string) {
  const found = row(page, name);
  for (let tries = 0; tries < 15 && (await found.count()) === 0; tries++) {
    await recent(page).locator('li.row').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }
  await expect(found).toHaveCount(1);
  return found;
}

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

test.describe('the accounts view @seeded', () => {
  for (const [device, width, height] of [
    ['a 320 px phone', 320, 640],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`shows the seeded admin the totals, the accounts and the growth on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await signInAsAdmin(page);
      await page.goto('/app/admin/users');

      await expect(page.locator('.totals')).toHaveText(
        /^[\d.]+ (de )?(șofer activ|șoferi activi) · [\d.]+ (de )?service(‑uri)? · [\d.]+ (de )?mecanici?$/,
      );

      const suspended = await findRow(page, 'Radu Suspendat');
      await expect(suspended.locator('mf-lamp')).toHaveAttribute(
        'data-state',
        'red',
      );
      await expect(suspended.locator('mf-lamp')).toHaveText(
        'suspendat · din 2 oct. 2026',
      );
      await expect(
        (await findRow(page, 'Elena Dobre')).locator('.detail'),
      ).toHaveText('șofer + service · Service Dobre');
      await expect(
        (await findRow(page, 'Vlad Stan')).locator('.detail'),
      ).toHaveText('mecanic · Atelier Test');

      await expect(
        page.getByRole('heading', { name: 'Creștere, ultimele 12 luni' }),
      ).toBeVisible();
      await expect(page.locator('mf-admin-growth mf-line-chart')).toHaveCount(
        2,
      );
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`reads the seeded accounts and the growth in English on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await signInAsAdmin(page);
      // The seeded admin reads Romanian; only the language is changed, the
      // accounts still come from the seeded API.
      await page.route('**/api/v1/me', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          json: { ...(await response.json()), language: 'en' },
          response,
        });
      });
      await page.goto('/app/admin/users');

      await expect(page.locator('.totals')).toHaveText(
        /^[\d,]+ active drivers? · [\d,]+ garages? · [\d,]+ mechanics?$/,
      );
      await expect(
        page.getByRole('heading', { name: 'Recent accounts' }),
      ).toBeVisible();
      const suspended = await findRow(page, 'Radu Suspendat');
      await expect(suspended.locator('mf-lamp')).toHaveText(
        'suspended · since 2 Oct 2026',
      );
      await expect(
        (await findRow(page, 'Elena Dobre')).locator('.detail'),
      ).toHaveText('driver + garage · Service Dobre');
      await expect(
        (await findRow(page, 'Vlad Stan')).locator('.detail'),
      ).toHaveText('mechanic · Atelier Test');
      await expect(
        page.getByRole('heading', { name: 'Growth, last 12 months' }),
      ).toBeVisible();
      await expect(page.locator('mf-admin-growth mf-line-chart')).toHaveCount(
        2,
      );
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  test('sends a driver who types the address to their own dashboard', async ({
    page,
  }) => {
    await ready(page, '/ro/garages');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');

    await page.goto('/app/admin/users');

    await expect(page).toHaveURL('/app/driver');
  });
});

const ADMIN_CAPABILITIES = [
  'admin.garages',
  'admin.users',
  'admin.reviews',
  'admin.catalogue',
  'admin.settings',
  'admin.audit_history',
];

const item = (n: number) => ({
  carsCount: n % 3,
  count: { kind: 'requests', value: n },
  createdAt: '2026-03-12T09:14:00.000Z',
  garageName: null,
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `Cont ${n}`,
  roles: ['driver'],
  since: '2026-03-12T09:14:00.000Z',
  status: 'active',
});

// Twenty-five accounts, served twenty then five, as the API pages them.
async function stubAccounts(page: Page, language: 'ro' | 'en') {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ json: { accessToken: 'stubbed' } }),
  );
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        capabilities: ADMIN_CAPABILITIES,
        email: ACCOUNTS.admin,
        garageId: null,
        id: 'admin-1',
        landing: '/app/admin',
        language,
        name: 'Admin MotorFix',
        role: 'admin',
        roles: ['admin'],
      },
    }),
  );
  await page.route('**/api/v1/admin/overview', (route) =>
    route.fulfill({
      json: {
        activeDrivers: 12480,
        garagesApprovedThisMonth: 9,
        garagesListed: 214,
        garagesWaiting: 2,
      },
    }),
  );
  await page.route('**/api/v1/admin/growth', (route) =>
    route.fulfill({ json: { months: [] } }),
  );
  await page.route('**/api/v1/admin/accounts/summary', (route) =>
    route.fulfill({
      json: { activeDrivers: 12480, garagesListed: 214, mechanics: 531 },
    }),
  );
  await page.route(/\/api\/v1\/admin\/accounts(\?.*)?$/, (route) => {
    const next = new URL(route.request().url()).searchParams.has('cursor');
    const numbers = next
      ? [20, 21, 22, 23, 24]
      : Array.from({ length: 20 }, (_, n) => n);
    return route.fulfill({
      json: { items: numbers.map(item), nextCursor: next ? null : 'page-2' },
    });
  });
}

test.describe('the accounts view', () => {
  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    for (const [language, totals, heading] of [
      [
        'ro',
        '12.480 de șoferi activi · 214 service‑uri · 531 de mecanici',
        'Conturi recente',
      ],
      [
        'en',
        '12,480 active drivers · 214 garages · 531 mechanics',
        'Recent accounts',
      ],
    ] as const) {
      test(`loads the second page as the admin scrolls, in ${language} on ${device}`, async ({
        page,
      }) => {
        await page.setViewportSize({ height, width });
        await stubAccounts(page, language);

        await page.goto('/app/admin/users');

        await expect(page.locator('.totals')).toHaveText(totals);
        await expect(
          page.getByRole('heading', { name: heading }),
        ).toBeVisible();
        await expect(recent(page).locator('li.row').first()).toBeVisible();
        await recent(page).locator('li.row').last().scrollIntoViewIfNeeded();
        await expect(recent(page).locator('li.row')).toHaveCount(25);
        await expect(
          recent(page).locator('li.row').last().locator('.name'),
        ).toHaveText('Cont 24');
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});

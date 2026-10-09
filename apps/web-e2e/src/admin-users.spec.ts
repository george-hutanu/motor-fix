import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';

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

// The list is newest first and pages as its end comes into view. Bring the
// end into view, a page at a time, until the row has loaded or the list has
// truly ended (no sentinel left): no fixed number of tries.
async function findRow(page: Page, name: string) {
  const rows = recent(page).locator('li.row');
  const sentinel = recent(page).locator('.sentinel');
  const found = row(page, name);
  await expect(rows.first()).toBeVisible();
  while ((await found.count()) === 0 && (await sentinel.count()) > 0) {
    const before = await rows.count();
    await sentinel.scrollIntoViewIfNeeded();
    await expect
      .poll(
        async () =>
          (await found.count()) > 0 ||
          (await sentinel.count()) === 0 ||
          (await rows.count()) > before,
      )
      .toBe(true);
  }
  await expect(found).toHaveCount(1);
  return found;
}

// A driver of the test's own, signed up just before the view opens: newest
// first puts it on the first page however many accounts staging holds.
async function freshDriver(request: APIRequestContext) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = `Cont Recent ${tag}`;
  const signUp = await request.post('/api/v1/auth/sign-up', {
    data: {
      consent: CURRENT_CONSENT,
      email: `recent-${tag}@example.test`,
      language: 'ro',
      name,
      password: 'cont-recent-de-test-2026',
    },
    headers: { 'x-forwarded-for': `203.0.113.${Date.now() % 250}` },
  });
  expect(signUp.status()).toBe(201);
  return name;
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
    test(`shows the seeded admin the totals, a new account and the growth on ${device}`, async ({
      page,
      request,
    }) => {
      const name = await freshDriver(request);
      await page.setViewportSize({ height, width });
      await signInAsAdmin(page);
      await page.goto('/app/admin/users');

      await expect(page.locator('.totals')).toHaveText(
        /^[\d.]+ (de )?(șofer activ|șoferi activi) · [\d.]+ (de )?service(‑uri)? · [\d.]+ (de )?mecanici?$/,
      );

      const account = await findRow(page, name);
      await expect(account.locator('.detail')).toHaveText(
        'șofer · fără mașină',
      );
      await expect(account.locator('mf-lamp')).toHaveAttribute(
        'data-state',
        'green',
      );
      await expect(account.locator('mf-lamp')).toHaveText(
        /^activ · din \p{L}+\.? \d{4}$/u,
      );

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
    test(`reads a new account and the growth in English on ${device}`, async ({
      page,
      request,
    }) => {
      const name = await freshDriver(request);
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
      const account = await findRow(page, name);
      await expect(account.locator('.detail')).toHaveText('driver · no car');
      await expect(account.locator('mf-lamp')).toHaveText(
        /^active · since \p{L}+\.? \d{4}$/u,
      );
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

// The rows the seeded accounts used to give, served as the list's one page:
// a suspended driver, a driver who owns a garage, a mechanic.
const KINDS = [
  {
    ...item(1),
    name: 'Radu Suspendat',
    since: '2026-10-02T10:00:00.000Z',
    status: 'suspended',
  },
  {
    ...item(2),
    garageName: 'Service Dobre',
    name: 'Elena Dobre',
    roles: ['driver', 'garage'],
  },
  {
    ...item(3),
    garageName: 'Atelier Test',
    name: 'Vlad Stan',
    roles: ['mechanic'],
  },
];

// Twenty-five accounts, served twenty then five, as the API pages them;
// or the given items, as one page.
async function stubAccounts(
  page: Page,
  language: 'ro' | 'en',
  items?: unknown[],
) {
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
    if (items) return route.fulfill({ json: { items, nextCursor: null } });
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

  for (const [device, width, height] of [
    ['a 320 px phone', 320, 640],
    ['a desktop', 1280, 800],
  ] as const) {
    for (const [language, suspended, owner, mechanic] of [
      [
        'ro',
        'suspendat · din 2 oct. 2026',
        'șofer + service · Service Dobre',
        'mecanic · Atelier Test',
      ],
      [
        'en',
        'suspended · since 2 Oct 2026',
        'driver + garage · Service Dobre',
        'mechanic · Atelier Test',
      ],
    ] as const) {
      test(`reads a suspended account, a garage owner and a mechanic, in ${language} on ${device}`, async ({
        page,
      }) => {
        await page.setViewportSize({ height, width });
        await stubAccounts(page, language, KINDS);

        await page.goto('/app/admin/users');

        const radu = await findRow(page, 'Radu Suspendat');
        await expect(radu.locator('mf-lamp')).toHaveAttribute(
          'data-state',
          'red',
        );
        await expect(radu.locator('mf-lamp')).toHaveText(suspended);
        await expect(
          (await findRow(page, 'Elena Dobre')).locator('.detail'),
        ).toHaveText(owner);
        await expect(
          (await findRow(page, 'Vlad Stan')).locator('.detail'),
        ).toHaveText(mechanic);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});

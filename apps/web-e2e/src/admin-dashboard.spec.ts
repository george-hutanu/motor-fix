// @traces 879-FR-019
import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const ADMIN_CAPABILITIES = [
  'admin.garages',
  'admin.users',
  'admin.reviews',
  'admin.catalogue',
  'admin.settings',
  'admin.audit_history',
];

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const LISTED = 'Service\u2011uri listate';
const SOON_RO = [
  'Cereri de ofertă azi',
  'Rată de răspuns',
  'Programări',
  'Recenzii raportate',
];
const FIGURES = {
  activeDrivers: 12480,
  activeDriversMonthStart: 12168,
  garagesApprovedThisMonth: 9,
  garagesListed: 214,
  garagesWaiting: 2,
};

const panel = (page: Page) => page.locator('mf-admin-panel');
const tiles = (page: Page) => panel(page).getByRole('group');

// How many tiles share each row, read from their top edges.
const rows = async (page: Page) => {
  const tops = await tiles(page).evaluateAll((all) =>
    all.map((t) => Math.round(t.getBoundingClientRect().top)),
  );
  return tops.reduce<number[]>((counts, top, i) => {
    if (i > 0 && top === tops[i - 1]) counts[counts.length - 1] += 1;
    else counts.push(1);
    return counts;
  }, []);
};

const smallestText = (page: Page) =>
  tiles(page).evaluateAll((all) =>
    Math.min(
      ...all.flatMap((t) =>
        [...t.querySelectorAll<HTMLElement>('.label, .number, .line')].map(
          (e) => Number.parseFloat(getComputedStyle(e).fontSize),
        ),
      ),
    ),
  );

const stubAdmin = async (
  page: Page,
  language: 'ro' | 'en',
  figures: object = FIGURES,
) => {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ json: { accessToken: 'stubbed' } }),
  );
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        capabilities: ADMIN_CAPABILITIES,
        email: ACCOUNTS.admin,
        garageAccess: [],
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
    route.fulfill({ json: figures }),
  );
};

// Below 768 px the header has no sign-in button; the bottom bar's Cont tab opens the dialog.
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

test.describe('the admin dashboard @seeded', () => {
  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`shows the seeded admin the garages waiting on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await signInAsAdmin(page);

      await expect(
        page.getByText(
          'MotorFix · Toată țara · 2 service‑uri așteaptă verificarea',
        ),
      ).toBeVisible();
      await expect(
        page.getByText('ADMINISTRATOR', { exact: true }),
      ).toBeVisible();
      const menu =
        width < 768
          ? page.locator('mf-dashboard-tab-bar')
          : page.getByRole('navigation', { name: 'Meniu' });
      await expect(
        menu.getByRole('link', { name: 'Service‑uri, 2 în așteptare' }),
      ).toBeVisible();
      await expect(
        menu.getByRole('link', { name: /Utilizatori/ }),
      ).toBeVisible();
    });
  }

  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`shows the seeded admin the platform figures on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await signInAsAdmin(page);

      await expect(tiles(page)).toHaveCount(6);
      await expect(
        panel(page).getByRole('group', {
          exact: true,
          name: `${LISTED}, 8, +0 luna asta`,
        }),
      ).toBeVisible();
      await expect(
        panel(page).getByRole('group', {
          name: /^Șoferi activi, \d{1,3}(\.\d{3})*(, [+\u2212]\d{1,3}(\.\d{3})* luna asta)?$/,
        }),
      ).toBeVisible();
      for (const label of SOON_RO) {
        await expect(
          panel(page).getByRole('group', {
            exact: true,
            name: `${label}, în curând`,
          }),
        ).toBeVisible();
      }
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  test('shows the seeded admin the platform figures in English', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await signInAsAdmin(page);
    // The seeded admin reads Romanian; only the language is changed, the
    // figures still come from the seeded API.
    await page.route('**/api/v1/me', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        json: { ...(await response.json()), language: 'en' },
        response,
      });
    });
    await page.goto('/app/admin');

    await expect(tiles(page)).toHaveCount(6);
    await expect(
      panel(page).getByRole('group', {
        exact: true,
        name: 'Garages listed, 8, +0 this month',
      }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole('group', {
        name: /^Active drivers, \d{1,3}(,\d{3})*(, [+\u2212]\d{1,3}(,\d{3})* this month)?$/,
      }),
    ).toBeVisible();
    for (const label of [
      'Quote requests today',
      'Answer rate',
      'Bookings',
      'Reported reviews',
    ]) {
      await expect(
        panel(page).getByRole('group', {
          exact: true,
          name: `${label}, coming soon`,
        }),
      ).toBeVisible();
    }
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('keeps the header line on screen without sideways scroll at 320 px', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await signInAsAdmin(page);

    await expect(
      page.getByText(/2 service‑uri așteaptă verificarea/),
    ).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('sends a driver who types the admin address to their own dashboard', async ({
    page,
  }) => {
    await ready(page, '/ro/garages');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');

    await page.goto('/app/admin');

    await expect(page).toHaveURL('/app/driver');
  });

  test('sends a visitor who types the admin address home, with the sign-in dialog', async ({
    page,
  }) => {
    await page.goto('/app/admin');

    await expect(page).toHaveURL(/\/ro\/?$/);
    await expect(
      page
        .getByRole('dialog', { name: 'Autentificare' })
        .locator('mf-overlay-panel'),
    ).toBeVisible();
  });
});

test.describe('the admin dashboard in English', () => {
  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`reads the garages waiting in English on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await page.route('**/api/v1/auth/refresh', (route) =>
        route.fulfill({ json: { accessToken: 'stubbed' } }),
      );
      await page.route('**/api/v1/me', (route) =>
        route.fulfill({
          json: {
            capabilities: ADMIN_CAPABILITIES,
            email: ACCOUNTS.admin,
            garageAccess: [],
            garageId: null,
            id: 'admin-1',
            landing: '/app/admin',
            language: 'en',
            name: 'Admin MotorFix',
            role: 'admin',
            roles: ['admin'],
          },
        }),
      );
      await page.route('**/api/v1/admin/overview', (route) =>
        route.fulfill({ json: { garagesWaiting: 2 } }),
      );

      await page.goto('/app/admin');

      await expect(
        page.getByText(
          'MotorFix · Whole country · 2 garages are waiting for verification',
        ),
      ).toBeVisible();
      await expect(
        page.getByText('ADMINISTRATOR', { exact: true }),
      ).toBeVisible();
      const menu =
        width < 768
          ? page.locator('mf-dashboard-tab-bar')
          : page.getByRole('navigation', { name: 'Menu' });
      await expect(
        menu.getByRole('link', { name: 'Garages, 2 waiting' }),
      ).toBeVisible();
    });
  }
});

test('switches the admin header and counter to English without a reload', async ({
  page,
}) => {
  let language = 'ro';
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ json: { accessToken: 'stubbed' } }),
  );
  await page.route('**/api/v1/me', async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH')
      language = (request.postDataJSON() as { language: string }).language;
    await route.fulfill({
      json: {
        capabilities: ADMIN_CAPABILITIES,
        email: ACCOUNTS.admin,
        garageAccess: [],
        garageId: null,
        id: 'admin-1',
        landing: '/app/admin',
        language,
        name: 'Admin MotorFix',
        role: 'admin',
        roles: ['admin'],
      },
    });
  });
  await page.route('**/api/v1/admin/overview', (route) =>
    route.fulfill({ json: { garagesWaiting: 2 } }),
  );
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto('/app/admin');
  await expect(
    page.getByText(
      'MotorFix · Toată țara · 2 service‑uri așteaptă verificarea',
    ),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  await page
    .getByRole('group', { name: 'Limba' })
    .getByRole('button', { name: 'EN' })
    .click();

  await expect(
    page.getByText(
      'MotorFix · Whole country · 2 garages are waiting for verification',
    ),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Menu' })
      .getByRole('link', { name: 'Garages, 2 waiting' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
});

test.describe('the platform figures', () => {
  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`reads the six tiles in English on ${device}`, async ({ page }) => {
      await page.setViewportSize({ height, width });
      await stubAdmin(page, 'en');

      await page.goto('/app/admin');

      for (const name of [
        'Garages listed, 214, +9 this month',
        'Quote requests today, coming soon',
        'Answer rate, coming soon',
        'Bookings, coming soon',
        'Active drivers, 12,480, +312 this month',
        'Reported reviews, coming soon',
      ]) {
        await expect(
          panel(page).getByRole('group', { exact: true, name }),
        ).toBeVisible();
      }
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  for (const [device, width, height, perRow] of [
    ['a 320 px phone', 320, 640, [2, 2, 2]],
    ['a 390 px phone', 390, 844, [2, 2, 2]],
    ['a tablet', 800, 1024, [3, 3]],
    ['a desktop', 1280, 800, [6]],
  ] as const) {
    test(`lays the tiles out ${perRow.join('/')} on ${device}, text at 12 px or more, no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await stubAdmin(page, 'ro');

      await page.goto('/app/admin');
      await expect(
        panel(page).getByRole('group', {
          exact: true,
          name: 'Șoferi activi, 12.480, +312 luna asta',
        }),
      ).toBeVisible();

      expect(await rows(page)).toEqual(perRow);
      expect(await smallestText(page)).toBeGreaterThanOrEqual(12);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  const GRAFANA =
    'https://stack.grafana.invalid/d/motorfix-overview?var-env=test';
  for (const [device, width, height, language, name] of [
    [
      'a 320 px phone',
      320,
      640,
      'ro',
      'Observabilitate, se deschide într‑o filă nouă',
    ],
    ['a desktop', 1280, 800, 'en', 'Observability, opens in a new tab'],
  ] as const) {
    test(`links to the observability dashboards in a new tab on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await stubAdmin(page, language, {
        ...FIGURES,
        observabilityUrl: GRAFANA,
      });

      await page.goto('/app/admin');
      const link = panel(page).getByRole('link', { exact: true, name });

      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', GRAFANA);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }

  test('shows no observability link when the overview carries none', async ({
    page,
  }) => {
    await stubAdmin(page, 'ro');

    await page.goto('/app/admin');
    await expect(tiles(page)).toHaveCount(6);

    await expect(panel(page).getByRole('link')).toHaveCount(0);
  });
});

const GROWTH = {
  months: [
    ['2025-11', 6120, 96],
    ['2025-12', 6700, 104],
    ['2026-01', 7300, 118],
    ['2026-02', 8400, 130],
    ['2026-03', 9870, 141],
    ['2026-04', 10200, 152],
    ['2026-05', 10650, 163],
    ['2026-06', 11000, 170],
    ['2026-07', 11400, 181],
    ['2026-08', 11800, 190],
    ['2026-09', 12168, 205],
    ['2026-10', 12480, 214],
  ].map(([month, activeDrivers, garagesListed]) => ({
    activeDrivers,
    garagesListed,
    month,
  })),
};

const growth = (page: Page) => page.locator('mf-admin-growth');
const growthCharts = (page: Page) => growth(page).locator('mf-line-chart');

const stubGrowth = (page: Page) =>
  page.route('**/api/v1/admin/growth', (route) =>
    route.fulfill({ json: GROWTH }),
  );

// The two charts' top edges: equal when side by side.
const chartTops = (page: Page) =>
  growthCharts(page).evaluateAll((all) =>
    all.map((c) => Math.round(c.getBoundingClientRect().top)),
  );

test.describe('the growth panel @seeded', () => {
  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`shows the seeded admin twelve months of growth on ${device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await stubGrowth(page);
      await signInAsAdmin(page);

      const section = growth(page).getByRole('region', {
        exact: true,
        name: 'Creștere, ultimele 12 luni',
      });
      await expect(section).toBeVisible();
      await expect(
        section.getByRole('region', { exact: true, name: 'Șoferi activi' }),
      ).toBeVisible();
      await expect(
        section.getByRole('region', {
          exact: true,
          name: 'Service‑uri listate',
        }),
      ).toBeVisible();
      await expect(growth(page).locator('.latest')).toHaveText([
        '12.480',
        '214',
      ]);
      await expect(growth(page).locator('.range')).toHaveText([
        'nov. 2025 – oct. 2026',
        'nov. 2025 – oct. 2026',
      ]);

      const drivers = growthCharts(page).first();
      await drivers.getByRole('button', { name: 'Vezi ca tabel' }).click();
      await expect(
        drivers.getByRole('row', { name: 'martie 2026 9.870' }),
      ).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('the growth panel', () => {
  for (const [device, width, height] of [
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    test(`reads in English on ${device}`, async ({ page }) => {
      await page.setViewportSize({ height, width });
      await stubAdmin(page, 'en');
      await stubGrowth(page);

      await page.goto('/app/admin');

      await expect(
        growth(page).getByRole('region', {
          exact: true,
          name: 'Growth, last 12 months',
        }),
      ).toBeVisible();
      await expect(growth(page).locator('.latest')).toHaveText([
        '12,480',
        '214',
      ]);
      await expect(growth(page).locator('.range').first()).toHaveText(
        'Nov 2025 – Oct 2026',
      );
      const garages = growthCharts(page).nth(1);
      await garages.getByRole('button', { name: 'View as table' }).click();
      await expect(
        garages.getByRole('row', { name: 'March 2026 141' }),
      ).toBeVisible();
    });
  }

  test('shows retry when the read fails, and the charts once it answers', async ({
    page,
  }) => {
    await stubAdmin(page, 'ro');
    let calls = 0;
    await page.route('**/api/v1/admin/growth', (route) => {
      calls += 1;
      return calls === 1
        ? route.fulfill({
            json: { code: 'internal', message: 'x' },
            status: 500,
          })
        : route.fulfill({ json: GROWTH });
    });

    await page.goto('/app/admin');

    const retries = growth(page).getByRole('button', { name: 'Reîncearcă' });
    await expect(retries).toHaveCount(2);
    await expect(
      panel(page).getByRole('group', {
        exact: true,
        name: 'Șoferi activi, 12.480, +312 luna asta',
      }),
    ).toBeVisible();

    await retries.first().click();

    await expect(growth(page).locator('canvas')).toHaveCount(2);
    await expect(retries).toHaveCount(0);
    expect(calls).toBe(2);
  });

  for (const [device, width, height, side] of [
    ['a 320 px phone', 320, 640, false],
    ['a 390 px phone', 390, 844, false],
    ['a 768 px tablet', 768, 1024, true],
    ['a desktop', 1280, 800, true],
  ] as const) {
    test(`${side ? 'sets the charts side by side' : 'stacks the charts'} on ${device}, with no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await stubAdmin(page, 'ro');
      await stubGrowth(page);

      await page.goto('/app/admin');
      await expect(growth(page).locator('canvas')).toHaveCount(2);

      const [first, second] = await chartTops(page);
      if (side) expect(second).toBe(first);
      else expect(second).toBeGreaterThan(first);
      const smallest = await growth(page)
        .locator('.latest, .range')
        .evaluateAll((all) =>
          Math.min(
            ...all.map((e) => Number.parseFloat(getComputedStyle(e).fontSize)),
          ),
        );
      expect(smallest).toBeGreaterThanOrEqual(12);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});

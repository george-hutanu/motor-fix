// @traces 103-FR-006 103-FR-008 103-FR-009 103-FR-011 103-FR-012
import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// The suite also runs against a deployed address, so the demand is stubbed.
const DEMAND = {
  brands: [
    { name: 'Dacia', requests: 2140 },
    { name: 'Volkswagen', requests: 880 },
    { name: 'Renault', requests: 412 },
  ],
  firstDay: '2026-09-18',
  jobs: [
    { key: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne', requests: 1900 },
    {
      key: 'oil-change',
      nameEn: 'Oil change',
      nameRo: 'Schimb ulei',
      requests: 1532,
    },
  ],
  lastDay: '2026-10-17',
  requests: 3432,
};

const stubDemand = (page: Page) =>
  page.route('**/api/v1/admin/demand', (route) =>
    route.fulfill({ json: DEMAND }),
  );

async function signInAsAdmin(page: Page) {
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
  await signIn(page, ACCOUNTS.admin);
  await expect(page).toHaveURL('/app/admin');
}

// The seeded admin reads Romanian; only the language is changed.
async function inEnglish(page: Page) {
  await page.route('**/api/v1/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), language: 'en' },
      response,
    });
  });
}

// The table's rows render a moment after the press: read them until they
// match, never once.
const expectTable = async (
  page: Page,
  region: string,
  rows: readonly string[],
) => {
  const report = page.getByRole('region', { exact: true, name: region });
  await report
    .getByRole('button', { name: /^(Vezi ca tabel|View as table)$/ })
    .click();
  await expect
    .poll(() => report.locator('tbody tr').allInnerTexts())
    .toEqual(rows);
};

const COPY = {
  en: {
    brands: 'Requests by brand, 30 days',
    jobs: 'Requests by job, 30 days',
    rows: {
      brands: ['Dacia\t2,140', 'Volkswagen\t880', 'Renault\t412'],
      jobs: ['Brakes\t1,900', 'Oil change\t1,532'],
    },
    subtitle: 'What drivers asked for in the last 30 days',
  },
  ro: {
    brands: 'Cereri pe marcă, 30 de zile',
    jobs: 'Cereri pe lucrare, 30 de zile',
    rows: {
      brands: ['Dacia\t2.140', 'Volkswagen\t880', 'Renault\t412'],
      jobs: ['Frâne\t1.900', 'Schimb ulei\t1.532'],
    },
    subtitle: 'Ce au cerut șoferii în ultimele 30 de zile',
  },
} as const;

test.describe('requests by brand and by job @seeded', () => {
  for (const [device, width, height] of [
    ['a 320 px phone', 320, 640],
    ['a 390 px phone', 390, 844],
    ['a desktop', 1280, 800],
  ] as const) {
    for (const language of ['ro', 'en'] as const) {
      test(`shows both reports and the overview panel on ${device}, in ${language}`, async ({
        page,
      }) => {
        const copy = COPY[language];
        await page.setViewportSize({ height, width });
        await stubDemand(page);
        if (language === 'en') await inEnglish(page);
        await signInAsAdmin(page);

        const overview = page.locator('mf-admin-demand');
        await expect(
          overview.getByRole('region', { exact: true, name: copy.brands }),
        ).toBeVisible();
        await expect(
          overview.getByRole('region', { exact: true, name: copy.jobs }),
        ).toHaveCount(0);
        expect(await sideways(page)).toBeLessThanOrEqual(0);

        await page.goto('/app/admin/catalogue');
        await expect(page.getByText(copy.subtitle)).toBeVisible();
        await expectTable(page, copy.brands, copy.rows.brands);
        await expectTable(page, copy.jobs, copy.rows.jobs);
        // One column below 768 px, side by side from it.
        const [brands, jobs] = await Promise.all(
          [copy.brands, copy.jobs].map((name) =>
            page
              .getByRole('region', { exact: true, name })
              .boundingBox()
              .then((box) => box ?? { height: 0, width: 0, x: 0, y: 0 }),
          ),
        );
        if (width < 768)
          expect(jobs.y).toBeGreaterThanOrEqual(brands.y + brands.height);
        else {
          expect(Math.abs(jobs.y - brands.y)).toBeLessThan(1);
          expect(jobs.x).toBeGreaterThan(brands.x);
        }
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});

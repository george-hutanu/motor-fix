import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, hydrated, ready, settled, signIn } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

const LANGUAGES = ['ro', 'en'] as const;
const SCHEMES = ['light', 'dark'] as const;

async function signedIn(page: Page, email: string) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await page.waitForURL(/\/app\//);
}

// The consent bar asks again: its answer is kept in the browser.
async function consentUnanswered(page: Page) {
  await page.addInitScript(() => localStorage.removeItem('mf_consent'));
}

async function useLanguage(page: Page, language: 'ro' | 'en') {
  if (language === 'ro') return;
  await page
    .getByRole('group', { name: 'Limba' })
    .getByRole('button', { name: 'EN' })
    .click();
  await settled(page);
}

// Two boxes overlap when neither lies wholly to one side of the other.
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

// The consent bar's answers clear every tab of the tab bar.
async function barClearsTabs(page: Page, path: string) {
  const answers = page.locator('mf-consent-bar .answers');
  await expect(answers).toBeVisible();
  const box = await answers.boundingBox();
  expect(box).not.toBeNull();
  const tabs = await page.locator('mf-dashboard-tab-bar nav a').all();
  for (const link of tabs) {
    const tab = await link.boundingBox();
    expect(
      Boolean(box && tab && overlaps(box, tab)),
      `${path}: a tab under the bar`,
    ).toBe(false);
  }
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );

// The bar's and the tab bar's controls smaller than 44 x 44 px.
const smallControls = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'mf-consent-bar button, mf-consent-bar a, mf-dashboard-tab-bar nav a',
      ),
    ]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.width < 44 || r.height < 44);
      })
      .map((e) => e.textContent?.trim() ?? e.tagName),
  );

// @traces 248-launch-screens-accessible-FR-001
// @traces 248-launch-screens-accessible-FR-004
test.describe('the consent bar over the dashboard tab bar at 320 px @seeded', () => {
  for (const language of LANGUAGES) {
    for (const scheme of SCHEMES) {
      test(`keeps the tab bar's links clear and every control 44 px, ${language}, ${scheme}`, async ({
        page,
      }) => {
        await keepSeededLanguage(page);
        await consentUnanswered(page);
        await page.setViewportSize({ height: 568, width: 320 });
        await page.emulateMedia({ colorScheme: scheme });
        await signedIn(page, ACCOUNTS.garage);

        for (const path of [
          '/app/garage',
          '/app/garage/requests',
          '/app/garage/profile',
        ]) {
          await ready(page, path);
          await useLanguage(page, language);
          await barClearsTabs(page, path);
          expect(await noSidewaysScroll(page), path).toBe(true);
          expect(await smallControls(page), path).toEqual([]);
        }
      });
    }
  }
});

// Each core screen, with the overlays it opens.
const SCREENS: ReadonlyArray<{
  name: string;
  path: string;
  as?: string;
  open?: (page: Page) => Promise<void>;
}> = [
  { name: 'home', path: '/ro' },
  {
    name: 'the place dialog',
    open: (page) => page.locator('mf-home .place').getByRole('button').click(),
    path: '/ro',
  },
  {
    name: 'the sign-in sheet',
    open: (page) =>
      page.getByRole('button', { exact: true, name: 'Autentificare' }).click(),
    path: '/ro',
  },
  { name: 'the results', path: '/ro/garages?brand=dacia' },
  {
    name: 'a garage profile',
    path: '/ro/garages/service-auto-militari?brand=dacia',
  },
  {
    as: 'cerere@example.test',
    name: 'the quote request dialog',
    open: (page) => page.getByRole('button', { name: 'Cere ofertă' }).click(),
    path: '/ro/garages/service-auto-militari?brand=dacia',
  },
  { name: 'list your garage', path: '/ro/list-your-garage' },
  { name: 'contact', path: '/ro/contact' },
  {
    as: 'cerere@example.test',
    name: 'my requests',
    path: '/app/driver/requests',
  },
  {
    as: 'militari@example.test',
    name: 'the garage requests',
    path: '/app/garage/requests',
  },
  {
    as: 'militari@example.test',
    name: 'a garage request',
    open: (page) =>
      page
        .getByRole('button', { name: /^Deschide cererea / })
        .first()
        .click(),
    path: '/app/garage/requests',
  },
  {
    as: ACCOUNTS.garage,
    name: 'the garage profile',
    path: '/app/garage/profile',
  },
  {
    as: ACCOUNTS.admin,
    name: 'the garages to check',
    path: '/app/admin/garages',
  },
];

// @traces 248-launch-screens-accessible-FR-001
test.describe('the core screens at 320 px @seeded', () => {
  for (const screen of SCREENS.filter((s) => !s.open)) {
    test(`${screen.name} does not scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ height: 568, width: 320 });
      if (screen.as) await signedIn(page, screen.as);
      await ready(page, screen.path);

      expect(await noSidewaysScroll(page)).toBe(true);
    });
  }
});

// Opens a screen in a language, signed in as its account, its overlay open.
async function show(
  page: Page,
  screen: (typeof SCREENS)[number],
  language: 'ro' | 'en',
) {
  if (screen.as) await signedIn(page, screen.as);
  if (screen.path.startsWith('/app/')) {
    await ready(page, screen.path);
    await useLanguage(page, language);
  } else {
    await hydrated(page, screen.path.replace(/^\/ro/, `/${language}`));
  }
  if (!screen.open) return;
  await screen.open(page);
  await expect(page.getByRole('dialog').last()).toBeVisible();
}

// @traces 248-launch-screens-accessible-FR-003
// @traces 248-launch-screens-accessible-FR-007
// @traces 248-launch-screens-accessible-FR-008
test.describe('axe on the core screens @seeded', () => {
  for (const screen of SCREENS) {
    for (const language of LANGUAGES) {
      for (const scheme of SCHEMES) {
        test(`${screen.name}: no serious or critical issue, ${language}, ${scheme}`, async ({
          page,
        }) => {
          await keepSeededLanguage(page);
          await page.emulateMedia({ colorScheme: scheme });
          await show(page, screen, language);

          const found: Array<{
            id: string;
            impact?: string | null;
            nodes: unknown[];
          }> = await violations(page, { resultTypes: ['violations'] });
          expect(
            found
              .filter((v) => v.impact === 'serious' || v.impact === 'critical')
              .map((v) => `${v.id} (${v.nodes.length})`),
          ).toEqual([]);
        });
      }
    }
  }
});

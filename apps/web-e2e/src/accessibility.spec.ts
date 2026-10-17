import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, hydrated, PASSWORD, ready, signIn } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// Each test signs in once and walks its screens on the one page: the two
// schemes are switched with emulateMedia on the loaded screen, the language
// by the /:lang address (public screens) or the switch (dashboards), so the
// whole scan stays a few page loads per account.

type Language = 'ro' | 'en';
const LANGUAGES: readonly Language[] = ['ro', 'en'];
const SCHEMES = ['light', 'dark'] as const;
const PHONE = { height: 568, width: 320 };
const DESKTOP = { height: 720, width: 1280 };

const languageGroup = (page: Page) =>
  page.getByRole('group', { name: /^(Limba|Language)$/ });

// Signed in at desktop size, where the site bar shows its sign-in button;
// the dashboard is turned to Romanian whatever an earlier run left saved on
// the shared account, without saving it (keepSeededLanguage).
async function signedIn(page: Page, email: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await page.waitForURL(/\/app\//);
  await useLanguage(page, 'ro');
}

// A dashboard is drawn in the browser alone and the dev server keeps module
// requests open, so it is ready when its title is shown, not at networkidle.
async function dashboard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

// The dashboard's switch turns the page without a reload.
async function useLanguage(page: Page, language: Language) {
  const button = languageGroup(page).getByRole('button', {
    exact: true,
    name: language.toUpperCase(),
  });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

// The serious and critical axe findings on the page as it is now, in both
// schemes, each named with where it was seen and the elements it hit.
async function scan(page: Page, where: string): Promise<string[]> {
  const found: string[] = [];
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await settled(page);
    const seen = await violations(page, { resultTypes: ['violations'] });
    for (const v of seen) {
      if (v.impact !== 'serious' && v.impact !== 'critical') continue;
      const targets = v.nodes.map((n) => JSON.stringify(n.target)).join(' ');
      found.push(`${where}, ${scheme}: ${v.id} ${targets}`);
    }
  }
  await page.emulateMedia({ colorScheme: null });
  return found;
}

// Axe reads colours as they are drawn: an overlay still fading in, or a
// colour still easing to the new scheme, would read as low contrast.
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== 'running' ||
          a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
      ),
  );

const noSidewaysScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );

// Two boxes overlap when neither lies wholly to one side of the other.
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

// The tabs of the tab bar the consent bar's answers cover.
async function tabsUnderBar(page: Page) {
  const answers = page.locator('mf-consent-bar .answers');
  await expect(answers).toBeVisible();
  const box = await answers.boundingBox();
  expect(box).not.toBeNull();
  const covered: string[] = [];
  for (const link of await page.locator('mf-dashboard-tab-bar nav a').all()) {
    const tab = await link.boundingBox();
    if (box && tab && overlaps(box, tab))
      covered.push((await link.textContent())?.trim() ?? '?');
  }
  return covered;
}

// The bar's and the tab bar's controls smaller than 44 x 44 px; the
// privacy link inside the bar's sentence is running text (FR-001).
const smallControls = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'mf-consent-bar button, mf-dashboard-tab-bar nav a',
      ),
    ]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.width < 44 || r.height < 44);
      })
      .map((e) => e.textContent?.trim() ?? e.tagName),
  );

// What is wrong with the consent bar and the tab bar on the screen as it is.
async function barProblems(page: Page, where: string) {
  const found: string[] = [];
  const covered = await tabsUnderBar(page);
  if (covered.length) found.push(`${where}: under the bar ${covered}`);
  if (!(await noSidewaysScroll(page))) found.push(`${where}: scrolls sideways`);
  const small = await smallControls(page);
  if (small.length) found.push(`${where}: under 44 px ${small}`);
  return found;
}

// @traces 248-launch-screens-accessible-FR-001
// @traces 248-launch-screens-accessible-FR-004
test.describe('the consent bar over the dashboard tab bar at 320 px @seeded', () => {
  test("keeps the tab bar's links clear and every control 44 px, in both languages and schemes", async ({
    page,
  }) => {
    // The consent bar asks again: its answer is kept in the browser.
    await page.addInitScript(() => localStorage.removeItem('mf_consent'));
    await signedIn(page, ACCOUNTS.garage);
    await page.setViewportSize(PHONE);

    const found: string[] = [];
    for (const path of [
      '/app/garage',
      '/app/garage/requests',
      '/app/garage/profile',
    ]) {
      await dashboard(page, path);
      for (const language of LANGUAGES) {
        await useLanguage(page, language);
        for (const scheme of SCHEMES) {
          await page.emulateMedia({ colorScheme: scheme });
          found.push(
            ...(await barProblems(page, `${path} ${language} ${scheme}`)),
          );
        }
      }
      await useLanguage(page, 'ro');
    }
    expect(found).toEqual([]);
  });
});

// A public screen and the overlay it opens at its flow step, if any.
type Screen = {
  name: string;
  // The Romanian address; the English one swaps its first segment.
  path: string;
  open?: (page: Page) => Promise<void>;
};

// A sheet's dialog element draws no box of its own; its panel is what shows.
const dialogShown = (page: Page) =>
  expect(
    page.getByRole('dialog').last().locator('mf-overlay-panel'),
  ).toBeVisible();

const PUBLIC: readonly Screen[] = [
  { name: 'home', path: '/ro' },
  {
    name: 'the place dialog',
    open: (page) => page.locator('mf-home .place').getByRole('button').click(),
    path: '/ro',
  },
  {
    name: 'the sign-in sheet',
    open: (page) =>
      page
        .getByRole('button', {
          exact: true,
          name: /^(Autentificare|Sign in)$/,
        })
        .click(),
    path: '/ro',
  },
  { name: 'the results', path: '/ro/garages?brand=dacia' },
  {
    name: 'a garage profile',
    path: '/ro/garages/service-auto-militari?brand=dacia',
  },
  { name: 'list your garage', path: '/ro/list-your-garage' },
  { name: 'contact', path: '/ro/contact' },
];

const inLanguage = (path: string, language: Language) =>
  path.replace(/^\/ro/, `/${language}`);

// Scans a public screen in a language, its overlay open, then checks it at
// 320 px when it has no overlay.
async function visit(page: Page, screen: Screen, language: Language) {
  await page.setViewportSize(DESKTOP);
  await hydrated(page, inLanguage(screen.path, language));
  if (screen.open) {
    await screen.open(page);
    await dialogShown(page);
    return scan(page, `${screen.name} ${language}`);
  }
  const found = await scan(page, `${screen.name} ${language}`);
  await page.setViewportSize(PHONE);
  if (!(await noSidewaysScroll(page)))
    found.push(`${screen.name} ${language}: scrolls sideways at 320 px`);
  return found;
}

async function walk(page: Page, screens: readonly Screen[]) {
  const found: string[] = [];
  for (const screen of screens)
    for (const language of LANGUAGES)
      found.push(...(await visit(page, screen, language)));
  return found;
}

// @traces 248-launch-screens-accessible-FR-001
// @traces 248-launch-screens-accessible-FR-003
// @traces 248-launch-screens-accessible-FR-007
// @traces 248-launch-screens-accessible-FR-008
test.describe('axe on the core screens @seeded', () => {
  test('home and the overlays it opens', async ({ page }) => {
    expect(await walk(page, PUBLIC.slice(0, 3))).toEqual([]);
  });

  test('the results, a garage profile, list your garage and contact', async ({
    page,
  }) => {
    expect(await walk(page, PUBLIC.slice(3))).toEqual([]);
  });

  test("the driver's quote request dialog and my requests", async ({
    page,
  }) => {
    await signedIn(page, DRIVER);
    const found = await walk(page, [
      {
        name: 'the quote request dialog',
        open: (page) =>
          page
            .getByRole('button', { name: /^(Cere ofertă|Request a quote)$/ })
            .click(),
        path: '/ro/garages/service-auto-militari?brand=dacia',
      },
    ]);
    found.push(...(await dashboards(page, ['/app/driver/requests'])));
    expect(found).toEqual([]);
  });

  test('the garage requests and one request open', async ({
    page,
    request,
  }) => {
    await sendRequest(request);
    await signedIn(page, OWNER);
    const found = await dashboards(page, ['/app/garage/requests']);
    await page.setViewportSize(DESKTOP);
    for (const language of LANGUAGES) {
      await useLanguage(page, language);
      await page
        .getByRole('button', { name: /^(Deschide cererea|Open the request) / })
        .first()
        .click();
      await dialogShown(page);
      found.push(...(await scan(page, `a garage request ${language}`)));
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await useLanguage(page, 'ro');
    expect(found).toEqual([]);
  });

  test('the garage profile', async ({ page }) => {
    await signedIn(page, ACCOUNTS.garage);
    expect(await dashboards(page, ['/app/garage/profile'])).toEqual([]);
  });

  test('the garages to check', async ({ page }) => {
    await signedIn(page, ACCOUNTS.admin);
    expect(await dashboards(page, ['/app/admin/garages'])).toEqual([]);
  });
});

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, which ticks the oil service for Dacia.
const DRIVER = 'cerere@example.test';
const OWNER = 'militari@example.test';

async function bearer(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

// The owner's garage has one request waiting: the driver's oil service.
async function sendRequest(request: APIRequestContext) {
  const owner = await bearer(request, OWNER);
  const me = await request.get('/api/v1/me', { headers: owner });
  const { garageId } = (await me.json()) as { garageId: string };
  const jobs = await request.get('/api/v1/job-types?keys=oil-service');
  const [oil] = ((await jobs.json()) as { items: { id: string }[] }).items;
  const driver = await bearer(request, DRIVER);
  const cars = await request.get('/api/v1/cars', { headers: driver });
  const [car] = ((await cars.json()) as { items: { id: string }[] }).items;
  const res = await request.post('/api/v1/quote-requests', {
    data: {
      carId: car.id,
      description: 'Scârțâie la frânare',
      garageIds: [garageId],
      jobTypeIds: [oil.id],
      sources: ['profile_direct'],
    },
    headers: { ...driver, 'Idempotency-Key': randomUUID() },
  });
  expect(res.status()).toBe(201);
}

// Scans each dashboard screen in each language, then checks it at 320 px.
async function dashboards(page: Page, paths: readonly string[]) {
  const found: string[] = [];
  for (const path of paths) {
    await page.setViewportSize(DESKTOP);
    await dashboard(page, path);
    for (const language of LANGUAGES) {
      await useLanguage(page, language);
      found.push(...(await scan(page, `${path} ${language}`)));
    }
    await page.setViewportSize(PHONE);
    if (!(await noSidewaysScroll(page)))
      found.push(`${path}: scrolls sideways at 320 px`);
    await useLanguage(page, 'ro');
  }
  return found;
}

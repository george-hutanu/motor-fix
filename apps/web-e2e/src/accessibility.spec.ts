import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import {
  ACCOUNTS,
  hydrated,
  ownMap,
  PASSWORD,
  ready,
  signIn,
} from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';
import { JOBS, jpeg, KEPT } from './listing-kept.js';
import {
  accessToken,
  bearer,
  type QuotedRequest,
  quotedRequest,
} from './quoted-request.js';
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
async function signedIn(page: Page, email: string, password = PASSWORD) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email, { password });
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
    await calm(page);
    let seen = await violations(page, { resultTypes: ['violations'] });
    // A shared account's screen can change under the scan (another file's
    // quote adds a rising panel): a finding counts when a second, settled
    // scan sees it too.
    if (seen.length) {
      await calm(page);
      seen = await violations(page, { resultTypes: ['violations'] });
    }
    for (const v of seen) {
      if (v.impact !== 'serious' && v.impact !== 'critical') continue;
      const targets = v.nodes.map((n) => JSON.stringify(n.target)).join(' ');
      found.push(`${where}, ${scheme}: ${v.id} ${targets}`);
    }
  }
  await page.emulateMedia({ colorScheme: null });
  return found;
}

// Axe reads colours as they are drawn: an overlay still fading in, a panel
// still rising once its data came, or a colour still easing to the new
// scheme, would read as low contrast. The page is settled once no finite
// animation has run and no element has been added for half a second.
const calm = (page: Page) =>
  page.waitForFunction(
    () => {
      const w = window as typeof window & {
        mfCalm?: { since: number; watch: MutationObserver };
      };
      const now = performance.now();
      if (!w.mfCalm) {
        const state = {
          since: now,
          watch: new MutationObserver(() => {
            state.since = performance.now();
          }),
        };
        state.watch.observe(document.body, { childList: true, subtree: true });
        w.mfCalm = state;
      }
      const moving = document
        .getAnimations()
        .some(
          (a) =>
            a.playState === 'running' &&
            a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY,
        );
      if (moving) w.mfCalm.since = now;
      return now - w.mfCalm.since >= 500;
    },
    undefined,
    { polling: 50, timeout: 10_000 },
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
// privacy link inside the bar's sentence is running text, which the tap-size rule exempts.
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

// @traces 248-FR-001
// @traces 248-FR-004
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
        .getByRole('banner')
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

// @traces 248-FR-001
// @traces 248-FR-003
// @traces 248-FR-007
// @traces 248-FR-008
// Each finding is named with its screen, language, scheme and rule; the
// screen-reader run is the manual part of that record.
// @traces 248-FR-014
test.describe('axe on the core screens @seeded', () => {
  // One test per screen: both languages and schemes of four screens do not
  // fit one test's 30 s on a CI runner, and apart they run in parallel.
  for (const screen of PUBLIC)
    test(screen.name, async ({ page }) => {
      expect(await walk(page, [screen])).toEqual([]);
    });

  // @traces 1358-FR-011 1358-FR-012 1358-FR-014
  test('the results on a phone, with the list in its sheet', async ({
    page,
  }) => {
    const found: string[] = [];
    await page.setViewportSize({ height: 800, width: 320 });
    for (const language of LANGUAGES) {
      await hydrated(page, inLanguage('/ro/garages?brand=dacia', language));
      found.push(...(await scan(page, `the results at 320 px ${language}`)));
      if (!(await noSidewaysScroll(page)))
        found.push(`the results ${language}: scrolls sideways at 320 px`);
    }
    expect(found).toEqual([]);

    const handle = page.locator('mf-results-sheet button.handle');
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await expect(handle).toHaveAccessibleName('Show more of the list');
    const order = await page.evaluate(() => {
      const at = (selector: string) => document.querySelector(selector);
      const follows = (a: Element | null, b: Element | null) =>
        !!a &&
        !!b &&
        !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return [
        follows(at('h1'), at('mf-results-sheet button.handle')),
        follows(
          at('mf-results-sheet button.handle'),
          at('mf-results-sheet mf-brand-chips'),
        ),
        follows(
          at('mf-results-sheet mf-brand-chips'),
          at('mf-results-sheet .found'),
        ),
      ];
    });
    expect(order).toEqual([true, true, true]);
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
      // The quote is sent from the request, in a dialog over it.
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^(Trimite oferta|Send a quote)$/ })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(2);
      await dialogShown(page);
      found.push(...(await scan(page, `the send-quote dialog ${language}`)));
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(1);
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

  test('the garages to check and one file open', async ({ page }) => {
    await signedIn(page, ACCOUNTS.admin);
    const found = await dashboards(page, ['/app/admin/garages']);
    await page.setViewportSize(DESKTOP);
    // The open file covers the language switch: the language comes first.
    for (const language of LANGUAGES) {
      await dashboard(page, '/app/admin/garages');
      await useLanguage(page, language);
      await page.locator('mf-admin-queue a.open').first().click();
      await expect(page.locator('mf-verification-file')).toBeVisible();
      found.push(...(await scan(page, `a garage's file ${language}`)));
    }
    expect(found).toEqual([]);
  });
});

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, which ticks the oil service for Dacia.
const DRIVER = 'cerere@example.test';
const OWNER = 'militari@example.test';

// The owner's garage has one request waiting: the driver's oil service.
async function sendRequest(request: APIRequestContext) {
  const owner = bearer(await accessToken(request, OWNER));
  const me = await request.get('/api/v1/me', { headers: owner });
  const { garageId } = (await me.json()) as { garageId: string };
  const jobs = await request.get('/api/v1/job-types?keys=oil-service');
  const [oil] = ((await jobs.json()) as { items: { id: string }[] }).items;
  const driver = bearer(await accessToken(request, DRIVER));
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

// @traces 248-FR-001
// @traces 248-FR-003
// @traces 248-FR-007
// @traces 248-FR-008
test.describe('axe on the quotes a driver compares @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its driver, car and garages straight to PostgreSQL, which needs DATABASE_URL',
  );

  // A driver of its own with two quotes and one garage still to answer: the
  // seeded driver's requests are quoted and accepted by other specs.
  let quoted: QuotedRequest;
  test.beforeAll(async ({ request }) => {
    quoted = await quotedRequest(request, 'axe-oferte');
  });
  test.afterAll(async () => {
    await quoted?.remove();
  });

  test('the quotes compared, then one accepted', async ({ page }) => {
    await signedIn(page, quoted.driver, quoted.password);
    const rows = page.locator('mf-quotes-compare li[data-quote]');
    const found: string[] = [];
    for (const path of [
      '/app/driver',
      `/app/driver/requests?request=${quoted.requestId}`,
    ]) {
      await page.setViewportSize(DESKTOP);
      await dashboard(page, path);
      await expect(rows).toHaveCount(2);
      found.push(...(await quotesShown(page, `the quotes on ${path}`)));
    }

    // Accepting the first quote turns its row and locks the other.
    await page.setViewportSize(DESKTOP);
    await rows
      .first()
      .locator('[data-part="action"]')
      .getByRole('button')
      .click();
    await expect(
      rows.first().locator('[data-part="action"] .state'),
    ).toBeVisible();
    found.push(...(await quotesShown(page, 'a quote accepted')));
    expect(found).toEqual([]);
  });
});

// The quotes as shown, scanned in both languages, then checked at 320 px.
async function quotesShown(page: Page, where: string) {
  const found: string[] = [];
  for (const language of LANGUAGES) {
    await useLanguage(page, language);
    found.push(...(await scan(page, `${where} ${language}`)));
  }
  await page.setViewportSize(PHONE);
  if (!(await noSidewaysScroll(page)))
    found.push(`${where}: scrolls sideways at 320 px`);
  await useLanguage(page, 'ro');
  return found;
}

// The listing's language switch turns the page without a reload, so what is
// typed and shown stays; a click that does not scroll keeps the step.
async function listingLanguage(page: Page, language: Language) {
  await languageGroup(page)
    .first()
    .getByRole('button', { exact: true, name: language.toUpperCase() })
    .dispatchEvent('click');
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('mf-list-your-garage h1')).toBeVisible();
}

// The listing as it stands, scanned in both languages, back in Romanian.
async function listingScan(page: Page, where: string) {
  const found: string[] = [];
  for (const language of LANGUAGES) {
    await listingLanguage(page, language);
    found.push(...(await scan(page, `${where} ${language}`)));
  }
  await listingLanguage(page, 'ro');
  return found;
}

// @traces 248-FR-001
// @traces 248-FR-003
// @traces 248-FR-007
// @traces 248-FR-008
test.describe('axe on the listing steps', () => {
  // The place step's map draws the app's empty style.
  test.beforeEach(({ context }) => ownMap(context));

  test('every step filled in: what is missing, then complete', async ({
    context,
    page,
  }) => {
    // An upload and a server check, each screen in both languages.
    test.slow();
    await context.addInitScript((copy) => {
      if (sessionStorage.getItem('kept')) return;
      localStorage.setItem('mf.listing-draft', copy);
      sessionStorage.setItem('kept', '1');
    }, JSON.stringify(KEPT));
    await page.setViewportSize(DESKTOP);
    await ready(page, '/ro/list-your-garage');
    const email = page.locator('#listing-email');
    await email.fill(
      `axe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    );
    await email.blur();
    const photos = page.locator('mf-photos-step');
    // The photo picker opens once the draft exists on the server.
    await expect(
      photos.getByRole('button', { name: 'Alege fotografii' }),
    ).toBeEnabled();
    const mechanics = page.locator('mf-mechanics-step');
    await mechanics.getByRole('button', { name: 'Adaugă un mecanic' }).click();
    await mechanics.locator('input[name="name"]').fill('Ion Marin');
    const summary = page.locator('mf-missing-summary .summary');
    const send = page.locator('mf-list-your-garage .actions button.send');

    // Nothing chosen on the brands, prices or photos: every step shows what
    // it misses, and the summary lists it.
    await send.click();
    await expect(summary.locator('h2')).toBeVisible();
    const found = await listingScan(page, 'the listing, what is missing');

    await page
      .locator('mf-brands-step .chips > li > button', { hasText: 'Dacia' })
      .first()
      .click();
    const prices = page.locator('mf-prices-step');
    for (const [job, from, to] of [
      ['Manoperă, pe oră', '120', '200'],
      ...JOBS,
    ]) {
      await prices
        .getByRole('textbox', { exact: true, name: `${job}, de la` })
        .fill(from);
      await prices
        .getByRole('textbox', { exact: true, name: `${job}, până la` })
        .fill(to);
    }
    await photos
      .locator('input[type="file"]')
      .setInputFiles([jpeg('fata.jpg')]);
    await expect(photos.locator('li.photo')).toHaveCount(1);
    await expect(summary.getByRole('button')).toHaveCount(0);
    await send.click();
    await expect(summary).toHaveText('Totul e complet');
    found.push(...(await listingScan(page, 'the listing, complete')));

    // At 320 px the steps fold into a bar; open, its list scrolls nothing.
    await page.setViewportSize(PHONE);
    if (!(await noSidewaysScroll(page)))
      found.push('the listing: scrolls sideways at 320 px');
    await page.locator('nav > button[aria-expanded]').click();
    if (!(await noSidewaysScroll(page)))
      found.push('the listing, steps open: scrolls sideways at 320 px');
    expect(found).toEqual([]);
  });

  // A link to a draft ends the page when the draft is unknown, or already
  // sent; the API answers the second here, which no seed holds.
  for (const [name, status] of [
    ['an unknown draft link', 404],
    ['a draft already sent', 409],
  ] as const)
    test(name, async ({ page }) => {
      await page.route('**/api/v1/listing-drafts/current', (route) =>
        route.fulfill({ json: { code: 'draft' }, status }),
      );
      const found: string[] = [];
      for (const language of LANGUAGES) {
        await page.setViewportSize(DESKTOP);
        await hydrated(
          page,
          `/${language}/list-your-garage?draft=${'a'.repeat(43)}`,
        );
        await expect(
          page.locator('mf-list-your-garage .ended h1'),
        ).toBeVisible();
        found.push(...(await scan(page, `${name} ${language}`)));
        await page.setViewportSize(PHONE);
        if (!(await noSidewaysScroll(page)))
          found.push(`${name} ${language}: scrolls sideways at 320 px`);
      }
      expect(found).toEqual([]);
    });
});

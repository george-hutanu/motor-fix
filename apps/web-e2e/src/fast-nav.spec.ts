// @traces 1193-FR-002 1193-FR-003 1193-FR-004 1193-FR-006 1193-FR-010
import { expect, type Page } from '@playwright/test';

import { hydrated } from './accounts.js';
import { test } from './fixtures.js';

// Full Chromium with the back/forward cache left on: Playwright turns it off
// by default, and the headless shell never restores from it.
test.use({
  channel: 'chromium',
  launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] },
});

const RESULTS = '/ro/garages?brand=dacia';
const PROFILE = '/ro/garages/service-auto-militari';
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

// Each view transition the page starts, and whether the app skipped it.
const watchTransitions = (page: Page) =>
  page.addInitScript(() => {
    const seen = { skipped: 0, started: 0 };
    (window as { __transitions?: typeof seen }).__transitions = seen;
    const start = Document.prototype.startViewTransition;
    if (!start) return;
    Document.prototype.startViewTransition = function (
      this: Document,
      ...args: Parameters<typeof start>
    ) {
      const transition = start.apply(this, args);
      seen.started++;
      const skip = transition.skipTransition.bind(transition);
      transition.skipTransition = () => {
        seen.skipped++;
        skip();
      };
      return transition;
    };
  });
const transitions = (page: Page) =>
  page.evaluate(
    () =>
      (window as { __transitions?: { skipped: number; started: number } })
        .__transitions,
  );

test.describe('fast navigation on the public pages @seeded', () => {
  test('returns from a profile to the same results at the same place, with no loading', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 480, width: 390 });
    await hydrated(page, RESULTS);
    const view = page.getByRole('link', { name: 'Vezi service‑ul' }).last();
    await view.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => Math.round(window.scrollY));
    expect(before).toBeGreaterThan(0);

    await view.click();
    await expect(heading(page)).toBeVisible();
    await page.goBack();

    await expect(page).toHaveURL(RESULTS);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(before);
  });

  test('comes back from another page out of the back/forward cache', async ({
    page,
  }) => {
    const response = await page.goto(RESULTS);
    expect(response?.headers()['cache-control'] ?? '').not.toContain(
      'no-store',
    );
    await hydrated(page);
    await page.evaluate(() => {
      addEventListener('pageshow', (e) => {
        (window as { __persisted?: boolean }).__persisted = e.persisted;
      });
    });

    await page.goto(PROFILE);
    await hydrated(page);
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForFunction(
      () => (window as { __persisted?: boolean }).__persisted !== undefined,
    );

    expect(
      await page.evaluate(() => ({
        persisted: (window as { __persisted?: boolean }).__persisted,
        reasons:
          (
            performance.getEntriesByType(
              'navigation',
            )[0] as PerformanceNavigationTiming & {
              notRestoredReasons?: { reasons?: unknown[] } | null;
            }
          )?.notRestoredReasons?.reasons ?? [],
      })),
    ).toEqual({ persisted: true, reasons: [] });
  });

  test('grows the garage name from its card into the profile', async ({
    page,
  }) => {
    await watchTransitions(page);
    await hydrated(page, RESULTS);

    await page.getByRole('link', { name: 'Vezi service‑ul' }).first().click();
    await expect(heading(page)).toBeVisible();

    // Chromium has had view transitions since 111.
    expect(await transitions(page)).toEqual({ skipped: 0, started: 1 });
    await expect(heading(page)).toHaveCSS('view-transition-name', /^garage-/);
  });

  test('moves nothing when the device asks for reduced motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await watchTransitions(page);
    await hydrated(page, RESULTS);

    await page.getByRole('link', { name: 'Vezi service‑ul' }).first().click();
    await expect(heading(page)).toBeVisible();

    const seen = await transitions(page);
    expect(seen?.skipped).toBe(seen?.started);
  });

  test('opens the map tiles ahead of time on the results only, and loads the heading font for the language', async ({
    request,
    baseURL,
  }) => {
    const head = async (path: string) => {
      const html = await (await request.get(path)).text();
      return html.slice(0, html.indexOf('</head>'));
    };
    const results = await head('/ro/garages');
    const profile = await head(PROFILE);
    const english = await head('/en');
    const own = new URL(baseURL ?? 'http://localhost').origin;

    expect(results).toContain(
      '<link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin>',
    );
    expect(profile).not.toContain('tiles.openfreemap.org');
    expect(results).not.toContain(`rel="preconnect" href="${own}"`);
    expect(profile).toMatch(
      /rel="preload" as="font"[^>]*michroma-latin-ext-400-normal/,
    );
    expect(english).toMatch(
      /rel="preload" as="font"[^>]*michroma-latin-400-normal/,
    );
  });

  // @traces 1193-FR-011
  test('keeps the results and the profile inside a 320 px phone, before and after going back', async ({
    page,
  }) => {
    const sideways = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
    await page.setViewportSize({ height: 640, width: 320 });
    await hydrated(page, RESULTS);
    expect(await sideways()).toBeLessThanOrEqual(0);

    await page.getByRole('link', { name: 'Vezi service‑ul' }).first().click();
    await expect(heading(page)).toBeVisible();
    expect(await sideways()).toBeLessThanOrEqual(0);

    await page.goBack();
    await expect(page).toHaveURL(RESULTS);
    expect(await sideways()).toBeLessThanOrEqual(0);
  });
});

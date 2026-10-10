import { type BrowserContext, expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, settled, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { clearConsentCounts } from './global-setup.js';

const KEY = 'mf_consent';
const VERSION = '2026-10-10';
const DAY = 86_400_000;

const TEXT = {
  en: {
    accept: 'Accept',
    bar: 'Usage statistics',
    refuse: 'Refuse',
    save: 'Save',
    settings: 'Cookie settings',
  },
  ro: {
    accept: 'Accept',
    bar: 'Statistici de utilizare',
    refuse: 'Refuz',
    save: 'Salvează',
    settings: 'Setări cookie',
  },
} as const;

// Answers plausible.io here, so nothing leaves, and counts every call: the
// script itself and each page view the stand-in script sends.
async function analyticsCalls(target: BrowserContext | Page) {
  const calls: string[] = [];
  await target.route('https://plausible.io/**', (route) => {
    calls.push(route.request().url());
    if (route.request().url().endsWith('.js')) {
      return route.fulfill({
        body: `(() => {
          const send = (name, options) => fetch('https://plausible.io/api/event', {
            body: JSON.stringify({ n: name, u: options && options.u }),
            method: 'POST',
          });
          const queued = (window.plausible && window.plausible.q) || [];
          window.plausible = send;
          for (const args of queued) send(...args);
        })();`,
        contentType: 'text/javascript',
      });
    }
    return route.fulfill({ status: 202 });
  });
  return calls;
}

const bar = (page: Page, language: 'ro' | 'en') =>
  page.getByRole('region', { name: TEXT[language].bar });

const signOut = (page: Page) =>
  page.getByRole('button', { name: /^(Ieși din cont|Sign out)$/ });

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const seed = (page: Page, choice: object) =>
  page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [KEY, JSON.stringify(choice)] as const,
  );

const choice = (at: number, textVersion = VERSION) => ({
  accountId: null,
  at: new Date(at).toISOString(),
  browserConsentId: crypto.randomUUID(),
  decision: 'granted',
  language: 'ro',
  pending: false,
  textVersion,
});

// @traces 244-FR-001 244-FR-003 244-FR-004 244-FR-013 244-FR-017
// The api stores 20 choices an hour from one address, and every spec that
// answers the bar stores one from the suite's: each flow here starts with
// that count cleared, so its own records are taken.
test.beforeEach(clearConsentCounts);

test.describe('the consent bar on a first visit', () => {
  for (const language of ['ro', 'en'] as const) {
    for (const path of ['', '/garages', '/list-your-garage']) {
      test(`asks before any analytics on /${language}${path}`, async ({
        page,
      }) => {
        const calls = await analyticsCalls(page);
        await ready(page, `/${language}${path}`);

        await expect(bar(page, language)).toBeVisible();
        expect(calls).toEqual([]);
      });
    }

    test(`counts the page once accepted and asks no more, ${language}`, async ({
      page,
    }) => {
      const calls = await analyticsCalls(page);
      await ready(page, `/${language}`);

      await bar(page, language)
        .getByRole('button', { exact: true, name: TEXT[language].accept })
        .click();

      await expect.poll(() => calls.length).toBeGreaterThan(0);
      await expect(bar(page, language)).toBeHidden();
      await page.reload();
      await settled(page);
      await expect(bar(page, language)).toBeHidden();
    });

    test(`loads nothing after a refusal, before or after a reload, ${language}`, async ({
      page,
    }) => {
      const calls = await analyticsCalls(page);
      await ready(page, `/${language}`);

      await bar(page, language)
        .getByRole('button', { exact: true, name: TEXT[language].refuse })
        .click();
      await expect(bar(page, language)).toBeHidden();
      await page.reload();
      await settled(page);

      await expect(bar(page, language)).toBeHidden();
      expect(calls).toEqual([]);
    });
  }

  test('leaves the page usable while the bar is ignored', async ({ page }) => {
    const calls = await analyticsCalls(page);
    await ready(page, '/ro');

    await page
      .getByRole('link', { exact: true, name: 'Înscrie‑ți service‑ul' })
      .first()
      .click();
    await expect(page).toHaveURL('/ro/list-your-garage');
    await settled(page);

    await expect(bar(page, 'ro')).toBeVisible();
    expect(calls).toEqual([]);
  });

  // @traces 244-FR-002
  for (const width of [320, 390]) {
    test(`sits above the tab bar on a ${width} px phone, covering nothing`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 640, width });
      await ready(page, '/ro/garages');
      const region = bar(page, 'ro');
      await expect(region).toBeVisible();

      const box = await region.boundingBox();
      const tabs = await page.locator('mf-public-tab-bar').boundingBox();
      expect(box && tabs && box.y + box.height).toBeLessThanOrEqual(
        (tabs?.y ?? 0) + 1,
      );
      for (const name of [TEXT.ro.accept, TEXT.ro.refuse]) {
        const button = await region
          .getByRole('button', { exact: true, name })
          .boundingBox();
        expect(button?.height).toBeGreaterThanOrEqual(44);
      }
      expect(await noSideScroll(page)).toBe(true);
    });
  }
});

// @traces 244-FR-006 244-FR-007 244-FR-017
test.describe('cookie settings', () => {
  async function flip(page: Page, language: 'ro' | 'en') {
    const { bar: name, save, settings } = TEXT[language];
    await page.getByRole('button', { exact: true, name: settings }).click();
    const dialog = page.getByRole('dialog', { name: settings });
    await dialog.getByRole('switch', { name }).click();
    await dialog.getByRole('button', { exact: true, name: save }).click();
    await expect(dialog).toBeHidden();
  }

  for (const language of ['ro', 'en'] as const) {
    test(`turn analytics off from the footer and on again, ${language}`, async ({
      page,
    }) => {
      const calls = await analyticsCalls(page);
      await ready(page, `/${language}`);
      await bar(page, language)
        .getByRole('button', { exact: true, name: TEXT[language].accept })
        .click();
      await expect.poll(() => calls.length).toBeGreaterThan(0);

      await flip(page, language);
      const off = calls.length;

      await page.goto(`/${language}/list-your-garage`);
      await settled(page);
      expect(calls.length).toBe(off);

      await flip(page, language);
      await expect.poll(() => calls.length).toBeGreaterThan(off);
    });
  }

  test('a second tab follows a saved choice without a reload', async ({
    context,
  }) => {
    const calls = await analyticsCalls(context);
    const first = await context.newPage();
    const second = await context.newPage();
    await ready(first, '/ro');
    await ready(second, '/ro');

    await bar(first, 'ro')
      .getByRole('button', { exact: true, name: 'Refuz' })
      .click();

    await expect(bar(second, 'ro')).toBeHidden();
    expect(calls).toEqual([]);
  });
});

// @traces 244-FR-005
test.describe('asking again', () => {
  for (const [label, at, version] of [
    ['made under an older text', Date.now() - DAY, '2025-01-01'],
    ['365 days old', Date.now() - 365 * DAY - 60_000, VERSION],
  ] as const) {
    test(`asks again over a choice ${label}, and not after the new answer`, async ({
      page,
    }) => {
      const calls = await analyticsCalls(page);
      await seed(page, choice(at, version));
      await ready(page, '/ro');

      await expect(bar(page, 'ro')).toBeVisible();
      expect(calls).toEqual([]);

      await bar(page, 'ro')
        .getByRole('button', { exact: true, name: 'Refuz' })
        .click();
      await page.reload();
      await settled(page);
      await expect(bar(page, 'ro')).toBeHidden();
    });
  }
});

// @traces 244-FR-001 244-FR-006 244-FR-017
test.describe('a garage profile and the dashboard @seeded', () => {
  for (const language of ['ro', 'en'] as const) {
    test(`asks before any analytics on a garage profile, ${language}`, async ({
      page,
    }) => {
      const calls = await analyticsCalls(page);
      await ready(page, `/${language}/garages/service-auto-militari`);

      await expect(bar(page, language)).toBeVisible();
      expect(calls).toEqual([]);
    });
  }

  // The visitor's choice is newer than any the account holds, so it applies
  // whatever another test left on the account.
  test("turns analytics off from the driver's Setări", async ({ page }) => {
    const calls = await analyticsCalls(page);
    await ready(page, '/ro');
    await bar(page, 'ro')
      .getByRole('button', { exact: true, name: 'Accept' })
      .click();
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');
    // Signed in from a public page, whose live stream never ends: no
    // networkidle comes, so wait for the dashboard to be drawn.
    await expect(signOut(page)).toBeVisible();
    await expect(bar(page, 'ro')).toBeHidden();
    await expect.poll(() => calls.length).toBeGreaterThan(0);

    // The driver's dashboard holds its live stream open, so no networkidle
    // comes here either: wait for what the step reads.
    await page.goto('/app/driver/settings');
    await page
      .getByRole('button', { exact: true, name: 'Setări cookie' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Setări cookie' });
    await dialog
      .getByRole('switch', { name: 'Statistici de utilizare' })
      .click();
    await dialog.getByRole('button', { exact: true, name: 'Salvează' }).click();
    await expect(dialog).toBeHidden();
    const off = calls.length;

    // A page view goes at the end of the navigation, before the dashboard
    // asks for its requests; once those are drawn, none can still come.
    const drawn = page.waitForResponse('**/api/v1/requests');
    await page.goto('/app/driver');
    await drawn;
    await expect(signOut(page)).toBeVisible();
    expect(calls.length).toBe(off);
  });
});

// @traces 244-FR-012
// The account's newer choice applies at every sign-in and full load, and the
// driver's Setări flow above turns analytics off on ACCOUNTS.driver while
// this one may be running: this flow keeps an account no other flow records
// a choice on.
test.describe('the account carries the choice @seeded', () => {
  test('a choice made before sign-in applies on a fresh browser after sign-in', async ({
    browser,
    page,
  }) => {
    await analyticsCalls(page);
    await ready(page, '/ro');
    await bar(page, 'ro')
      .getByRole('button', { exact: true, name: 'Accept' })
      .click();
    // The visitor's choice goes on the account once the session is known;
    // the fresh browser can only find it there after that.
    const bound = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/me/consents') &&
        response.request().method() === 'POST',
    );
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.otherDriver);
    await expect(page).toHaveURL('/app/driver');
    // Signed in from a public page, whose live stream never ends: no
    // networkidle comes, so wait for the dashboard to be drawn.
    await expect(signOut(page)).toBeVisible();
    expect((await bound).ok()).toBe(true);

    const other = await browser.newContext();
    const calls = await analyticsCalls(other);
    const fresh = await other.newPage();
    await ready(fresh, '/ro');
    await expect(bar(fresh, 'ro')).toBeVisible();
    await fresh
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(fresh, ACCOUNTS.otherDriver);
    await expect(fresh).toHaveURL('/app/driver');

    await expect.poll(() => calls.length).toBeGreaterThan(0);
    await expect(
      fresh.getByRole('region', {
        name: /^(Statistici de utilizare|Usage statistics)$/,
      }),
    ).toBeHidden();
    await other.close();
  });
});

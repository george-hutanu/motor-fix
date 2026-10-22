import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
} from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { accessToken } from './platform-rules.js';

type State = { enabled: boolean; pinned: boolean };
type Row = State & { voice: number };

// The restore runs after a test has left the request's keep-alive socket idle
// for longer than the server keeps it; only a reset socket is retried.
const RESET = { maxRetries: 2 };

async function voices(request: APIRequestContext) {
  const headers = { Authorization: `Bearer ${await accessToken(request)}` };
  const read = await request.get('/api/v1/admin/copy-voices', {
    ...RESET,
    headers,
  });
  expect(read.ok()).toBe(true);
  const rows = ((await read.json()) as { voices: Row[] }).voices;
  const change = async (row: Row, next: State) => {
    const saved = await request.patch(
      `/api/v1/admin/copy-voices/${row.voice}`,
      {
        ...RESET,
        data: { ...next, seen: { enabled: row.enabled, pinned: row.pinned } },
        headers,
      },
    );
    expect(saved.ok()).toBe(true);
  };
  return { change, rows };
}

// Every voice back on and none pinned, so the round and the other flows read
// the settings they expect: the pin comes off first, since a pinned voice
// cannot be switched.
async function restore(request: APIRequestContext) {
  let { change, rows } = await voices(request);
  for (const row of rows.filter((r) => r.pinned))
    await change(row, { enabled: true, pinned: false });
  ({ change, rows } = await voices(request));
  for (const row of rows.filter((r) => !r.enabled))
    await change(row, { enabled: true, pinned: false });
}

async function set(request: APIRequestContext, voice: number, next: State) {
  const { change, rows } = await voices(request);
  await change(rows[voice - 1], next);
}

const headline = (page: Page) =>
  page.locator('mf-home .hero h2').filter({ visible: true });
const mark = (page: Page) => page.locator('html');

// A visit on a device of its own, which has read the settings once the app
// has asked for them; contexts here skip the fixtures' voice 1.
async function visit(browser: Browser, init?: () => void) {
  const context = await browser.newContext();
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const read = page.waitForResponse((res) =>
    res.url().includes('/api/v1/copy-voices'),
  );
  await page.goto('/ro');
  await read;
  return { context, page };
}

test.describe('switching copy voices off and pinning one @seeded', () => {
  // Every test changes the same five settings, which the round in
  // copy-voice.spec.ts reads: this file runs in the platform rules project,
  // alone.
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(({ request }) => restore(request));
  test.afterEach(({ request }) => restore(request));

  // @traces 010-FR-012
  // @traces 010-FR-013
  test('an admin switches a voice off and pins another in Setări', async ({
    page,
    request,
  }) => {
    await ready(page, '/ro');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.admin);
    await expect(page).toHaveURL('/app/admin');
    await page.goto('/app/admin/settings');
    const section = page.locator('mf-copy-voices');
    await expect(
      section.getByRole('heading', { name: 'Voci de text' }),
    ).toBeVisible();
    const rules = await page.locator('mf-platform-rules').boundingBox();
    const box = await section.boundingBox();
    expect(rules?.y ?? 0).toBeLessThan(box?.y ?? 0);

    const four = section.getByRole('switch', { name: '4 · Cu zâmbet' });
    await four.click();
    await expect(four).toHaveAttribute('aria-checked', 'false');
    await expect(
      section.locator('li').nth(3).getByRole('button', {
        name: 'Fixează pentru toți',
      }),
    ).toBeDisabled();

    await section
      .locator('li')
      .nth(4)
      .getByRole('button', { name: 'Fixează pentru toți' })
      .click();
    await expect(
      section.locator('li').nth(4).getByRole('button', {
        name: 'Scoate fixarea',
      }),
    ).toBeVisible();
    await expect(section.locator('li').nth(0)).toContainText(
      'în pauză cât e fixată vocea 5',
    );
    await expect(
      section.getByRole('switch', { name: '5 · Fără surprize' }),
    ).toBeDisabled();

    await expect
      .poll(async () =>
        (await voices(request)).rows.map((r) => [r.enabled, r.pinned]),
      )
      .toEqual([
        [true, false],
        [true, false],
        [true, false],
        [false, false],
        [true, true],
      ]);
  });

  // @traces 010-FR-010
  // @traces 010-FR-011
  test('an open page leaves a voice switched off, and new visits never get it', async ({
    browser,
    request,
  }) => {
    const { context, page } = await visit(browser, () => {
      localStorage.setItem('mf-copy', '4');
      localStorage.setItem('mf-copy-at', String(Date.now()));
    });
    await expect(mark(page)).toHaveAttribute('data-voice', '4');
    await expect(headline(page)).toHaveText(/merită mai mult/);
    // The public stream opens once the page has settled.
    await page.waitForRequest((req) =>
      req.url().includes('/api/v1/live/public'),
    );

    await set(request, 4, { enabled: false, pinned: false });

    // The page has 2 s from the change reaching it; the worker's
    // relay of the event to the stream comes before that.
    await expect(mark(page)).not.toHaveAttribute('data-voice', '4', {
      timeout: 5_000,
    });
    await expect(headline(page)).not.toHaveText(/merită mai mult/);
    await context.close();

    // A device that has read the settings: every voice its loads draw, as
    // the page head marks it before the first paint, is one that is on. The
    // script runs before <html> exists, so it watches the whole document.
    const device = await visit(browser, () => {
      const marks: string[] = [];
      (window as unknown as { marks: string[] }).marks = marks;
      new MutationObserver(() =>
        marks.push(document.documentElement.getAttribute('data-voice') ?? ''),
      ).observe(document, { attributeFilter: ['data-voice'], subtree: true });
    });
    for (let i = 0; i < 5; i++) {
      await device.page.waitForTimeout(2_600);
      await device.page.goto('/ro');
      const drawn = await device.page.evaluate(
        () => (window as unknown as { marks: string[] }).marks,
      );
      expect(drawn.length).toBeGreaterThan(0);
      expect(drawn).not.toContain('4');
    }
    await device.context.close();
  });

  // @traces 010-FR-010
  test('with a voice pinned every new visit shows it, and the round resumes when the pin comes off', async ({
    browser,
    request,
  }) => {
    await set(request, 5, { enabled: true, pinned: true });

    // The first load stores the settings; every visit after it takes a new
    // voice once the 2.5 s of a quick reload are past.
    const { context, page } = await visit(browser);
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(2_600);
      await page.goto('/ro');
      await expect(mark(page)).toHaveAttribute('data-voice', '5');
      await expect(headline(page)).toHaveText(/Știi cât costă/);
    }
    await context.close();

    await set(request, 5, { enabled: true, pinned: false });

    const after = await visit(browser);
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await after.page.waitForTimeout(2_600);
      await after.page.goto('/ro');
      seen.add((await mark(after.page).getAttribute('data-voice')) ?? '');
    }
    expect(seen.size).toBeGreaterThan(1);
    await after.context.close();
  });
});

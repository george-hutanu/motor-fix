import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, hydrated, signIn } from './accounts.js';
import { test } from './fixtures.js';

// @traces 1200-FR-001
// @traces 1200-FR-005
// @traces 1200-FR-007

type Read = { method: string; path: string; token: boolean };

// Every call the browser makes to the web app's own API, and its ready check,
// from the first byte of the page on.
function reads(page: Page) {
  const seen: Read[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/health/ready')
      return;
    seen.push({
      method: request.method(),
      path: url.pathname,
      token: request.headers()['authorization'] !== undefined,
    });
  });
  return seen;
}

// Angular reports a server-rendered view it could not take over as NG05xx;
// an answer arriving after the first render would cause one.
function hydrationErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /NG05\d\d/.test(message.text()))
      errors.push(message.text());
  });
  return errors;
}

const PROFILE = '/ro/garages/service-auto-militari?brand=dacia';
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

// Reads only the browser makes, by design: the maintenance flag must be
// fresh, Home's count is never read on the server, and the live stream and
// the profile view belong to the open page.
const BROWSER_ONLY = [
  /^GET \/api\/v1\/platform-status$/,
  /^GET \/api\/v1\/home$/,
  /^GET \/api\/v1\/live\/public$/,
  /^POST \/api\/v1\/garages\/[^/]+\/views$/,
];
const outside = (seen: Read[]) =>
  seen
    .map(({ method, path }) => `${method} ${path}`)
    .filter((read) => !BROWSER_ONLY.some((allowed) => allowed.test(read)));
// The browser-only reads a page makes once: a second one is a repeated read.
const ONCE = ['GET /api/v1/platform-status', 'GET /api/v1/home'];
const repeated = (seen: Read[]) =>
  ONCE.filter(
    (once) =>
      seen.filter(({ method, path }) => `${method} ${path}` === once).length >
      1,
  );

async function openHome(page: Page) {
  await hydrated(page, '/ro');
  await expect(page.locator('mf-home [aria-live] .tally')).not.toBeEmpty();
}

async function openProfile(page: Page) {
  const live = page.waitForRequest(/\/api\/v1\/live\/public\?/);
  await hydrated(page, PROFILE);
  await expect(heading(page)).toHaveText(/Service Auto Militari/i);
  await live;
}

test.describe('a server-rendered page read once @seeded', () => {
  test('Home: the browser reads neither the tiles nor the ready check again', async ({
    page,
  }) => {
    const seen = reads(page);
    const errors = hydrationErrors(page);

    await openHome(page);

    expect(errors).toEqual([]);
    expect(seen.map((read) => read.path)).not.toContain(
      '/api/v1/brands/popular',
    );
    expect(seen.map((read) => read.path)).not.toContain('/health/ready');
    expect(outside(seen)).toEqual([]);
    expect(repeated(seen)).toEqual([]);
  });

  test('the profile: the browser does not read the garage again', async ({
    page,
  }) => {
    const seen = reads(page);
    const errors = hydrationErrors(page);

    await openProfile(page);

    expect(errors).toEqual([]);
    expect(seen.map((read) => read.path)).not.toContain(
      '/api/v1/garages/service-auto-militari',
    );
    expect(outside(seen)).toEqual([]);
    expect(repeated(seen)).toEqual([]);
  });

  test('signed in, the same pages repeat no read and send their public reads without a token', async ({
    page,
  }) => {
    await hydrated(page, '/ro');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.driver);
    await expect(page).toHaveURL('/app/driver');

    const seen = reads(page);
    await openHome(page);
    await openProfile(page);

    const paths = seen.map((read) => read.path);
    expect(paths).not.toContain('/api/v1/brands/popular');
    expect(paths).not.toContain('/health/ready');
    expect(paths).not.toContain('/api/v1/garages/service-auto-militari');
    expect(
      seen.filter((read) => read.token && !/^\/api\/v1\/me/.test(read.path)),
    ).toEqual([]);
  });
});

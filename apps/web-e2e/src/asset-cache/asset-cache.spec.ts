import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { cacheAssets, isHashedAsset } from './asset-cache.js';
import { test } from '../fixtures.js';

const hits = new Map<string, number>();
let server: Server;
let origin: string;

const script = (name: string) =>
  `window.ran = (window.ran || []).concat('${name}');`;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path.startsWith('/page/')) {
      const sources = decodeURIComponent(path.slice('/page/'.length)).split(
        ',',
      );
      res.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html',
      });
      res.end(
        `<!doctype html><body>${sources
          .map((src) => `<script src="${src}"></script>`)
          .join('')}</body>`,
      );
      return;
    }
    if (path.startsWith('/missing-')) {
      res.writeHead(404, { 'cache-control': 'no-store' });
      res.end('gone');
      return;
    }
    const body = script(path);
    const zipped = /gzip/.test(String(req.headers['accept-encoding']));
    res.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/javascript',
      ...(zipped ? { 'content-encoding': 'gzip' } : {}),
    });
    res.end(zipped ? gzipSync(body) : body);
  });
  await new Promise<void>((done) => server.listen(0, done));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

test.beforeEach(() => hits.clear());

const page = (...sources: string[]) =>
  `${origin}/page/${encodeURIComponent(sources.join(','))}`;

test.describe('the hashed-asset predicate', () => {
  const base = 'https://web.example.test';
  const at = (path: string, host = base) => new URL(path, host);

  test('matches content-hashed scripts, styles and fonts of the deployment', () => {
    expect(isHashedAsset(at('/main-AB12cd34.js'), base)).toBe(true);
    expect(isHashedAsset(at('/chunk-ZZ99YY88.js'), base)).toBe(true);
    expect(isHashedAsset(at('/styles-0a1B2c3D.css'), base)).toBe(true);
    expect(isHashedAsset(at('/media/font-QWERTY12.woff2'), base)).toBe(true);
  });

  test('rejects pages, API calls, unhashed files and other origins', () => {
    expect(isHashedAsset(at('/en'), base)).toBe(false);
    expect(isHashedAsset(at('/api/v1/garages'), base)).toBe(false);
    expect(isHashedAsset(at('/main.js'), base)).toBe(false);
    expect(isHashedAsset(at('/main-AB12cd3.js'), base)).toBe(false);
    expect(isHashedAsset(at('/main-AB12cd345.js'), base)).toBe(false);
    expect(isHashedAsset(at('/icon-AB12cd34.png'), base)).toBe(false);
    expect(isHashedAsset(at('/main-AB12cd34.js.map'), base)).toBe(false);
    expect(
      isHashedAsset(at('/main-AB12cd34.js', 'https://cdn.example.test'), base),
    ).toBe(false);
  });
});

test.describe('the asset cache', () => {
  let contexts: BrowserContext[];

  const cachedPage = async (browser: Browser) => {
    const context = await browser.newContext();
    contexts.push(context);
    await cacheAssets(context, origin);
    return context.newPage();
  };
  const ran = (tab: Page) =>
    tab.evaluate(() => (window as unknown as { ran?: string[] }).ran);

  test.beforeEach(() => {
    contexts = [];
  });

  test.afterEach(async () => {
    await Promise.all(contexts.map((context) => context.close()));
  });

  test('fetches a hashed asset once and answers again from memory', async ({
    browser,
  }) => {
    const tab = await cachedPage(browser);
    await tab.goto(page('/once-AAAA1111.js'));
    await tab.goto(page('/once-AAAA1111.js'));

    expect(hits.get('/once-AAAA1111.js')).toBe(1);
    expect(await ran(tab)).toEqual(['/once-AAAA1111.js']);
  });

  test('shares a cached answer with every browser context of the worker', async ({
    browser,
  }) => {
    await (await cachedPage(browser)).goto(page('/shared-BBBB2222.js'));
    const second = await cachedPage(browser);
    await second.goto(page('/shared-BBBB2222.js'));

    expect(hits.get('/shared-BBBB2222.js')).toBe(1);
    expect(await ran(second)).toEqual(['/shared-BBBB2222.js']);
  });

  test('does not keep a failed answer', async ({ browser }) => {
    const tab = await cachedPage(browser);
    await tab.goto(page('/missing-CCCC3333.js'));
    await tab.goto(page('/missing-CCCC3333.js'));

    expect(hits.get('/missing-CCCC3333.js')).toBe(2);
  });

  test('lets pages and unhashed files reach the server every time', async ({
    browser,
  }) => {
    const sources = ['/plain.js', '/plain-DDDD4444.mjs'];
    const tab = await cachedPage(browser);
    await tab.goto(page(...sources));
    await tab.goto(page(...sources));

    expect(hits.get('/plain.js')).toBe(2);
    expect(hits.get('/plain-DDDD4444.mjs')).toBe(2);
    expect(hits.get(`/page/${encodeURIComponent(sources.join(','))}`)).toBe(2);
  });

  test("gives way to a test's own stub", async ({ browser }) => {
    const tab = await cachedPage(browser);
    await tab.route('**/stub-EEEE5555.js', (route) =>
      route.fulfill({
        body: "window.ran = ['stub'];",
        contentType: 'text/javascript',
      }),
    );
    await tab.goto(page('/stub-EEEE5555.js'));

    expect(hits.get('/stub-EEEE5555.js')).toBeUndefined();
    expect(await ran(tab)).toEqual(['stub']);
  });
});

test('the suite caches nothing outside the deployed address it was given', async ({
  page: tab,
}) => {
  await tab.goto(page('/outside-FFFF6666.js'));
  await tab.goto(page('/outside-FFFF6666.js'));

  expect(hits.get('/outside-FFFF6666.js')).toBe(2);
});

// FR-004 holds only for specs that take `test` from the fixtures: one that
// imports it from @playwright/test downloads every asset again on staging.
test('every end-to-end spec takes its test from the fixtures', () => {
  const src = join(import.meta.dirname, '..');
  const specs = readdirSync(src, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.spec.ts'));
  const bare = specs.filter(
    (file) =>
      !/import \{[^}]*\btest\b[^}]*\} from '(\.\.?\/)+fixtures\.js'/.test(
        readFileSync(join(src, file), 'utf8'),
      ),
  );
  expect(specs.length).toBeGreaterThan(0);
  expect(bare).toEqual([]);
});

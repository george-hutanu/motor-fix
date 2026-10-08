import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VIEWPORTS, contextCookies, dropExpected, flowSignIn, loadProblem, matrix, openPage, parseRoute, runSweep, sessionCookie, toFindings } from './sweep.mjs';

describe('the sweep matrix', () => {
  it('visits every route at four viewports, two schemes and two languages', () => {
    const runs = matrix({ routes: ['/', '/cockpit'] });
    assert.equal(runs.length, 2 * 4 * 2 * 2);
    assert.deepEqual([...new Set(runs.map((r) => r.viewport))], ['desktop', 'tablet', 'mobile', 'small-phone']);
    assert.deepEqual([...new Set(runs.map((r) => r.scheme))], ['light', 'dark']);
    assert.deepEqual([...new Set(runs.map((r) => r.lang))], ['ro', 'en']);
  });

  it('uses 1440×900 desktop, a tablet, a 390×844 and a 320×568 touch phone', () => {
    assert.deepEqual([VIEWPORTS.desktop.width, VIEWPORTS.desktop.height], [1440, 900]);
    assert.ok(VIEWPORTS.tablet.width >= 768 && VIEWPORTS.tablet.width < 1024);
    assert.deepEqual([VIEWPORTS.mobile.width, VIEWPORTS.mobile.height], [390, 844]);
    assert.equal(VIEWPORTS.mobile.isMobile, true);
    assert.equal(VIEWPORTS.mobile.hasTouch, true);
    // The specs ask for no horizontal scrolling down to 320 px, the narrowest
    // phone still in use; 390 alone lets a 320 px overflow through.
    assert.deepEqual([VIEWPORTS['small-phone'].width, VIEWPORTS['small-phone'].height], [320, 568]);
    assert.equal(VIEWPORTS['small-phone'].isMobile, true);
    assert.equal(VIEWPORTS['small-phone'].hasTouch, true);
  });

  it('names one screenshot per combination, readable and unique', () => {
    const runs = matrix({ routes: ['/', '/app/driver'] });
    const shots = runs.map((r) => r.shot);
    assert.equal(new Set(shots).size, shots.length);
    assert.ok(shots.includes('home-mobile-dark-en.png'));
    assert.ok(shots.includes('app-driver-desktop-light-ro.png'));
  });

  it('narrows to one language or scheme when asked', () => {
    assert.equal(matrix({ routes: ['/'], langs: ['ro'], schemes: ['light'] }).length, 4);
  });
});

describe('observations to findings', () => {
  const origins = ['http://127.0.0.1:4100', 'http://127.0.0.1:3100'];
  const at = (viewport, extra) => ({ route: '/', viewport, scheme: 'light', lang: 'ro', screenshot: `home-${viewport}-light-ro.png`, ...extra });

  it('folds the same problem seen in several combinations into one finding that lists where', () => {
    const obs = ['desktop', 'tablet', 'mobile'].map((v) => at(v, { kind: 'console', text: 'NG0100: changed after checked' }));
    const findings = toFindings(obs, { web: true, origins });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].seenIn.length, 3);
    assert.equal(findings[0].severity, 'high');
  });

  it('marks requests to other hosts as off-origin', () => {
    const findings = toFindings([at('desktop', { kind: 'request-failed', url: 'https://fonts.example.com/x.woff2', text: 'net::ERR_FAILED' })], { web: true, origins });
    assert.equal(findings[0].severity, 'low');
    const own = toFindings([at('desktop', { kind: 'request-failed', url: 'http://127.0.0.1:3100/api/x', text: 'net::ERR_FAILED' })], { web: true, origins });
    assert.equal(own[0].severity, 'high');
  });

  it('keeps the worst severity when the same problem ranks differently across viewports', () => {
    const obs = [at('desktop', { kind: 'overflow', scrollWidth: 1500, width: 1440 }), at('mobile', { kind: 'overflow', scrollWidth: 600, width: 390 })];
    const findings = toFindings(obs, { web: true, origins });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'high');
  });

  it('keeps one layout finding per element, listing every combination it was seen in', () => {
    const layout = (viewport, selector) => at(viewport, { kind: 'layout', rule: 'grid', selector, measured: 'gap 13px', expected: 'a multiple of 4px', text: '' });
    const findings = toFindings([layout('mobile', 'div#row'), layout('desktop', 'div#row'), layout('mobile', 'div#pad')], { web: true, origins });
    assert.equal(findings.length, 2);
    const row = findings.find((f) => f.selector === 'div#row');
    assert.deepEqual(row.seenIn, ['mobile light ro', 'desktop light ro']);
    assert.equal(row.evidence, 'home-mobile-light-ro.png');
  });
});

describe('route syntax: path[@role][:status]', () => {
  it('reads a plain path, a role, an expected status, or both', () => {
    assert.deepEqual(parseRoute('/cockpit'), { path: '/cockpit', role: null, expect: null });
    assert.deepEqual(parseRoute('/de:404'), { path: '/de', role: null, expect: 404 });
    assert.deepEqual(parseRoute('/app/driver@driver'), { path: '/app/driver', role: 'driver', expect: null });
    assert.deepEqual(parseRoute('/app/admin@driver:403'), { path: '/app/admin', role: 'driver', expect: 403 });
  });

  it('keeps the role and status in the matrix and in the screenshot name', () => {
    const runs = matrix({ routes: ['/app/driver@driver', '/de:404'], langs: ['ro'], schemes: ['light'] });
    const signedIn = runs.find((r) => r.route === '/app/driver@driver');
    assert.equal(signedIn.path, '/app/driver');
    assert.equal(signedIn.role, 'driver');
    assert.equal(signedIn.shot, 'app-driver-as-driver-desktop-light-ro.png');
    const missing = runs.find((r) => r.route === '/de:404');
    assert.equal(missing.expect, 404);
    assert.equal(missing.shot, 'de-404-desktop-light-ro.png');
  });

  it('flags a page load only when it differs from what the route expects', () => {
    assert.equal(loadProblem(200, null), null);
    assert.match(loadProblem(404, null), /HTTP 404/);
    assert.equal(loadProblem(404, 404), null);
    assert.match(loadProblem(200, 404), /HTTP 200, expected 404/);
    assert.match(loadProblem(null, null), /no response/);
  });

  it('drops the error response and console line an expected status causes, and nothing else', () => {
    const at = { route: '/de:404', path: '/de', expect: 404, viewport: 'desktop', scheme: 'light', lang: 'ro' };
    const obs = [
      { ...at, kind: 'http', url: 'http://127.0.0.1:4100/de', status: 404 },
      { ...at, kind: 'console', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)' },
      { ...at, kind: 'http', url: 'http://127.0.0.1:4100/api/v1/x', status: 500 },
      { ...at, kind: 'console', text: 'NG0100' },
      { route: '/', path: '/', expect: null, viewport: 'desktop', scheme: 'light', lang: 'ro', kind: 'http', url: 'http://127.0.0.1:4100/', status: 404 },
    ];
    const kept = dropExpected(obs);
    assert.equal(kept.length, 3);
    assert.ok(kept.some((o) => o.status === 500));
    assert.ok(kept.some((o) => o.text === 'NG0100'));
    assert.ok(kept.some((o) => o.route === '/'));
  });

  it('opens a signed-in route with the refresh cookie on the web origin, sent only to the auth calls', () => {
    const c = sessionCookie({ refresh: 'r-1', baseURL: 'http://127.0.0.1:4100' });
    assert.equal(c.name, 'mf_refresh');
    assert.equal(c.value, 'r-1');
    assert.equal(c.domain, '127.0.0.1');
    assert.equal(c.path, '/api/v1/auth');
    assert.equal(c.httpOnly, true);
  });

  it('signs in afresh for every browser context of a role route, and not at all for the others', async () => {
    const asked = [];
    const session = async (role) => {
      asked.push(role);
      return `r-${asked.length}`;
    };
    const baseURL = 'http://127.0.0.1:4100';
    const [first] = await contextCookies({ role: 'driver' }, { session, baseURL });
    const [second] = await contextCookies({ role: 'driver' }, { session, baseURL });
    assert.deepEqual(asked, ['driver', 'driver']);
    assert.deepEqual([first.value, second.value], ['r-1', 'r-2']);
    assert.deepEqual(await contextCookies({ role: null }, { session, baseURL }), []);
    assert.equal(asked.length, 2);
    await assert.rejects(contextCookies({ role: 'admin' }, { baseURL }), /no session for @admin/);
  });
});

describe('signing in from a QA flow', () => {
  const baseURL = 'http://127.0.0.1:4100';
  const fakeContext = () => {
    const added = [];
    return { added, addCookies: async (cookies) => added.push(...cookies) };
  };

  it('adds the same refresh cookie the sweep sets for path@role, signed in afresh on each call', async () => {
    const asked = [];
    const signIn = flowSignIn({ session: async (role) => (asked.push(role), `r-${asked.length}`), baseURL });
    const one = fakeContext();
    const two = fakeContext();
    await signIn(one, 'driver');
    await signIn(two, 'mechanic');
    assert.deepEqual(asked, ['driver', 'mechanic']);
    assert.deepEqual(one.added, [sessionCookie({ refresh: 'r-1', baseURL })]);
    assert.deepEqual(two.added, [sessionCookie({ refresh: 'r-2', baseURL })]);
  });

  it('refuses a call with no role, and a run with no session', async () => {
    const signIn = flowSignIn({ session: async () => 'r', baseURL });
    await assert.rejects(signIn(fakeContext()), /signIn\(context, role\) needs a role/);
    await assert.rejects(flowSignIn({ baseURL })(fakeContext(), 'driver'), /no session for @driver/);
  });
});

describe('opening a page', () => {
  it('waits for the load, then gives a page that never idles (a live stream) a bounded settle instead of failing', async () => {
    const calls = [];
    const page = {
      goto: async (url, opts) => {
        calls.push(['goto', url, opts.waitUntil]);
        return { status: () => 200 };
      },
      waitForLoadState: async (state, opts) => {
        calls.push(['settle', state, opts.timeout]);
        throw new Error(`page.waitForLoadState: Timeout ${opts.timeout}ms exceeded.`);
      },
    };
    const res = await openPage(page, 'http://127.0.0.1:4100/app/driver');
    assert.equal(res.status(), 200);
    assert.deepEqual(calls[0], ['goto', 'http://127.0.0.1:4100/app/driver', 'load']);
    assert.equal(calls[1][1], 'networkidle');
    assert.ok(calls[1][2] <= 10000);
  });

  it('still fails a page that never loads', async () => {
    const page = {
      goto: async () => {
        throw new Error('page.goto: Timeout 30000ms exceeded.');
      },
      waitForLoadState: async () => {},
    };
    await assert.rejects(openPage(page, 'http://127.0.0.1:4100/'), /Timeout 30000ms/);
  });
});

// The owner's three defects, through the whole sweep in a real browser: each
// blocks with a finding that names the element; the same page without them
// has no layout finding. Off CI a machine without the browser skips.
describe('the sweep measures the layout', async () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const fixtures = fileURLToPath(new URL('./fixtures/layout/', import.meta.url));
  let ready = true;
  try {
    const { chromium } = await import('@playwright/test');
    await (await chromium.launch()).close();
  } catch (error) {
    if (process.env.CI) throw error;
    ready = false;
  }
  const server = createServer(async (req, res) => {
    try {
      const body = await readFile(join(fixtures, new URL(req.url, 'http://x').pathname.replace(/^\/+/, '')));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const outDir = mkdtempSync(join(tmpdir(), 'sweep-layout-'));
  afterAll(() => {
    server.close();
    rmSync(outDir, { recursive: true, force: true });
  });
  const sweep = async (route) => {
    const { observations } = await runSweep({ baseURL, routes: [route], outDir, schemes: ['light'], langs: ['en'], repoRoot: root });
    return toFindings(observations, { web: true, origins: [baseURL] });
  };

  it.skipIf(!ready)('blocks 13 px body text, a label clipped at 320 px and a 13 px gap, naming each element', async () => {
    const findings = (await sweep('/owner-fail.html')).filter((f) => f.kind === 'layout');
    const find = (rule, selector) => findings.find((f) => f.rule === rule && f.selector === selector);
    assert.equal(find('min-text', 'p#intro')?.severity, 'high');
    const clipped = find('clipped', 'button#book');
    assert.equal(clipped?.severity, 'high');
    assert.ok(clipped.seenIn.includes('small-phone light en'));
    assert.equal(find('grid', 'div#actions')?.severity, 'high');
    for (const f of [find('min-text', 'p#intro'), clipped, find('grid', 'div#actions')]) assert.match(f.title, /#(intro|book|actions)/);
  }, 60000);

  it.skipIf(!ready)('finds no layout defect on the same page without them', async () => {
    const findings = await sweep('/owner-pass.html');
    assert.deepEqual(findings.filter((f) => f.kind === 'layout').map((f) => f.title), []);
  }, 60000);
});

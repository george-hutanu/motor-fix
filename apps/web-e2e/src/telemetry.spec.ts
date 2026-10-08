import { expect, type Page, type Request } from '@playwright/test';

import { COLLECTOR, test } from './fixtures.js';

const PERSONAL =
  /@[\w-]+\.\w|(\+40|0040|\b0)7\d{8}\b|\b[A-Z]{1,2}[\s-]?\d{2,3}[\s-]?[A-Z]{3}\b/;

interface Body {
  meta: {
    session?: unknown;
    user?: unknown;
    view?: { name?: string };
    app?: { version?: string };
    page?: { url?: string };
  };
  measurements?: { type: string; context?: Record<string, string> }[];
  traces?: unknown;
}

function collected(page: Page) {
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (COLLECTOR.test(new URL(request.url()).pathname)) requests.push(request);
  });
  return {
    bodies: () => requests.map((request) => request.postDataJSON() as Body),
    requests,
  };
}

// Hiding the page is what makes the SDK send what it still holds.
const leave = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });

const started = (page: Page) =>
  page.waitForFunction(() => 'faro' in window, undefined, { timeout: 15_000 });

test.describe('browser telemetry', () => {
  // A server with no collector configured (a release's run against staging
  // before one is set) renders no telemetry tag and sends nothing to test.
  test.beforeEach(async ({ request }) => {
    const html = await (await request.get('/ro')).text();
    test.skip(
      !html.includes('name="mf-telemetry"'),
      'the server under test has no collector configured',
    );
  });

  test('Home sends its Web Vitals by route, release and viewport, and nothing personal', async ({
    page,
  }) => {
    const sent = collected(page);
    await page.goto('/ro');
    await started(page);
    await leave(page);

    await expect
      .poll(() =>
        sent
          .bodies()
          .flatMap((body) =>
            (body.measurements ?? []).map((measurement) => ({
              body,
              measurement,
            })),
          )
          .find(({ measurement }) => measurement.type === 'web-vitals'),
      )
      .toMatchObject({
        body: { meta: { view: { name: '/:lang' } } },
        measurement: { context: { viewport: 'desktop' } },
      });
    for (const body of sent.bodies()) {
      expect(body.meta.app?.version).toBeTruthy();
      expect(body.meta).not.toHaveProperty('session');
      expect(body.meta).not.toHaveProperty('user');
      expect(body.meta.page?.url ?? '').not.toMatch(/[?#]/);
      expect(JSON.stringify(body)).not.toMatch(PERSONAL);
    }
    for (const request of sent.requests) {
      const headers = await request.allHeaders();
      expect(headers).not.toHaveProperty('traceparent');
      expect(headers).not.toHaveProperty('x-faro-session-id');
    }
  });

  test('leaves no cookie or stored value of its own on the device', async ({
    page,
    context,
  }) => {
    const sent = collected(page);
    await page.goto('/ro');
    await started(page);
    await leave(page);
    await expect.poll(() => sent.requests.length).toBeGreaterThan(0);

    const stored = await page.evaluate(async () => [
      ...Object.keys(localStorage),
      ...Object.keys(sessionStorage),
      ...(await indexedDB.databases()).map((database) => database.name ?? ''),
    ]);
    expect(stored.filter((key) => /faro/i.test(key))).toEqual([]);
    const cookies = await context.cookies();
    expect(cookies.filter((cookie) => /faro/i.test(cookie.name))).toEqual([]);
  });

  test("a call to the app's own API carries the trace, and the trace is sent", async ({
    page,
  }) => {
    const sent = collected(page);
    await page.goto('/ro');
    await started(page);

    const [call] = await Promise.all([
      page.waitForRequest((request) =>
        new URL(request.url()).pathname.startsWith('/api/v1/brands'),
      ),
      page.evaluate(() => fetch('/api/v1/brands').then(() => undefined)),
    ]);
    await leave(page);

    expect(await call.headerValue('traceparent')).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
    );
    await expect
      .poll(() => sent.bodies().some((body) => body.traces !== undefined))
      .toBe(true);
  });

  test('a call to any other origin carries no trace header', async ({
    page,
  }) => {
    let headers: Record<string, string> = {};
    await page.route('https://elsewhere.invalid/**', async (route) => {
      headers = await route.request().allHeaders();
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        status: 204,
      });
    });
    await page.goto('/ro');
    await started(page);

    await page.evaluate(() =>
      fetch('https://elsewhere.invalid/tile.png').then(() => undefined),
    );

    expect(headers).not.toHaveProperty('traceparent');
    expect(headers).not.toHaveProperty('tracestate');
    expect(headers).not.toHaveProperty('baggage');
  });
});

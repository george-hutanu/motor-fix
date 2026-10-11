import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { test as base } from '@playwright/test';

import { cacheAssets } from './asset-cache/asset-cache.js';

const deployed = process.env['BASE_URL'];

// The test mailbox the local run starts (mailbox.mjs), read by the config and
// the flows tagged @mailbox.
export const MAILBOX = 'http://127.0.0.1:3025';

// The browser telemetry collector's path (FARO_URL ends in /collect/<key>).
export const COLLECTOR = /\/collect\/[\w-]+$/;

// The tag the web server renders when PLAUSIBLE_DOMAIN is set, with a domain.
const ANALYTICS_TAG = /<meta name="mf-analytics" content="[^"]+"/;

/**
 * Why a flow that needs analytics to load cannot run against this target, or
 * undefined when it can. Only a deployed target is read: staging and
 * production set no PLAUSIBLE_DOMAIN while analytics are off, so their pages
 * carry no analytics tag. A run that starts its own servers (CI's E2E job sets
 * the domain) never skips, so a missing domain there fails.
 */
export function analyticsSkipReason(
  html: string,
  target: string | undefined,
): string | undefined {
  if (!target || ANALYTICS_TAG.test(html)) return undefined;
  return 'the server under test has no Plausible domain configured';
}

/**
 * Skips the running test when the deployed target serves no analytics domain.
 * A page that does not answer fails the test: an error page carries no tag
 * either, and must not pass for analytics being off.
 */
export async function needsAnalytics(
  request: APIRequestContext,
  target: string | undefined = deployed,
) {
  if (!target) return;
  const page = await request.get('/ro');
  if (!page.ok()) throw new Error(`GET /ro answered ${page.status()}`);
  const reason = analyticsSkipReason(await page.text(), target);
  base.skip(reason !== undefined, reason);
}

/** The `context` fixture: the routes every test shares, removed when it ends. */
export async function routedContext(
  { context }: { context: BrowserContext },
  use: (context: BrowserContext) => Promise<void>,
) {
  if (deployed) await cacheAssets(context, new URL(deployed).origin);
  // The browser telemetry collector: answered here, so nothing leaves.
  await context.route(COLLECTOR, (route) => route.fulfill({ status: 204 }));
  // Analytics, loaded once a test accepts them: answered here too.
  await context.route('https://plausible.io/**', (route) =>
    route.fulfill({ status: 204 }),
  );
  await use(context);
  // Handlers still answering when the test ends must not outlive it.
  await context.unrouteAll({ behavior: 'ignoreErrors' });
}

export const test = base.extend({ context: routedContext });

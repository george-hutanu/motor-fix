import type { BrowserContext } from '@playwright/test';
import { test as base } from '@playwright/test';

import { cacheAssets } from './asset-cache/asset-cache.js';

const deployed = process.env['BASE_URL'];

// The browser telemetry collector's path (FARO_URL ends in /collect/<key>).
export const COLLECTOR = /\/collect\/[\w-]+$/;

/** The `context` fixture: the routes every test shares, removed when it ends. */
export async function routedContext(
  { context }: { context: BrowserContext },
  use: (context: BrowserContext) => Promise<void>,
) {
  if (deployed) await cacheAssets(context, new URL(deployed).origin);
  // The browser telemetry collector: answered here, so nothing leaves.
  await context.route(COLLECTOR, (route) => route.fulfill({ status: 204 }));
  await use(context);
  // Handlers still answering when the test ends must not outlive it.
  await context.unrouteAll({ behavior: 'ignoreErrors' });
}

export const test = base.extend({ context: routedContext });

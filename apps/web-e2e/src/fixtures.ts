import { test as base } from '@playwright/test';

import { cacheAssets } from './asset-cache/asset-cache.js';

const deployed = process.env['BASE_URL'];

export const test = base.extend({
  context: async ({ context }, use) => {
    if (deployed) await cacheAssets(context, new URL(deployed).origin);
    // The browser telemetry collector: answered here, so nothing leaves.
    await context.route(/\/collect\/[\w-]+$/, (route) =>
      route.fulfill({ status: 204 }),
    );
    await use(context);
  },
});

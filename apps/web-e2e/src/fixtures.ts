import { test as base } from '@playwright/test';

import { cacheAssets } from './asset-cache.js';

const deployed = process.env['BASE_URL'];

export const test = base.extend({
  context: async ({ context }, use) => {
    if (deployed) await cacheAssets(context, new URL(deployed).origin);
    await use(context);
  },
});

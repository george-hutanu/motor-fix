import type { BrowserContext } from '@playwright/test';
import { expect } from '@playwright/test';

import { routedContext, test } from './fixtures.js';

// FR-002 (ST-1007): handlers still answering when a test ends must not outlive it.
test('the context fixture removes every route handler once the test ends', async () => {
  const calls: string[] = [];
  const context = {
    route: async () => {
      calls.push('route');
    },
    unrouteAll: async (options?: { behavior?: string }) => {
      calls.push(`unrouteAll:${options?.behavior}`);
    },
  } as unknown as BrowserContext;

  await routedContext({ context }, async () => {
    calls.push('use');
  });

  expect(calls).toContain('route');
  expect(calls.slice(-2)).toEqual(['use', 'unrouteAll:ignoreErrors']);
});

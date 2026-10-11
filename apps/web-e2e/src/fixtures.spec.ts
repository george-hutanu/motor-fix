import type { BrowserContext } from '@playwright/test';
import { expect } from '@playwright/test';

import { analyticsSkipReason, routedContext, test } from './fixtures.js';

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

// FR-001..FR-002 (ST-1161): the flows that need analytics to load skip only
// on a deployed target whose page names no analytics domain.
test.describe('analyticsSkipReason', () => {
  const served =
    '<head><meta name="mf-analytics" content="motorfix.ro"></head>';
  const bare = '<head><title>MotorFix</title></head>';
  const staging = 'https://staging.motorfix.example';

  test('names the missing domain on a deployed target that serves none', () => {
    expect(analyticsSkipReason(bare, staging)).toMatch(/no Plausible domain/);
  });

  test('runs the flows on a deployed target that serves a domain', () => {
    expect(analyticsSkipReason(served, staging)).toBeUndefined();
  });

  test('never skips a run that starts its own servers, domain or not', () => {
    expect(analyticsSkipReason(bare, undefined)).toBeUndefined();
    expect(analyticsSkipReason(served, undefined)).toBeUndefined();
  });

  test('does not take an empty domain for a configured one', () => {
    expect(
      analyticsSkipReason('<meta name="mf-analytics" content="">', staging),
    ).toMatch(/no Plausible domain/);
  });
});

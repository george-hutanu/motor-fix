import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { expect } from '@playwright/test';

import {
  analyticsSkipReason,
  needsAnalytics,
  routedContext,
  test,
} from './fixtures.js';

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

// @traces 115-FR-010
test("the context fixture sends each test's new drafts from an address of its own", async () => {
  type Handler = (route: unknown) => Promise<void>;
  const handlers = new Map<string, Handler>();
  const context = {
    route: async (url: unknown, handler: Handler) => {
      if (typeof url === 'string') handlers.set(url, handler);
    },
    unrouteAll: async () => undefined,
  } as unknown as BrowserContext;
  await routedContext({ context }, async () => undefined);
  const drafts = handlers.get('**/api/v1/listing-drafts');

  const sent: Record<string, unknown>[] = [];
  const route = (method: string) => ({
    continue: async (options: Record<string, unknown>) => {
      sent.push(options);
    },
    fallback: async () => {
      sent.push({ fallback: method });
    },
    request: () => ({
      headers: () => ({ accept: 'json' }),
      method: () => method,
    }),
  });
  await drafts?.(route('POST'));
  await drafts?.(route('GET'));

  expect(sent[0]).toEqual({
    headers: {
      accept: 'json',
      'x-forwarded-for': expect.stringMatching(/^192\.0\.2\.\d{1,3}$/),
    },
  });
  expect(sent[1]).toEqual({ fallback: 'GET' });
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

  const answering = (status: number, asked: string[] = []) =>
    ({
      get: async (path: string) => {
        asked.push(path);
        return {
          ok: () => status < 400,
          status: () => status,
          text: async () => bare,
        };
      },
    }) as unknown as APIRequestContext;

  test('fails rather than skips when the deployed page does not answer', async () => {
    await expect(needsAnalytics(answering(503), staging)).rejects.toThrow(
      /503/,
    );
  });

  test('reads nothing on a run that starts its own servers', async () => {
    const asked: string[] = [];
    // An empty BASE_URL, like an unset one, starts the run's own servers.
    await needsAnalytics(answering(200, asked), '');
    expect(asked).toEqual([]);
  });
});

// @traces 374-FR-001
// @traces 374-FR-002
// @traces 374-FR-005
// @traces 374-FR-008
// @traces 374-FR-011
// @traces 374-FR-012
import { type APIRequestContext, expect } from '@playwright/test';

import { ACCOUNTS, PASSWORD } from './accounts.js';
import { connect, ISSUER, MCP_URL } from './assistant.js';
import { test } from './fixtures.js';

const READS = [
  'get_day_sheet',
  'get_schedule',
  'get_stats',
  'list_quote_requests',
];
const PHONE = /(?:\+?40|\b0)\s?7\d{2}[\s.]?\d{3}[\s.]?\d{3}\b/;
const PLATE = /\b[A-Z]{1,2}[ -]?\d{2,3}[ -]?[A-Z]{3}\b/;

async function inbox(request: APIRequestContext) {
  const signedIn = await request.post('/api/v1/auth/sign-in', {
    data: { email: ACCOUNTS.garage, password: PASSWORD, remember: false },
  });
  const { accessToken } = (await signedIn.json()) as { accessToken: string };
  const answer = await request.get('/api/v1/garage/requests', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(answer.ok()).toBe(true);
  return (await answer.json()) as {
    items: { id: string; recipient: { status: string } }[];
  };
}

test.describe('the garage assistant reads @assistants', () => {
  test.skip(
    !MCP_URL || !ISSUER,
    'needs the MCP server and the identity server',
  );

  test('the owner asks about requests, the schedule, a day sheet and the figures', async ({
    page,
    request,
  }) => {
    const { assistant, host } = await connect(page, ACCOUNTS.garage, true);
    try {
      const { tools } = await assistant.listTools();
      expect(tools.map(({ name }) => name)).toEqual(
        expect.arrayContaining(READS),
      );

      const ask = async (name: string, args: Record<string, unknown> = {}) => {
        const started = Date.now();
        const answer = await assistant.callTool({ arguments: args, name });
        expect(Date.now() - started).toBeLessThan(5000);
        expect(answer.isError ?? false).toBe(false);
        const text = JSON.stringify(answer.structuredContent);
        expect(text).not.toMatch(PHONE);
        expect(text).not.toMatch(PLATE);
        return answer.structuredContent as Record<string, unknown>;
      };

      const requests = (await ask('list_quote_requests')) as {
        items: { id: string }[];
      };
      const waiting = (await inbox(request)).items
        .filter(({ recipient }) => recipient.status === 'waiting')
        .map(({ id }) => id);
      // Both newest first: the same waiting requests in the same order.
      expect(requests.items.map(({ id }) => id)).toEqual(waiting);

      expect(await ask('get_schedule')).toHaveProperty('entries');
      expect(await ask('get_day_sheet', { mechanic: 'Vlad' })).toMatchObject({
        mechanic: { name: 'Vlad Stan' },
      });
      expect(await ask('get_stats')).toHaveProperty('current');
    } finally {
      await assistant.close();
      await host.close();
    }
  });
});

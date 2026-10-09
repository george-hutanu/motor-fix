// @traces 365-FR-001
// @traces 365-FR-002
// @traces 365-FR-003
// @traces 365-FR-012
// @traces 365-FR-013
// @traces 365-FR-014
import { expect } from '@playwright/test';

import { ACCOUNTS } from './accounts.js';
import { connect, ISSUER, MCP_URL } from './assistant.js';
import { test } from './fixtures.js';

test.describe('connecting an AI assistant @assistants', () => {
  test.skip(
    !MCP_URL || !ISSUER,
    'needs the MCP server and the identity server',
  );

  test('the MCP server points an unsigned assistant at the identity server', async ({
    request,
  }) => {
    const answer = await request.post(MCP_URL, {
      data: { id: 1, jsonrpc: '2.0', method: 'tools/list' },
      headers: { accept: 'application/json, text/event-stream' },
    });
    expect(answer.status()).toBe(401);
    const pointer = /resource_metadata="([^"]+)"/.exec(
      answer.headers()['www-authenticate'] ?? '',
    )?.[1];
    expect(pointer).toBeTruthy();

    const resource = await (await request.get(pointer as string)).json();
    expect(resource).toMatchObject({
      authorization_servers: [ISSUER],
      resource: MCP_URL,
    });

    const server = await (
      await request.get(`${ISSUER}/.well-known/oauth-authorization-server`)
    ).json();
    expect(server).toMatchObject({
      client_id_metadata_document_supported: true,
      issuer: ISSUER,
    });
    expect(server.registration_endpoint).toBeTruthy();
  });

  test('an assistant with a client document connects as the driver who signed in', async ({
    page,
  }) => {
    const { assistant, host } = await connect(page, ACCOUNTS.driver, true);
    try {
      const { tools } = await assistant.listTools();
      expect(tools.map(({ name }) => name)).toContain('get_my_account');
      const account = await assistant.callTool({
        arguments: {},
        name: 'get_my_account',
      });
      expect(account.structuredContent).toEqual({
        firstName: 'Andrei',
        language: 'ro',
        roles: ['driver'],
      });
    } finally {
      await assistant.close();
      await host.close();
    }
  });

  test('an assistant that registers itself connects as the driver who signed in', async ({
    page,
  }) => {
    const { assistant, host } = await connect(
      page,
      ACCOUNTS.otherDriver,
      false,
    );
    try {
      const account = await assistant.callTool({
        arguments: {},
        name: 'get_my_account',
      });
      expect(account.structuredContent).toMatchObject({ firstName: 'Maria' });
    } finally {
      await assistant.close();
      await host.close();
    }
  });
});

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AuditService, createPrisma } from '@motor-fix/domain';
import { databaseTurn } from '@motor-fix/domain/testing';
import { catalogue, defineTool } from '@motor-fix/mcp-tools';
import type { INestApplication } from '@nestjs/common';

import {
  TEST_MCP_URL,
  type TestIssuer,
  testIssuer,
} from '../auth/auth.issuer.testing';
import { createMcpApp } from '../mcp.module';
import * as metrics from '../metrics/metrics';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
const turn = databaseTurn(databaseUrl);

const touchAccount = defineTool({
  acts: false,
  annotations: { destructiveHint: false, readOnlyHint: true },
  description: 'Fixture: writes one audit row about the caller.',
  handler: async (actor) => {
    await prisma.$transaction((tx) =>
      new AuditService().record(tx, {
        action: 'open',
        actorId: actor.accountId,
        actorRole: actor.role,
        assistantGrantId: actor.assistantGrantId,
        requestId: actor.requestId,
        subjectId: actor.accountId,
        subjectType: 'account',
      }),
    );
    return { done: true };
  },
  inputSchema: {},
  name: 'touch_account',
  roles: ['driver'],
});

let realm: TestIssuer;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  await turn.take();
  realm = await testIssuer();
  app = await createMcpApp(
    { databaseUrl, issuer: realm.issuer, mcpUrl: TEST_MCP_URL },
    [...catalogue, touchAccount],
  );
  await app.listen(0, '127.0.0.1');
  const address = (app.getHttpServer() as Server).address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await realm?.close();
  await prisma.$disconnect();
  await turn.release();
});

const newAccount = () =>
  prisma.account.create({
    data: {
      language: 'ro',
      lastRole: 'driver',
      name: 'Ioana Marin',
      roles: { create: [{ role: 'driver' }] },
    },
  });

const tokenFor = (accountId: string) =>
  realm.sign({ claims: { motorfix_account_id: accountId } });

async function connect(token: string, headers: Record<string, string> = {}) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${token}`, ...headers },
      },
    }),
  );
  return client;
}

const initialize = (token?: string) =>
  fetch(`${base}/mcp`, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'raw', version: '1' },
        protocolVersion: '2025-06-18',
      },
    }),
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
      'x-request-id': 'raw-request-1',
    },
    method: 'POST',
  });

// @traces 365-FR-001 365-FR-002 365-FR-011 365-FR-017
describe('the MCP endpoint', () => {
  it('lists and runs tools for a signed-in assistant over stateless HTTP', async () => {
    const { id } = await newAccount();
    const client = await connect(await tokenFor(id));

    const { tools } = await client.listTools();
    const result = await client.callTool({
      arguments: {},
      name: 'get_my_account',
    });

    expect(tools.map((t) => t.name)).toEqual([
      'get_my_account',
      'touch_account',
    ]);
    expect(result.structuredContent).toEqual({
      firstName: 'Ioana',
      language: 'ro',
      roles: ['driver'],
    });
    await client.close();
  });

  it('opens no session and echoes the request id', async () => {
    const { id } = await newAccount();

    const res = await initialize(await tokenFor(id));

    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeNull();
    expect(res.headers.get('x-request-id')).toBe('raw-request-1');
  });

  it('asks for sign-in over HTTP when no token is sent', async () => {
    const res = await initialize();

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="http://127.0.0.1:3002/.well-known/oauth-protected-resource/mcp"',
    );
    expect(await res.json()).toMatchObject({ code: 'sign_in_required' });
  });

  it('refuses a call after the grant is revoked, the token still valid', async () => {
    const { id } = await newAccount();
    const token = await tokenFor(id);
    expect((await initialize(token)).status).toBe(200);
    await prisma.assistantGrant.updateMany({
      data: { revokedAt: new Date(), revokedBy: 'person' },
      where: { accountId: id },
    });

    const res = await initialize(token);

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    );
    expect(await res.json()).toMatchObject({ code: 'assistant_grant_revoked' });
  });

  it('refuses a suspended account with 403 and no challenge', async () => {
    const { id } = await newAccount();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await initialize(await tokenFor(id));

    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.json()).toMatchObject({ code: 'account_suspended' });
  });

  it.each(['GET', 'DELETE'])('answers %s with 405', async (method) => {
    const res = await fetch(`${base}/mcp`, { method });

    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ code: 'method_not_allowed' });
  });

  it('stamps an audit row of a tool call with the assistant, grant and request', async () => {
    const { id } = await newAccount();
    const client = await connect(await tokenFor(id), {
      'x-request-id': 'audit-request-7',
    });

    await client.callTool({ arguments: {}, name: 'touch_account' });

    const grant = await prisma.assistantGrant.findFirstOrThrow({
      where: { accountId: id },
    });
    const rows = await prisma.activityLog.findMany({
      where: { action: 'open', subjectId: id },
    });
    expect(rows).toEqual([
      expect.objectContaining({
        assistantGrantId: grant.id,
        requestId: 'audit-request-7',
        viaAssistant: true,
      }),
    ]);
    await client.close();
  });

  it.each([
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ])('publishes the protected resource metadata at %s', async (path) => {
    const res = await fetch(`${base}${path}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      authorization_servers: [realm.issuer],
      bearer_methods_supported: ['header'],
      resource: TEST_MCP_URL,
      scopes_supported: ['motorfix.read', 'motorfix.act'],
    });
  });

  it('keeps answering live', async () => {
    const res = await fetch(`${base}/health/live`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

// @traces 365-FR-015
describe('what the MCP endpoint reports', () => {
  afterEach(() => jest.restoreAllMocks());

  it('observes a tool call with the tool, the caller and the request id', async () => {
    const observed = jest.spyOn(metrics, 'observeToolCall');
    const { id } = await newAccount();
    const client = await connect(await tokenFor(id), {
      'x-request-id': 'observed-call-1',
    });

    await client.callTool({ arguments: {}, name: 'get_my_account' });
    await client.callTool({ arguments: {}, name: 'drop_everything' });

    expect(observed.mock.calls.map(([call]) => call)).toEqual([
      {
        accountId: id,
        clientId: expect.any(String),
        requestId: 'observed-call-1',
        tool: 'get_my_account',
      },
      {
        accountId: id,
        clientId: expect.any(String),
        requestId: 'observed-call-1',
        tool: 'unknown',
      },
    ]);
    await client.close();
  });

  it('counts a revoked grant, a suspended account and a missing account by reason', async () => {
    const counted = jest.spyOn(metrics, 'recordAuthFailure');
    const revoked = await newAccount();
    const revokedToken = await tokenFor(revoked.id);
    await initialize(revokedToken);
    await prisma.assistantGrant.updateMany({
      data: { revokedAt: new Date(), revokedBy: 'person' },
      where: { accountId: revoked.id },
    });
    const suspended = await newAccount();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: suspended.id },
    });

    await initialize(revokedToken);
    await initialize(await tokenFor(suspended.id));
    await initialize(await tokenFor('00000000-0000-4000-8000-000000000000'));

    expect(counted.mock.calls).toEqual([
      ['revoked'],
      ['suspended'],
      ['no_account'],
    ]);
  });
});

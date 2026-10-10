import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AuditService, createPrisma } from '@motor-fix/domain';
import { databaseTurn } from '@motor-fix/domain/testing';
import { catalogue, defineTool } from '@motor-fix/mcp-tools';
import { type INestApplication, Logger } from '@nestjs/common';

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

// An owner of a garage with one mechanic and nothing booked yet.
async function newOwner() {
  const garage = await prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `atelier-${Date.now()}-${Math.random()}`,
      status: 'approved',
    },
  });
  const account = await prisma.account.create({
    data: {
      language: 'ro',
      lastRole: 'garage',
      name: 'Mihai Dobre',
      roles: { create: [{ role: 'garage' }] },
    },
  });
  await prisma.garageMember.create({
    data: { accountId: account.id, garageId: garage.id, role: 'owner' },
  });
  await prisma.mechanic.create({
    data: { garageId: garage.id, name: 'Vlad Stan' },
  });
  return account;
}

const GARAGE_READS: [string, Record<string, unknown>][] = [
  ['list_quote_requests', {}],
  ['get_schedule', {}],
  ['get_day_sheet', { mechanic: 'Vlad' }],
  ['get_stats', {}],
];

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

  // @traces 374-FR-001 374-FR-011
  it('lists the garage reads to an owner and answers each through the real services', async () => {
    const { id } = await newOwner();
    const client = await connect(await tokenFor(id));

    const { tools } = await client.listTools();
    const answers = [];
    for (const [name, args] of GARAGE_READS)
      answers.push(await client.callTool({ arguments: args, name }));

    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'decline_quote_request',
        'get_my_account',
        ...GARAGE_READS.map(([name]) => name),
      ].sort(),
    );
    for (const answer of answers) {
      expect(answer.isError).toBeFalsy();
      expect(answer.structuredContent).toHaveProperty('note');
    }
    await client.close();
  });

  // @traces 374-FR-003 374-FR-006
  it('drops the lift and the day sheet when the garage switches them off', async () => {
    const { id } = await newOwner();
    const { garageId } = await prisma.garageMember.findFirstOrThrow({
      where: { accountId: id },
    });
    await prisma.garageFeature.createMany({
      data: [
        { enabled: false, garageId, key: 'lift_schedule' },
        { enabled: false, garageId, key: 'day_sheets' },
      ],
    });
    const client = await connect(await tokenFor(id));

    const { tools } = await client.listTools();
    const sheet = await client.callTool({
      arguments: { mechanic: 'Vlad' },
      name: 'get_day_sheet',
    });
    const lift = await client.callTool({
      arguments: { lift: 1 },
      name: 'get_schedule',
    });
    const schedule = await client.callTool({
      arguments: {},
      name: 'get_schedule',
    });

    expect(tools.map((t) => t.name)).not.toContain('get_day_sheet');
    const codeOf = (answer: typeof sheet) =>
      JSON.parse((answer.content as { text: string }[])[0].text).code;
    expect(codeOf(sheet)).toBe('not_found');
    expect(codeOf(lift)).toBe('validation');
    expect(schedule.isError).toBeFalsy();
    expect(schedule.structuredContent).toMatchObject({ lifts: false });
    expect(schedule.structuredContent).not.toHaveProperty('byLift');
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

  // @traces 374-FR-014
  it('observes each garage read under its own tool name', async () => {
    const observed = jest.spyOn(metrics, 'observeToolCall');
    const { id } = await newOwner();
    const client = await connect(await tokenFor(id));

    for (const [name, args] of GARAGE_READS)
      await client.callTool({ arguments: args, name });

    expect(observed.mock.calls.map(([call]) => call.tool)).toEqual(
      GARAGE_READS.map(([name]) => name),
    );
    for (const [call] of observed.mock.calls)
      expect(Object.keys(call).sort()).toEqual([
        'accountId',
        'clientId',
        'requestId',
        'tool',
      ]);
    await client.close();
  });

  // @traces 374-FR-014
  it('logs each garage read as one line with its outcome and no input', async () => {
    const lines = jest.spyOn(Logger.prototype, 'log');
    const { id } = await newOwner();
    const client = await connect(await tokenFor(id));

    for (const [name, args] of GARAGE_READS)
      await client.callTool({ arguments: args, name });
    await client.callTool({
      arguments: { from: 'not-a-day' },
      name: 'get_schedule',
    });

    const logged = lines.mock.calls
      .map(([line]) => line as Record<string, unknown>)
      .filter((line) => typeof line === 'object' && line && 'tool' in line);
    expect(logged.map(({ outcome, tool }) => [tool, outcome])).toEqual([
      ...GARAGE_READS.map(([name]) => [name, 'ok']),
      ['get_schedule', 'refused'],
    ]);
    for (const line of logged)
      expect(Object.keys(line).sort()).toEqual([
        'accountId',
        'clientId',
        'ms',
        'outcome',
        'requestId',
        'tool',
      ]);
    expect(JSON.stringify(logged)).not.toMatch(/Vlad|not-a-day|\+40|plate/i);
    await client.close();
  });

  // @traces 374-FR-012
  it('still answers the four reads for a suspended garage', async () => {
    const { id } = await newOwner();
    const { garageId } = await prisma.garageMember.findFirstOrThrow({
      where: { accountId: id },
    });
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garageId },
    });
    const client = await connect(await tokenFor(id));

    const { tools } = await client.listTools();
    const answers = [];
    for (const [name, args] of GARAGE_READS)
      answers.push(await client.callTool({ arguments: args, name }));

    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(GARAGE_READS.map(([name]) => name)),
    );
    for (const answer of answers) expect(answer.isError).toBeFalsy();
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

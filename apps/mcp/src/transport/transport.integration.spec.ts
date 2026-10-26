import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts';
import {
  AuditService,
  createPrisma,
  ROUTE_LIMITS,
  voidAssistantConfirmations,
} from '@motor-fix/domain';
import { databaseTurn, TURN_WAIT_MS } from '@motor-fix/domain/testing';
import { catalogue, defineTool } from '@motor-fix/mcp-tools';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { type INestApplication, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import {
  TEST_MCP_URL,
  type TestIssuer,
  testIssuer,
} from '../auth/auth.issuer.testing';
import { createMcpApp } from '../mcp.module';
import * as metrics from '../metrics/metrics';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const store = new Redis(redisUrl);
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
    { databaseUrl, issuer: realm.issuer, mcpUrl: TEST_MCP_URL, redisUrl },
    [...catalogue, touchAccount],
  );
  await app.listen(0, '127.0.0.1');
  const address = (app.getHttpServer() as Server).address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
}, TURN_WAIT_MS);

afterAll(async () => {
  await app?.close();
  await realm?.close();
  await prisma.$disconnect();
  await store.quit();
  await turn.release();
});

const accepted = (version?: string) => ({
  create: [
    {
      kind: 'terms' as const,
      language: 'ro' as const,
      method: 'google' as const,
      textVersion: version ?? TERMS_VERSION,
    },
    {
      kind: 'privacy_notice' as const,
      language: 'ro' as const,
      method: 'google' as const,
      textVersion: version ?? PRIVACY_VERSION,
    },
  ],
});

const newAccount = (acceptedVersion?: string) =>
  prisma.account.create({
    data: {
      consents: accepted(acceptedVersion),
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
      consents: accepted(),
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
      'confirm_action',
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
        'confirm_action',
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
    // The schedule service refuses a lift filter with the lifts off (ST-150).
    expect(codeOf(lift)).toBe('validation_failed');
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

  // @traces 1204-FR-005
  it('refuses an owner who has not accepted the texts in force with 403 and no challenge, then answers once they have', async () => {
    const { id } = await newAccount('2026-10-11');
    const token = await tokenFor(id);

    const refused = await initialize(token);

    expect(refused.status).toBe(403);
    expect(refused.headers.get('www-authenticate')).toBeNull();
    expect(await refused.json()).toMatchObject({
      code: 'consent_required',
      privacyVersion: PRIVACY_VERSION,
      termsVersion: TERMS_VERSION,
    });
    expect(
      await prisma.assistantGrant.count({ where: { accountId: id } }),
    ).toBe(0);

    await prisma.accountConsent.updateMany({
      data: { textVersion: TERMS_VERSION },
      where: { accountId: id, kind: 'terms' },
    });
    await prisma.accountConsent.updateMany({
      data: { textVersion: PRIVACY_VERSION },
      where: { accountId: id, kind: 'privacy_notice' },
    });
    const client = await connect(token);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await client.close();
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

// A driver's open request sent to the owner's garage, not answered yet.
async function openRequestFor(ownerId: string) {
  const { garageId } = await prisma.garageMember.findFirstOrThrow({
    where: { accountId: ownerId },
  });
  const driver = await prisma.account.create({
    data: {
      consents: accepted(),
      language: 'ro',
      lastRole: 'driver',
      name: 'Andrei Ion Marin',
      roles: { create: [{ role: 'driver' }] },
    },
  });
  const key = `mini-${Date.now()}-${Math.random()}`;
  const brand = await prisma.brand.create({
    data: { key, name: key, slug: key },
  });
  const car = await prisma.car.create({
    data: {
      brandId: brand.id,
      engine: '2.0 turbo',
      fuel: 'petrol',
      idempotencyKey: key,
      model: 'Cooper S',
      odometerKm: 84_000,
      ownerId: driver.id,
      plate: 'B123ABC',
      year: 2019,
    },
  });
  const request = await prisma.quoteRequest.create({
    data: {
      carBrand: 'Mini',
      carEngine: '2.0 turbo',
      carFuel: 'petrol',
      carId: car.id,
      carModel: 'Cooper S',
      carYear: 2019,
      description: 'Scârțâie la frânare',
      driverId: driver.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
      idempotencyKey: key,
      status: 'sent',
    },
  });
  const recipient = await prisma.requestRecipient.create({
    data: { garageId, requestId: request.id, source: 'search' },
  });
  return { driver, garageId, recipient, request };
}

const DECLINE = 'decline_quote_request';
const answerOf = (result: unknown) =>
  (result as { structuredContent: Record<string, unknown> }).structuredContent;
const textOf = (result: unknown) =>
  JSON.parse((result as { content: { text: string }[] }).content[0].text);

async function proposed(ownerId: string) {
  const seeded = await openRequestFor(ownerId);
  const args = { reason: 'fully_booked', requestId: seeded.request.id };
  const client = await connect(await tokenFor(ownerId));
  const first = answerOf(
    await client.callTool({ arguments: args, name: DECLINE }),
  );
  await client.close();
  return { args, first, ...seeded };
}

const confirm = (
  client: Client,
  confirmationId: unknown,
  args: Record<string, unknown>,
  confirmed = true,
) =>
  client.callTool({
    arguments: { arguments: args, confirmationId, confirmed },
    name: 'confirm_action',
  });

const declinedEvents = async (requestId: string) =>
  (
    await prisma.outboxEvent.findMany({ where: { kind: 'request.declined' } })
  ).filter(
    (e) => (e.payload as { requestId?: string }).requestId === requestId,
  );

const recipientNow = (id: string) =>
  prisma.requestRecipient.findUniqueOrThrow({ where: { id } });

const confirmationNow = (id: unknown) =>
  prisma.assistantConfirmation.findUniqueOrThrow({ where: { id: String(id) } });

// @traces 1253-assistant-confirm-FR-001 1253-assistant-confirm-FR-004 1253-assistant-confirm-FR-006 1253-assistant-confirm-FR-011
describe('an acting tool through the MCP endpoint', () => {
  it('answers confirmation_required first and writes nothing', async () => {
    const { id } = await newOwner();

    const { first, recipient, request } = await proposed(id);

    expect(first).toMatchObject({
      status: 'confirmation_required',
      tool: DECLINE,
    });
    expect(first['summary']).toContain('Atelier Dinamo');
    expect(first['summary']).toContain('Andrei');
    expect(first['summary']).toContain('Mini Cooper S (2019)');
    expect(first['summary']).not.toMatch(/B123ABC|Marin/);
    expect(await recipientNow(recipient.id)).toMatchObject({
      declinedAt: null,
      status: 'waiting',
    });
    expect(await declinedEvents(request.id)).toEqual([]);
    expect(await confirmationNow(first['confirmationId'])).toMatchObject({
      status: 'waiting',
      tool: DECLINE,
    });
  });

  it('declines once on the yes, as the screen does, stamped as the assistant', async () => {
    const owner = await newOwner();
    const { args, first, garageId, driver, recipient, request } =
      await proposed(owner.id);
    const client = await connect(await tokenFor(owner.id), {
      'x-request-id': 'confirm-request-9',
    });

    const yes = await confirm(client, first['confirmationId'], args);

    expect(yes.isError).toBeFalsy();
    expect(answerOf(yes)).toMatchObject({
      declineReason: 'fully_booked',
      status: 'declined',
    });
    expect(await recipientNow(recipient.id)).toMatchObject({
      declineReason: 'fully_booked',
      status: 'declined',
    });
    const events = await declinedEvents(request.id);
    expect(events.map((e) => e.payload)).toEqual([
      {
        driverId: driver.id,
        from: 'waiting',
        garageId,
        reason: 'fully_booked',
        recipientId: recipient.id,
        requestId: request.id,
        to: 'declined',
      },
    ]);
    const grant = await prisma.assistantGrant.findFirstOrThrow({
      where: { accountId: owner.id },
    });
    expect(
      await prisma.activityLog.findMany({
        where: { subjectId: recipient.id },
      }),
    ).toEqual([
      expect.objectContaining({
        assistantGrantId: grant.id,
        requestId: 'confirm-request-9',
        viaAssistant: true,
      }),
    ]);
    expect(await confirmationNow(first['confirmationId'])).toMatchObject({
      status: 'done',
    });
    await client.close();
  });

  it('answers a repeated yes and two at once with the first outcome, running it once', async () => {
    const owner = await newOwner();
    const { args, first, recipient, request } = await proposed(owner.id);
    const client = await connect(await tokenFor(owner.id));

    const [a, b] = await Promise.all([
      confirm(client, first['confirmationId'], args),
      confirm(client, first['confirmationId'], args),
    ]);
    const again = await confirm(client, first['confirmationId'], args);

    expect(answerOf(a)).toEqual(answerOf(b));
    expect(answerOf(again)).toEqual(answerOf(a));
    expect(await declinedEvents(request.id)).toHaveLength(1);
    expect(
      await prisma.activityLog.count({ where: { subjectId: recipient.id } }),
    ).toBe(1);
    await client.close();
  });

  it('lists confirm_action and no output schema on the acting tool', async () => {
    const { id } = await newOwner();
    const client = await connect(await tokenFor(id));

    const { tools } = await client.listTools();

    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('confirm_action')).toBeDefined();
    expect(byName.get('confirm_action')).not.toHaveProperty('outputSchema');
    expect(byName.get(DECLINE)).not.toHaveProperty('outputSchema');
    expect(byName.get('get_stats')).toHaveProperty('outputSchema');
    await client.close();
  });
});

// @traces 1253-assistant-confirm-FR-005 1253-assistant-confirm-FR-007
describe('a confirmation the person can no longer give', () => {
  it('refuses the yes after the grant is revoked, the row void and nothing sent', async () => {
    const owner = await newOwner();
    const { args, first, recipient } = await proposed(owner.id);
    const token = await tokenFor(owner.id);
    // As revokeAssistantGrants does it: the grants and their waiting rows
    // in one transaction.
    await prisma.$transaction(async (tx) => {
      const grants = await tx.assistantGrant.updateManyAndReturn({
        data: { revokedAt: new Date(), revokedBy: 'person' },
        select: { id: true },
        where: { accountId: owner.id },
      });
      await voidAssistantConfirmations(tx, {
        grantIds: grants.map((g) => g.id),
      });
    });

    const res = await fetch(`${base}/mcp`, {
      body: JSON.stringify({
        id: 2,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            arguments: args,
            confirmationId: first['confirmationId'],
            confirmed: true,
          },
          name: 'confirm_action',
        },
      }),
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'assistant_grant_revoked' });
    expect(await confirmationNow(first['confirmationId'])).toMatchObject({
      status: 'void',
    });
    expect(await recipientNow(recipient.id)).toMatchObject({
      status: 'waiting',
    });
  });

  it('answers assistant_act_off with the switch off and voids the waiting row; a later yes sends nothing', async () => {
    const owner = await newOwner();
    const { args, first, recipient } = await proposed(owner.id);
    await prisma.account.update({
      data: { assistantCanAct: false },
      where: { id: owner.id },
    });
    const client = await connect(await tokenFor(owner.id));

    const declined = await client.callTool({ arguments: args, name: DECLINE });
    const off = await confirm(client, first['confirmationId'], args);

    expect(textOf(declined)).toMatchObject({ code: 'assistant_act_off' });
    expect(answerOf(off)).toMatchObject({ code: 'assistant_act_off' });
    expect(await confirmationNow(first['confirmationId'])).toMatchObject({
      status: 'void',
    });

    await prisma.account.update({
      data: { assistantCanAct: true },
      where: { id: owner.id },
    });
    const late = await confirm(client, first['confirmationId'], args);

    expect(answerOf(late)).toMatchObject({
      reason: 'void',
      status: 'not_sent',
    });
    expect(await recipientNow(recipient.id)).toMatchObject({
      status: 'waiting',
    });
    await client.close();
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

// @traces 1181-FR-001
// @traces 1181-FR-003
// @traces 1181-FR-004
// @traces 1181-FR-008
// @traces 1181-FR-011
describe('the MCP endpoint past its limit', () => {
  const { key, limit, windowSeconds } = ROUTE_LIMITS.assistant;
  const countOf = (accountId: string) =>
    `${key}:${createHash('sha256').update(accountId).digest('hex')}`;
  // Brings the account to `calls` in the window without making them.
  const used = (accountId: string, calls: number) =>
    store.set(countOf(accountId), calls, 'EX', windowSeconds);
  const touched = (accountId: string) =>
    prisma.activityLog.count({ where: { actorId: accountId } });

  it('counts every call, refuses the one past the limit with the wait, runs no tool, and counts the refusal', async () => {
    const reader = countedMetrics();
    const refusals = () =>
      counterTotal(reader, 'motorfix_rate_limit_refusals_total', {
        route: 'POST /mcp',
      });
    const { id } = await newAccount();
    const client = await connect(await tokenFor(id));
    await used(id, limit - 1);
    const before = await touched(id);

    const last = await client.callTool({
      arguments: {},
      name: 'touch_account',
    });
    const refused = await initialize(await tokenFor(id));

    expect(last.isError).toBeFalsy();
    expect(await touched(id)).toBe(before + 1);
    expect(refused.status).toBe(429);
    const wait = Number(refused.headers.get('retry-after'));
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(windowSeconds);
    expect(await refused.json()).toMatchObject({
      code: 'rate_limited',
      retryAfterSeconds: wait,
    });
    await expect(
      client.callTool({ arguments: {}, name: 'touch_account' }),
    ).rejects.toThrow();
    expect(await touched(id)).toBe(before + 1);
    expect(await refusals()).toBe(2);
    await client.close().catch(() => undefined);
  });

  it('admits the account again once its window is over', async () => {
    const { id } = await newAccount();
    const token = await tokenFor(id);
    await used(id, limit);
    expect((await initialize(token)).status).toBe(429);

    await store.del(countOf(id));

    expect((await initialize(token)).status).toBe(200);
  });

  it('never refuses a second account for the first one’s count', async () => {
    const first = await newAccount();
    const second = await newAccount();
    await used(first.id, limit);

    expect((await initialize(await tokenFor(second.id))).status).toBe(200);
  });

  it('spends no count on a call without a token', async () => {
    const before = (await store.keys(`${key}:*`)).length;

    expect((await initialize()).status).toBe(401);

    expect((await store.keys(`${key}:*`)).length).toBe(before);
  });
});

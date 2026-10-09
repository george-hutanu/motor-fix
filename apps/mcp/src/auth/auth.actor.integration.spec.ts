import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  AccountLoader,
  type Actor,
  AuditService,
  createPrisma,
  maintenanceOff,
  outbox,
} from '@motor-fix/domain';
import { databaseTurn } from '@motor-fix/domain/testing';
import { callTool, defineTool, type ToolContext } from '@motor-fix/mcp-tools';
import { HttpException } from '@nestjs/common';

import { McpActorService } from './auth.actor';
import { AssistantGrants } from './auth.grants';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
const turn = databaseTurn(databaseUrl);
const loader = new AccountLoader(prisma);
const actors = new McpActorService(
  loader,
  new AssistantGrants(prisma, new AuditService(), outbox),
);

beforeAll(turn.take, 120_000);
afterAll(async () => {
  await prisma.$disconnect();
  await turn.release();
});

const seen: Actor[] = [];
const whoAmI = (name: string, roles: Actor['role'][]) =>
  defineTool({
    acts: false,
    annotations: { destructiveHint: false, readOnlyHint: true },
    description: 'Fixture: answers with the actor it ran as.',
    handler: async (actor) => {
      seen.push(actor);
      return { role: actor.role };
    },
    inputSchema: {},
    name,
    roles,
  });
const tools = [
  whoAmI('as_driver', ['driver']),
  whoAmI('as_garage', ['garage']),
];
const ctx: ToolContext = {
  accounts: loader,
  featureOn: async () => true,
  maintenance: maintenanceOff,
};

const auth = (accountId: string): AuthInfo => ({
  clientId: 'https://claude.ai/oauth/mcp-client',
  expiresAt: Math.floor(Date.now() / 1000) + 900,
  extra: { accountId },
  scopes: ['motorfix.read'],
  token: 'unused',
});

const newAccount = (status: 'active' | 'suspended' | 'deleted' = 'active') =>
  prisma.account.create({
    data: {
      language: 'en',
      lastRole: 'garage',
      name: 'Maria Pop',
      roles: { create: [{ role: 'driver' }, { role: 'garage' }] },
      status,
    },
  });

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return { body: http.getResponse(), status: http.getStatus() };
};

// @traces 365-FR-005 365-FR-017
describe('the actor of an assistant call', () => {
  beforeEach(() => {
    seen.length = 0;
  });

  it('carries every role, the grant, the request, the scopes and the language', async () => {
    const { id } = await newAccount();

    const caller = await actors.caller(auth(id), 'request-actor');
    await callTool(tools, caller, ctx, 'as_garage', {});
    await callTool(tools, caller, ctx, 'as_driver', {});

    expect(seen).toEqual([
      expect.objectContaining({
        accountId: id,
        assistantGrantId: caller.grantId,
        language: 'en',
        requestId: 'request-actor',
        role: 'garage',
        roles: expect.arrayContaining(['driver', 'garage']),
        scopes: ['motorfix.read'],
        via: 'assistant',
      }),
      expect.objectContaining({ role: 'driver' }),
    ]);
  });

  it('refuses a deleted account with 401', async () => {
    const { id } = await newAccount('deleted');

    const { body, status } = await refusal(actors.caller(auth(id), 'r'));

    expect(status).toBe(401);
    expect(body).toMatchObject({ code: 'sign_in_required' });
  });

  it('refuses a suspended account with 403 account_suspended', async () => {
    const { id } = await newAccount('suspended');

    const { body, status } = await refusal(actors.caller(auth(id), 'r'));

    expect(status).toBe(403);
    expect(body).toMatchObject({ code: 'account_suspended' });
  });

  it('answers not_found for a tool of a role the account no longer holds', async () => {
    const { id } = await newAccount();
    await prisma.accountRole.delete({
      where: { accountId_role: { accountId: id, role: 'garage' } },
    });

    const caller = await actors.caller(auth(id), 'request-after');
    const result = await callTool(tools, caller, ctx, 'as_garage', {});

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
    expect(seen).toEqual([]);
  });
});

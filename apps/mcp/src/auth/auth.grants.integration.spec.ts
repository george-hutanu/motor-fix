import { randomUUID } from 'node:crypto';

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  AccountLoader,
  AuditService,
  createPrisma,
  outbox,
} from '@motor-fix/domain';
import { databaseTurn } from '@motor-fix/domain/testing';
import { HttpException } from '@nestjs/common';

import { McpActorService } from './auth.actor';
import { AssistantGrants } from './auth.grants';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
const turn = databaseTurn(databaseUrl);
const grants = new AssistantGrants(prisma, new AuditService(), outbox);
const actors = new McpActorService(new AccountLoader(prisma), grants);

beforeAll(turn.take, 120_000);
afterAll(async () => {
  await prisma.$disconnect();
  await turn.release();
});

const CLAUDE = 'https://claude.ai/oauth/mcp-client';

const newAccount = async () =>
  prisma.account.create({
    data: {
      lastRole: 'driver',
      name: 'Andrei Ionescu',
      roles: { create: [{ role: 'driver' }] },
    },
  });

const auth = (
  accountId: string,
  clientId = CLAUDE,
  scopes = ['motorfix.read', 'motorfix.act'],
): AuthInfo => ({
  clientId,
  expiresAt: Math.floor(Date.now() / 1000) + 900,
  extra: { accountId },
  scopes,
  token: 'unused',
});

const grantOf = (accountId: string, clientId = CLAUDE) =>
  prisma.assistantGrant.findUniqueOrThrow({
    where: { accountId_clientId: { accountId, clientId } },
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

// @traces 365-FR-004 365-FR-016
describe('the assistant grant on each call', () => {
  it('creates the grant at the first call with its audit entry and live event', async () => {
    const { id } = await newAccount();

    const caller = await actors.caller(auth(id), 'request-first');

    const grant = await grantOf(id);
    expect(caller.grantId).toBe(grant.id);
    expect(grant).toMatchObject({
      canAct: true,
      canRead: true,
      clientName: 'claude.ai',
      revokedAt: null,
    });
    const audit = await prisma.activityLog.findMany({
      where: { subjectId: grant.id },
    });
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: id,
        assistantGrantId: grant.id,
        requestId: 'request-first',
        subjectType: 'assistant_grant',
        viaAssistant: true,
      }),
    ]);
    const events = await prisma.outboxEvent.findMany({
      where: { subjectId: grant.id },
    });
    expect(events).toEqual([
      expect.objectContaining({
        audience: [`account:${id}`],
        kind: 'assistant_grant.created',
        payload: {
          canAct: true,
          canRead: true,
          clientName: 'claude.ai',
          grantId: grant.id,
        },
      }),
    ]);
  });

  it('names a client whose id is not an address by the id itself', async () => {
    const { id } = await newAccount();

    await actors.caller(auth(id, 'mcp-inspector'), 'request-1');

    expect((await grantOf(id, 'mcp-inspector')).clientName).toBe(
      'mcp-inspector',
    );
  });

  it('keeps one grant per account and client over many calls', async () => {
    const { id } = await newAccount();

    await Promise.all(
      Array.from({ length: 5 }, (_, n) =>
        actors.caller(auth(id), `request-${n}`),
      ),
    );

    expect(
      await prisma.assistantGrant.count({ where: { accountId: id } }),
    ).toBe(1);
    const grant = await grantOf(id);
    expect(
      await prisma.outboxEvent.count({ where: { subjectId: grant.id } }),
    ).toBe(1);
  });

  it('leaves last used alone within a minute and rewrites it after', async () => {
    const { id } = await newAccount();
    await actors.caller(auth(id), 'request-1');
    const recent = new Date(Date.now() - 30_000);
    await prisma.assistantGrant.update({
      data: { lastUsedAt: recent },
      where: { accountId_clientId: { accountId: id, clientId: CLAUDE } },
    });

    await actors.caller(auth(id), 'request-2');

    expect((await grantOf(id)).lastUsedAt).toEqual(recent);

    const old = new Date(Date.now() - 61_000);
    await prisma.assistantGrant.update({
      data: { lastUsedAt: old },
      where: { accountId_clientId: { accountId: id, clientId: CLAUDE } },
    });
    const before = Date.now();

    await actors.caller(auth(id), 'request-3');

    expect((await grantOf(id)).lastUsedAt.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
  });

  it('records the scopes again when the token carries other ones', async () => {
    const { id } = await newAccount();
    await actors.caller(auth(id), 'request-1');

    const caller = await actors.caller(
      auth(id, CLAUDE, ['motorfix.read']),
      'request-2',
    );

    expect(caller.scopes).toEqual(['motorfix.read']);
    expect(await grantOf(id)).toMatchObject({ canAct: false, canRead: true });
  });

  it('refuses the next call once the grant is revoked, the token still valid', async () => {
    const { id } = await newAccount();
    await actors.caller(auth(id), 'request-1');
    await prisma.assistantGrant.update({
      data: { revokedAt: new Date(), revokedBy: 'person' },
      where: { accountId_clientId: { accountId: id, clientId: CLAUDE } },
    });

    const { body, status } = await refusal(
      actors.caller(auth(id), 'request-2'),
    );

    expect(status).toBe(401);
    expect(body).toMatchObject({ code: 'assistant_grant_revoked' });
  });

  it('refuses an account id that matches no account and keeps no grant', async () => {
    const missing = randomUUID();

    const { body, status } = await refusal(
      actors.caller(auth(missing), 'request-1'),
    );

    expect(status).toBe(401);
    expect(body).toMatchObject({ code: 'sign_in_required' });
    expect(
      await prisma.assistantGrant.count({ where: { accountId: missing } }),
    ).toBe(0);
  });
});

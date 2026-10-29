import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts';
import { AccountLoader, createPrisma, outbox } from '@motor-fix/domain';
import { databaseTurn, TURN_WAIT_MS } from '@motor-fix/domain/testing';

import { toolContext } from '../context';
import { bookFixture } from '../fixtures.testing';
import { type Caller, callTool } from '../registry';
import { confirmAction } from '../tools/confirm-action/confirm-action';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
const turn = databaseTurn(databaseUrl);
const accounts = new AccountLoader(prisma);
const ctx = toolContext({
  accounts,
  maintenance: { on: async () => false },
  outbox,
  prisma,
});
const tools = [bookFixture, confirmAction];
const ARGS = {
  quoteId: '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10',
  shareHistory: true,
};

beforeAll(turn.take, TURN_WAIT_MS);

afterAll(async () => {
  await prisma.$disconnect();
  await turn.release();
});

afterEach(() => jest.restoreAllMocks());

const consents = {
  create: [
    {
      kind: 'terms' as const,
      language: 'ro' as const,
      method: 'google' as const,
      textVersion: TERMS_VERSION,
    },
    {
      kind: 'privacy_notice' as const,
      language: 'ro' as const,
      method: 'google' as const,
      textVersion: PRIVACY_VERSION,
    },
  ],
};

// A driver with an assistant allowed to read and act.
async function driver(): Promise<Caller> {
  const { id } = await prisma.account.create({
    data: {
      consents,
      language: 'ro',
      lastRole: 'driver',
      name: 'Ioana Marin',
      roles: { create: [{ role: 'driver' }] },
    },
  });
  const grant = await prisma.assistantGrant.create({
    data: {
      accountId: id,
      canAct: true,
      canRead: true,
      clientId: 'claude',
      clientName: 'Claude',
    },
  });
  return {
    account: await accounts.activeAccount(id),
    grantId: grant.id,
    requestId: 'request-1',
    scopes: ['motorfix.read', 'motorfix.act'],
  };
}

async function yes(who: Caller) {
  const first = await callTool(tools, who, ctx, 'book_fixture', ARGS);
  const { confirmationId } = first.structuredContent as {
    confirmationId: string;
  };
  const confirm = () =>
    callTool(tools, who, ctx, 'confirm_action', {
      arguments: ARGS,
      confirmationId,
      confirmed: true,
    });
  return { confirm, confirmationId };
}

// @traces 1254-assistant-approvals-FR-002
describe('a tool needing in-app approval through confirm_action', () => {
  it('saves one pending approval with its event and runs nothing of the action', async () => {
    const handler = jest.spyOn(bookFixture, 'handler');
    const who = await driver();
    const { confirm, confirmationId } = await yes(who);

    const result = await confirm();

    const { approvalId } = result.structuredContent as { approvalId: string };
    const rows = await prisma.assistantApproval.findMany({
      where: { accountId: who.account.id },
    });
    expect(result.structuredContent).toEqual({
      approvalId: rows[0]?.id,
      expiresAt: rows[0]?.expiresAt.toISOString(),
      message: 'Aprobă în aplicația MotorFix.',
      status: 'approval_required',
    });
    expect(rows).toEqual([
      expect.objectContaining({
        arguments: ARGS,
        editable: ['shareHistory'],
        grantId: who.grantId,
        kind: 'book',
        status: 'pending',
        tool: 'book_fixture',
      }),
    ]);
    expect(handler).not.toHaveBeenCalled();
    expect(
      await prisma.activityLog.count({ where: { actorId: who.account.id } }),
    ).toBe(0);
    expect(
      await prisma.outboxEvent.findMany({
        select: { kind: true, subjectId: true },
        where: { audience: { has: `account:${who.account.id}` } },
      }),
    ).toEqual([
      { kind: 'assistant_approval.requested', subjectId: approvalId },
    ]);
    expect(
      await prisma.assistantConfirmation.findUniqueOrThrow({
        where: { id: confirmationId },
      }),
    ).toMatchObject({ status: 'done' });
  });

  it('replays the answer on a repeated yes and saves no second approval', async () => {
    const who = await driver();
    const { confirm } = await yes(who);

    const first = await confirm();
    const again = await confirm();

    expect(again.structuredContent).toEqual(first.structuredContent);
    expect(
      await prisma.assistantApproval.count({
        where: { accountId: who.account.id },
      }),
    ).toBe(1);
  });
});

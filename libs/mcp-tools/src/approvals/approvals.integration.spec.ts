import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts';
import {
  AccountLoader,
  type Actor,
  AssistantApprovals,
  AuditService,
  createPrisma,
  outbox,
} from '@motor-fix/domain';
import { databaseTurn, TURN_WAIT_MS } from '@motor-fix/domain/testing';

import { approveApproval } from './approvals';
import { toolContext } from '../context';
import { ToolRefusal } from '../errors';
import { bookFixture } from '../fixtures.testing';
import { type Caller, callTool, type Step } from '../registry';
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

afterEach(() => vi.restoreAllMocks());

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

// @traces 1254-FR-002 1254-FR-012
describe('a tool needing in-app approval through confirm_action', () => {
  it('saves one pending approval with its event and runs nothing of the action', async () => {
    const handler = vi.spyOn(bookFixture, 'handler');
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

const audit = new AuditService();
const approvals = new AssistantApprovals(prisma, audit, outbox);
const deps = { approvals, ctx, prisma, tools };

// A pending approval of the driver's, opened through the yes.
async function pending(who: Caller): Promise<string> {
  const { confirm } = await yes(who);
  const { approvalId } = (await confirm()).structuredContent as {
    approvalId: string;
  };
  return approvalId;
}

const by = (who: Caller) => ({
  id: who.account.id,
  requestId: 'api-request-1',
  role: 'driver' as const,
});

const approve = (who: Caller, id: string, options?: Record<string, unknown>) =>
  approveApproval(deps, {
    accountId: who.account.id,
    by: by(who),
    id,
    options,
  });

// The use case's own write, as a booking tool's would be.
const writes = async (actor: Actor, _input: unknown, step: Step) => {
  const run = step.run as NonNullable<Step['run']>;
  await audit.record(run.tx, {
    action: 'create',
    actorId: actor.accountId,
    actorRole: actor.role,
    assistantGrantId: actor.assistantGrantId,
    requestId: actor.requestId,
    subjectId: run.key,
    subjectType: 'fixture_booking',
  });
};

const actionRows = (who: Caller) =>
  prisma.activityLog.findMany({
    where: { actorId: who.account.id, subjectType: 'fixture_booking' },
  });

const status = async (id: string) =>
  (await prisma.assistantApproval.findUniqueOrThrow({ where: { id } })).status;

// @traces 1254-FR-005
describe('approving in the app', () => {
  it('runs the action once with the approval as key, via the assistant', async () => {
    const who = await driver();
    const id = await pending(who);
    const handler = vi
      .spyOn(bookFixture, 'handler')
      .mockImplementation(async (actor, input, _ctx, step) => {
        await writes(actor, input, step);
        return { subjectId: id, subjectType: 'fixture_booking' };
      });

    const result = await approve(who, id, { shareHistory: false });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[1]).toEqual({
      ...ARGS,
      shareHistory: false,
    });
    expect(handler.mock.calls[0]?.[3].run?.key).toBe(id);
    expect(result).toMatchObject({
      outcome: { subjectId: id, subjectType: 'fixture_booking' },
      status: 'approved',
    });
    expect(await actionRows(who)).toEqual([
      expect.objectContaining({
        assistantGrantId: who.grantId,
        requestId: 'api-request-1',
      }),
    ]);
    expect(
      await prisma.activityLog.findMany({
        select: { actorId: true, actorRole: true, newValue: true },
        where: { subjectId: id, subjectType: 'assistant_approval' },
      }),
    ).toEqual([
      { actorId: who.account.id, actorRole: 'driver', newValue: 'approved' },
    ]);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'assistant_approval.decided', subjectId: id },
      }),
    ).toBe(1);
  });

  it('runs once on a double tap; the second answers not pending', async () => {
    const who = await driver();
    const id = await pending(who);
    const handler = vi.spyOn(bookFixture, 'handler');

    const answers = await Promise.all([approve(who, id), approve(who, id)]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(answers).toContainEqual({ notPending: 'approved' });
  });

  it('fails with the code and writes nothing of the action when the use case refuses', async () => {
    const who = await driver();
    const id = await pending(who);
    vi.spyOn(bookFixture, 'handler').mockImplementation(
      async (actor, input, _ctx, step) => {
        await writes(actor, input, step);
        throw new ToolRefusal('quote_expired');
      },
    );

    const result = await approve(who, id);

    expect(result).toMatchObject({
      outcome: { code: 'quote_expired' },
      status: 'failed',
    });
    expect(await actionRows(who)).toEqual([]);
  });

  it('refuses without running anything', async () => {
    const who = await driver();
    const id = await pending(who);
    const handler = vi.spyOn(bookFixture, 'handler');

    const result = await approvals.refuse(who.account.id, id, {
      id: who.account.id,
      role: 'driver',
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(handler).not.toHaveBeenCalled();
    expect(await actionRows(who)).toEqual([]);
    expect(await approve(who, id)).toEqual({ notPending: 'refused' });
  });
});

// @traces 1254-FR-006
describe('access checked again at the approval', () => {
  it('expires it when the grant was revoked', async () => {
    const who = await driver();
    const id = await pending(who);
    await prisma.assistantGrant.update({
      data: { revokedAt: new Date() },
      where: { id: who.grantId },
    });

    expect(await approve(who, id)).toEqual({ notPending: 'expired' });
    expect(await status(id)).toBe('expired');
  });

  it("expires it when the account's switch was turned off", async () => {
    const who = await driver();
    const id = await pending(who);
    await prisma.account.update({
      data: { assistantCanAct: false },
      where: { id: who.account.id },
    });

    expect(await approve(who, id)).toEqual({ notPending: 'expired' });
    expect(await status(id)).toBe('expired');
  });

  it('leaves it pending in maintenance', async () => {
    const who = await driver();
    const id = await pending(who);
    const paused = {
      ...deps,
      ctx: { ...ctx, maintenance: { on: async () => true } },
    };

    expect(
      await approveApproval(paused, {
        accountId: who.account.id,
        by: by(who),
        id,
      }),
    ).toBe('maintenance');
    expect(await status(id)).toBe('pending');
  });

  it('answers not found to another account', async () => {
    const who = await driver();
    const other = await driver();
    const id = await pending(who);

    expect(await approve(other, id)).toBe('not_found');
  });
});

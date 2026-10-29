import type {
  AssistantActionApprovalDto,
  AssistantApprovals,
  LockedApproval,
} from '@motor-fix/domain';
import { HttpException } from '@nestjs/common';

import { type ApproveDeps, approveApproval } from './approvals';
import { ToolRefusal } from '../errors';
import { account, bookFixture, context } from '../fixtures.testing';
import type { ToolDefinition } from '../registry';

const ID = '00000000-0000-4000-9000-000000000002';
const ARGS = {
  quoteId: '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10',
  shareHistory: true,
};
const BY = { id: 'account-1', requestId: 'request-1', role: 'driver' as const };

const shown = (): AssistantActionApprovalDto => ({
  assistantName: 'Claude',
  createdAt: new Date(),
  decidedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  id: ID,
  kind: 'book',
  options: [{ key: 'shareHistory', value: true }],
  outcome: null,
  status: 'pending',
  summary: 'Rezervă serviciul de probă.',
  tool: 'book_fixture',
});

const locked = (over: Partial<LockedApproval> = {}): LockedApproval => ({
  accountId: 'account-1',
  arguments: ARGS,
  editable: ['shareHistory'],
  expiresAt: new Date(Date.now() + 60_000),
  grantId: 'grant-1',
  id: ID,
  kind: 'book',
  summary: 'x',
  tool: 'book_fixture',
  ...over,
});

function setup(
  over: {
    grant?: { canAct: boolean; canRead: boolean; revokedAt: Date | null };
    handler?: ToolDefinition['handler'];
    locks?: unknown[];
    lockArguments?: Record<string, unknown>;
    tool?: Partial<ToolDefinition>;
  } = {},
) {
  const tx = {
    $executeRawUnsafe: jest.fn(async () => 0),
    assistantApproval: { updateManyAndReturn: jest.fn(async () => []) },
    assistantConfirmation: { updateManyAndReturn: jest.fn(async () => []) },
    assistantGrant: {
      findUniqueOrThrow: jest.fn(
        async () =>
          over.grant ?? { canAct: true, canRead: true, revokedAt: null },
      ),
    },
  };
  const locks = [...(over.locks ?? [])];
  const approvals = {
    close: jest.fn(async () => true),
    get: jest.fn(async () => shown()),
    lockForDecision: jest.fn(
      async () =>
        (locks.length ? locks.shift() : undefined) ??
        locked({ arguments: over.lockArguments ?? ARGS }),
    ),
  };
  const handler = jest.fn(over.handler ?? (async () => ({ ok: true })));
  const tool = { ...bookFixture, ...over.tool, handler } as ToolDefinition;
  const ctx = {
    ...context({ maintenance: false }),
    accounts: { activeAccount: async () => account({ roles: ['driver'] }) },
  };
  const deps = {
    approvals: approvals as unknown as AssistantApprovals,
    ctx,
    prisma: {
      $transaction: async (run: (t: unknown) => Promise<unknown>) => run(tx),
    },
    tools: [tool],
  } as unknown as ApproveDeps;
  const approve = (options?: Record<string, unknown>) =>
    approveApproval(deps, { accountId: 'account-1', by: BY, id: ID, options });
  return { approvals, approve, handler, tx };
}

// @traces 1254-FR-006
describe('approving with hostile option values', () => {
  it.each([
    ['a string', 'true'],
    ['the number one', 1],
    ['zero', 0],
    ['null', null],
    ['an array', [true]],
    ['an object', { v: true }],
  ])('refuses %s for a declared option and runs nothing', async (_n, value) => {
    const { approvals, approve, handler } = setup();

    expect(await approve({ shareHistory: value })).toEqual({
      invalidOption: 'shareHistory',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(approvals.lockForDecision).not.toHaveBeenCalled();
  });

  it('refuses an attempt to overwrite a stored argument that is not editable', async () => {
    const { approve, handler } = setup();

    expect(await approve({ quoteId: 'attacker-quote' })).toEqual({
      invalidOption: 'quoteId',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses an own __proto__ key from a parsed body', async () => {
    const { approve, handler } = setup();
    const body = JSON.parse('{"__proto__":{"shareHistory":true}}');

    expect(await approve(body)).toEqual({ invalidOption: '__proto__' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses inherited-looking names such as constructor', async () => {
    const { approve, handler } = setup();

    expect(await approve({ constructor: true })).toEqual({
      invalidOption: 'constructor',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a unicode look-alike of a declared option name', async () => {
    const { approve, handler } = setup();

    expect(await approve({ shareHistorу: true })).toEqual({
      invalidOption: 'shareHistorу',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['an empty object', {}],
    ['null', null as unknown as undefined],
  ])('runs with the stored arguments for %s options', async (_n, options) => {
    const { approve, handler } = setup();

    await approve(options);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0] as unknown[])[1]).toEqual(ARGS);
  });
});

// @traces 1254-FR-005
describe('approving when the stored run cannot be trusted', () => {
  it('lets an error that is no refusal fail the call and close nothing', async () => {
    const { approvals, approve } = setup({
      handler: async () => {
        throw new Error('boom');
      },
    });

    await expect(approve()).rejects.toThrow('boom');
    expect(approvals.close).not.toHaveBeenCalled();
  });

  it('fails a tool that no longer declares in-app approval without running it', async () => {
    const { approvals, approve, handler } = setup({
      tool: { approval: undefined },
    });

    await approve();

    expect(handler).not.toHaveBeenCalled();
    expect(approvals.close).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: ID }),
      'failed',
      { code: 'tool_unavailable' },
      BY,
    );
  });

  it('fails stored arguments the tool no longer accepts without running it', async () => {
    const { approvals, approve, handler } = setup({
      lockArguments: { quoteId: 'not-a-uuid', shareHistory: true },
    });

    await approve();

    expect(handler).not.toHaveBeenCalled();
    expect(approvals.close).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'failed',
      { code: 'validation' },
      BY,
    );
  });

  it('fails without running when the grant lost its act scope', async () => {
    const { approvals, approve, handler } = setup({
      grant: { canAct: false, canRead: true, revokedAt: null },
    });

    await approve();

    expect(handler).not.toHaveBeenCalled();
    expect(approvals.close).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'failed',
      expect.objectContaining({ code: expect.any(String) }),
      BY,
    );
  });

  it('expires through the grant when the grant is revoked and the switch is also off', async () => {
    const { approve, handler, tx } = setup({
      grant: { canAct: true, canRead: true, revokedAt: new Date() },
    });

    expect(await approve()).toEqual({ notPending: 'expired' });
    expect(handler).not.toHaveBeenCalled();
    expect(tx.assistantApproval.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: { code: 'revoked' } }),
      }),
    );
  });

  it('runs the action once for two approvals racing on the same row', async () => {
    const { approve, handler } = setup({
      locks: [locked(), { notPending: 'approved' }],
    });

    await approve();
    const second = await approve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ notPending: 'approved' });
  });

  it('answers the status of a row that was decided between the read and the lock', async () => {
    const { approve, handler } = setup({ locks: [{ notPending: 'refused' }] });

    expect(await approve()).toEqual({ notPending: 'refused' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails with the refusal code of a ToolRefusal and rolls the run back', async () => {
    const { approvals, approve, tx } = setup({
      handler: async () => {
        throw new ToolRefusal('slot_taken');
      },
    });

    await approve();

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'ROLLBACK TO SAVEPOINT approval_run',
    );
    expect(approvals.close).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'failed',
      { code: 'slot_taken' },
      BY,
    );
  });

  it('gives an HttpException without a code the code of its status', async () => {
    const { approvals, approve } = setup({
      handler: async () => {
        throw new HttpException('conflict', 409);
      },
    });

    await approve();

    expect(approvals.close).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'failed',
      { code: expect.stringMatching(/^[a-z_]+$/) },
      BY,
    );
  });
});

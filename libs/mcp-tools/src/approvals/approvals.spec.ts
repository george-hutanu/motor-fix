import type {
  AccountLoader,
  AssistantActionApprovalDto,
  AssistantApprovals,
  createPrisma,
  LockedApproval,
} from '@motor-fix/domain';
import { HttpException } from '@nestjs/common';

import { type ApproveDeps, approveApproval } from './approvals';
import { AssistantApprovalsController } from './approvals.controller';
import { ToolRefusal } from '../errors';
import { account, bookFixture, context } from '../fixtures.testing';
import type { ToolDefinition } from '../registry';

const ID = '00000000-0000-4000-9000-000000000001';
const ARGS = {
  quoteId: '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10',
  shareHistory: true,
};
const BY = { id: 'account-1', requestId: 'request-9', role: 'driver' as const };

const shown = (
  over: Partial<AssistantActionApprovalDto> = {},
): AssistantActionApprovalDto => ({
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
  ...over,
});

const locked = (over: Partial<LockedApproval> = {}): LockedApproval => ({
  accountId: 'account-1',
  arguments: ARGS,
  editable: ['shareHistory'],
  expiresAt: new Date(Date.now() + 60_000),
  grantId: 'grant-1',
  id: ID,
  kind: 'book',
  summary: 'Rezervă serviciul de probă.',
  tool: 'book_fixture',
  ...over,
});

function setup(
  over: {
    canAct?: boolean;
    grant?: { canAct: boolean; canRead: boolean; revokedAt: Date | null };
    handler?: ToolDefinition['handler'];
    lock?: Awaited<ReturnType<AssistantApprovals['lockForDecision']>>;
    maintenance?: boolean;
    roles?: ('driver' | 'garage')[];
    shown?: AssistantActionApprovalDto | null;
    tools?: ToolDefinition[];
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
  const approvals = {
    close: jest.fn(async () => true),
    get: jest.fn(async () => (over.shown === undefined ? shown() : over.shown)),
    lockForDecision: jest.fn(async () => over.lock ?? locked()),
  };
  const handler = jest.fn(over.handler ?? (async () => ({ ok: true })));
  const tool: ToolDefinition = { ...bookFixture, handler };
  const activeAccount = jest.fn(async () =>
    account({ canAct: over.canAct, roles: over.roles ?? ['driver'] }),
  );
  const ctx = {
    ...context({ maintenance: over.maintenance ?? false }),
    accounts: { activeAccount },
  };
  const deps = {
    approvals,
    ctx,
    prisma: {
      $transaction: async (run: (t: unknown) => Promise<unknown>) => run(tx),
    },
    tools: over.tools ?? [tool],
  } as unknown as ApproveDeps;
  const approve = (options?: Record<string, unknown>) =>
    approveApproval(deps, { accountId: 'account-1', by: BY, id: ID, options });
  return { activeAccount, approvals, approve, handler, tx };
}

// @traces 1254-FR-005
describe('approving an assistant action', () => {
  it('runs the stored tool once with the approval as key and the edited option', async () => {
    const { approvals, approve, handler, tx } = setup();

    const result = await approve({ shareHistory: false });

    expect(handler).toHaveBeenCalledTimes(1);
    const [actor, input, , step] = handler.mock.calls[0] as unknown as [
      { assistantGrantId: string; via: string },
      unknown,
      unknown,
      { run: { key: string; tx: unknown } },
    ];
    expect(input).toEqual({ ...ARGS, shareHistory: false });
    expect(step.run).toEqual({ key: ID, tx });
    expect(actor).toMatchObject({
      assistantGrantId: 'grant-1',
      via: 'assistant',
    });
    expect(approvals.close).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: ID }),
      'approved',
      null,
      BY,
    );
    expect(result).toMatchObject({ id: ID, status: 'pending' });
  });

  it('keeps the subject the run made as the outcome', async () => {
    const { approvals, approve } = setup({
      handler: async () => ({ subjectId: 'booking-1', subjectType: 'booking' }),
    });

    await approve();

    expect(approvals.close).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'approved',
      { subjectId: 'booking-1', subjectType: 'booking' },
      BY,
    );
  });

  it('fails with the code and rolls back the run when the use case refuses', async () => {
    const { approvals, approve, tx } = setup({
      handler: async () => {
        throw new ToolRefusal('quote_expired');
      },
    });

    await approve();

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'ROLLBACK TO SAVEPOINT approval_run',
    );
    expect(approvals.close).toHaveBeenCalledWith(
      tx,
      expect.anything(),
      'failed',
      { code: 'quote_expired' },
      BY,
    );
  });

  it("fails with a use case's own refusal code", async () => {
    const { approvals, approve } = setup({
      handler: async () => {
        throw new HttpException({ code: 'request_not_open' }, 409);
      },
    });

    await approve();

    expect(approvals.close).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'failed',
      { code: 'request_not_open' },
      BY,
    );
  });

  it.each([
    ['without a code', new HttpException('boom', 500)],
    ['with a code', new HttpException({ code: 'service_unavailable' }, 503)],
  ])(
    'leaves it pending when the run breaks with a 5xx %s',
    async (_, error) => {
      const { approvals, approve } = setup({
        handler: async () => {
          throw error;
        },
      });

      await expect(approve()).rejects.toBe(error);
      expect(approvals.close).not.toHaveBeenCalled();
    },
  );

  it('reads the account only once the approval is locked', async () => {
    const { activeAccount, approvals, approve } = setup();

    await approve();

    expect(activeAccount).toHaveBeenCalledTimes(1);
    expect(approvals.lockForDecision.mock.invocationCallOrder[0]).toBeLessThan(
      activeAccount.mock.invocationCallOrder[0],
    );
  });

  it('fails a role check inside the locked run without running', async () => {
    const { approvals, approve, handler } = setup({ roles: ['garage'] });

    await approve();

    expect(handler).not.toHaveBeenCalled();
    expect(approvals.close).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'failed',
      { code: 'not_found' },
      BY,
    );
  });

  it('fails a tool no longer in the catalogue with a stable code', async () => {
    const { approvals, approve } = setup({ tools: [] });

    await approve();

    expect(approvals.close).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'failed',
      { code: 'tool_unavailable' },
      BY,
    );
  });

  it('answers maintenance before any write, leaving it pending', async () => {
    const { approvals, approve } = setup({ maintenance: true });

    expect(await approve()).toBe('maintenance');
    expect(approvals.lockForDecision).not.toHaveBeenCalled();
  });

  it('expires it through the void function when the grant is revoked', async () => {
    const { approve, handler, tx } = setup({
      grant: { canAct: true, canRead: true, revokedAt: new Date() },
    });

    expect(await approve()).toEqual({ notPending: 'expired' });
    expect(handler).not.toHaveBeenCalled();
    expect(tx.assistantApproval.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { grantId: { in: ['grant-1'] }, status: 'pending' },
      }),
    );
  });

  it("expires it when the account's switch is off", async () => {
    const { approve, handler, tx } = setup({ canAct: false });

    expect(await approve()).toEqual({ notPending: 'expired' });
    expect(handler).not.toHaveBeenCalled();
    expect(tx.assistantApproval.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'account-1', status: 'pending' },
      }),
    );
  });
});

// @traces 1254-FR-006
describe('what approving refuses', () => {
  it.each([
    [{ other: true }, 'other'],
    [{ shareHistory: 'no' }, 'shareHistory'],
  ])('refuses option %j before the lock', async (options, key) => {
    const { approvals, approve } = setup();

    expect(await approve(options)).toEqual({ invalidOption: key });
    expect(approvals.lockForDecision).not.toHaveBeenCalled();
  });

  it('answers the current status of a decided approval and runs nothing', async () => {
    const { approve, handler } = setup({ lock: { notPending: 'refused' } });

    expect(await approve()).toEqual({ notPending: 'refused' });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers not found for another account's or an unknown approval", async () => {
    const { approve } = setup({ shown: null });

    expect(await approve()).toBe('not_found');
  });
});

function controller(
  over: Partial<Record<'get' | 'refuse', jest.Mock>> = {},
  maintenance = false,
) {
  const approvals = {
    get: over.get ?? jest.fn(async () => shown()),
    list: jest.fn(),
    refuse: over.refuse ?? jest.fn(async () => shown({ status: 'refused' })),
  } as unknown as AssistantApprovals;
  return new AssistantApprovalsController(
    approvals,
    {} as ReturnType<typeof createPrisma>,
    {} as AccountLoader,
    { on: async () => maintenance },
  );
}

const ACTOR = { accountId: 'account-1', role: 'driver' } as never;

async function refusalOf(call: Promise<unknown>) {
  const error = await call.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return { body: http.getResponse(), status: http.getStatus() };
}

// @traces 1254-FR-009
describe('the approvals API', () => {
  it('answers 404 to read, approve and refuse an approval not the caller’s', async () => {
    const api = controller({
      get: jest.fn(async () => null),
      refuse: jest.fn(async () => 'not_found'),
    });

    for (const call of [
      api.get(ACTOR, ID),
      api.approve(ACTOR, ID, {}),
      api.refuse(ACTOR, ID),
    ])
      expect(await refusalOf(call)).toMatchObject({
        body: { code: 'not_found' },
        status: 404,
      });
  });

  it('answers 409 approval_not_pending with the current status', async () => {
    const api = controller({
      get: jest.fn(async () => shown({ status: 'expired' })),
      refuse: jest.fn(async () => ({ notPending: 'expired' })),
    });

    expect(await refusalOf(api.refuse(ACTOR, ID))).toMatchObject({
      body: { code: 'approval_not_pending', currentStatus: 'expired' },
      status: 409,
    });
  });

  it('answers 422 invalid_option naming the option', async () => {
    const api = controller();

    expect(
      await refusalOf(api.approve(ACTOR, ID, { options: { other: true } })),
    ).toMatchObject({
      body: { code: 'invalid_option', field: 'other' },
      status: 422,
    });
  });

  it('answers 503 maintenance to approve', async () => {
    const api = controller({}, true);

    expect(await refusalOf(api.approve(ACTOR, ID, {}))).toMatchObject({
      body: { code: 'maintenance' },
      status: 503,
    });
  });

  it('answers 503 service_unavailable when the database is unreachable', async () => {
    const down = Object.assign(new Error('down'), {
      name: 'PrismaClientInitializationError',
    });
    const api = controller({ get: jest.fn(async () => Promise.reject(down)) });

    expect(await refusalOf(api.approve(ACTOR, ID, {}))).toMatchObject({
      body: { code: 'service_unavailable' },
      status: 503,
    });
  });

  it('lets refuse through while in maintenance, and not approve', () => {
    const open = (name: 'approve' | 'refuse') =>
      Reflect.getMetadata(
        'auth:maintenance-open',
        AssistantApprovalsController.prototype[name],
      );

    expect(open('refuse')).toBe(true);
    expect(open('approve')).toBeUndefined();
  });
});

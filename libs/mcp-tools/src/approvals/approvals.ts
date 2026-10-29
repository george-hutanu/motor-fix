import { codeForStatus } from '@motor-fix/contracts';
import {
  type ApprovalDecider,
  type ApprovalOutcome,
  type AssistantActionApprovalDto,
  type AssistantApprovals,
  type createPrisma,
  type LoadedAccount,
  type LockedApproval,
  type Tx,
  voidAssistantConfirmations,
} from '@motor-fix/domain';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';

import { ToolRefusal } from '../errors';
import {
  access,
  type Caller,
  type Scope,
  type ToolContext,
  type ToolDefinition,
} from '../registry';

type Status = AssistantActionApprovalDto['status'];

export type Approving =
  | AssistantActionApprovalDto
  | 'maintenance'
  | 'not_found'
  | { invalidOption: string }
  | { notPending: Status };

export interface ApproveDeps {
  approvals: Pick<AssistantApprovals, 'close' | 'get' | 'lockForDecision'>;
  ctx: ToolContext;
  prisma: Pick<ReturnType<typeof createPrisma>, '$transaction'>;
  tools: ToolDefinition[];
}

interface Grant {
  canAct: boolean;
  canRead: boolean;
  revokedAt: Date | null;
}

// The code a refusing use case is known by; null for anything else, a 5xx
// included, which is no refusal and fails the whole call, leaving the
// approval pending.
function refusalCode(error: unknown): string | null {
  if (error instanceof ToolRefusal) return error.code;
  if (!(error instanceof HttpException) || error.getStatus() >= 500)
    return null;
  const body = error.getResponse() as { code?: unknown };
  return typeof body === 'object' && typeof body.code === 'string'
    ? body.code
    : codeForStatus(error.getStatus());
}

const subjectOf = (output: unknown): ApprovalOutcome => {
  const o = (output ?? {}) as { subjectId?: unknown; subjectType?: unknown };
  return typeof o.subjectId === 'string' && typeof o.subjectType === 'string'
    ? { subjectId: o.subjectId, subjectType: o.subjectType }
    : null;
};

const scopesOf = (grant: Grant): Scope[] => [
  ...(grant.canRead ? (['motorfix.read'] as const) : []),
  ...(grant.canAct ? (['motorfix.act'] as const) : []),
];

// Runs the stored tool as the grant's actor under the row lock; a refusing
// check or use case is rolled back and answered as failed with its code.
async function run(
  deps: ApproveDeps,
  approval: LockedApproval,
  caller: Caller,
  options: Record<string, unknown>,
  tx: Tx,
): Promise<{ outcome: ApprovalOutcome; status: 'approved' | 'failed' }> {
  const failed = (code: string) => ({
    outcome: { code },
    status: 'failed' as const,
  });
  const tool = deps.tools.find((t) => t.name === approval.tool && t.approval);
  if (!tool) return failed('tool_unavailable');
  const actor = await access(tool, caller, deps.ctx);
  if (typeof actor === 'string') return failed(actor);
  const input = z
    .object(tool.inputSchema)
    .safeParse({ ...approval.arguments, ...options });
  if (!input.success) return failed('validation');
  await tx.$executeRawUnsafe('SAVEPOINT approval_run');
  try {
    const output = await tool.handler(actor, input.data, deps.ctx, {
      caller,
      run: { key: approval.id, tx },
      tools: deps.tools,
    });
    return { outcome: subjectOf(output), status: 'approved' };
  } catch (error) {
    const code = refusalCode(error);
    if (code === null) throw error;
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT approval_run');
    return failed(code);
  }
}

// The person's yes in the app: runs the assistant's stored action once, with
// every access check of a tool call made again.
export async function approveApproval(
  deps: ApproveDeps,
  input: {
    accountId: string;
    by: ApprovalDecider;
    id: string;
    options?: Record<string, unknown>;
  },
): Promise<Approving> {
  const shown = await deps.approvals.get(input.accountId, input.id);
  if (!shown) return 'not_found';
  const options = input.options ?? {};
  const editable = new Set(shown.options.map((o) => o.key));
  const wrong = Object.entries(options).find(
    ([key, value]) => !editable.has(key) || typeof value !== 'boolean',
  );
  if (wrong) return { invalidOption: wrong[0] };
  if (await deps.ctx.maintenance.on()) return 'maintenance';
  const decided = await deps.prisma.$transaction(
    async (tx) => {
      const locked = await deps.approvals.lockForDecision(
        tx,
        input.accountId,
        input.id,
      );
      if (locked === 'not_found' || 'notPending' in locked) return locked;
      const account: LoadedAccount = await deps.ctx.accounts.activeAccount(
        input.accountId,
      );
      const grant: Grant = await tx.assistantGrant.findUniqueOrThrow({
        select: { canAct: true, canRead: true, revokedAt: true },
        where: { id: locked.grantId },
      });
      if (grant.revokedAt || !account.assistantCanAct) {
        await voidAssistantConfirmations(
          tx,
          grant.revokedAt
            ? { grantIds: [locked.grantId] }
            : { accountId: input.accountId },
        );
        return { notPending: 'expired' as const };
      }
      const caller: Caller = {
        account,
        grantId: locked.grantId,
        requestId: input.by.requestId ?? '',
        scopes: scopesOf(grant),
      };
      const { outcome, status } = await run(deps, locked, caller, options, tx);
      await deps.approvals.close(tx, locked, status, outcome, input.by);
      return null;
    },
    { timeout: 30_000 },
  );
  return (
    decided ??
    (await deps.approvals.get(input.accountId, input.id)) ??
    'not_found'
  );
}

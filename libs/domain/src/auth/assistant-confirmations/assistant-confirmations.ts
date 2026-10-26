import { codeForStatus } from '@motor-fix/contracts';
import { HttpException, Inject, Injectable } from '@nestjs/common';

import {
  type ConfirmationOutcome,
  recordConfirmation,
} from './assistant-confirmations.metrics';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { PRISMA } from '../prisma';

export type Tx = Prisma.TransactionClient;

type Status = 'waiting' | 'done' | 'failed' | 'refused' | 'expired' | 'void';
type Closed = 'refused' | 'expired' | 'void';

type ConfirmationScope = { grantIds: string[] } | { accountId: string };

interface OpenedConfirmation {
  expiresAt: Date;
  id: string;
}

export type Decision =
  | { output: unknown; replayed: boolean; status: 'done' }
  | { code: string; replayed: true; status: 'failed' }
  | { mismatch: true; status: 'void' }
  | { status: Closed | 'not_found' };

interface Asked {
  argsHash: string;
  confirmed: boolean;
  grantId: string;
}

interface Stored {
  argsHash: string;
  expiresAt: Date;
  grantId: string;
  outcome: unknown;
  status: Status;
}

export type Judgement =
  | { kind: 'run' }
  | { decision: Decision; kind: 'answer' }
  | { decision: Decision; kind: 'close'; status: Closed };

const LIFETIME = '5 minutes';

// What a confirmation answers to `asked` at `now`: run the action, close it
// unrun, or answer what it already holds. A decided one never runs again.
export function judge(row: Stored | null, asked: Asked, now: Date): Judgement {
  if (!row || row.grantId !== asked.grantId)
    return { decision: { status: 'not_found' }, kind: 'answer' };
  const outcome = (row.outcome ?? {}) as { code?: string; output?: unknown };
  if (row.status === 'done')
    return {
      decision: { output: outcome.output, replayed: true, status: 'done' },
      kind: 'answer',
    };
  if (row.status === 'failed')
    return {
      decision: {
        code: outcome.code ?? 'internal_error',
        replayed: true,
        status: 'failed',
      },
      kind: 'answer',
    };
  if (row.status !== 'waiting')
    return { decision: { status: row.status }, kind: 'answer' };
  if (now.getTime() > row.expiresAt.getTime()) return close('expired');
  if (!asked.confirmed) return close('refused');
  if (row.argsHash !== asked.argsHash)
    return {
      decision: { mismatch: true, status: 'void' },
      kind: 'close',
      status: 'void',
    };
  return { kind: 'run' };
}

const close = (status: Closed): Judgement => ({
  decision: { status },
  kind: 'close',
  status,
});

// The stable code a failed run is answered with again on a repeat.
function codeOf(error: unknown): string {
  if (!(error instanceof HttpException)) return 'internal_error';
  const body = error.getResponse() as { code?: unknown };
  return typeof body === 'object' && typeof body.code === 'string'
    ? body.code
    : codeForStatus(error.getStatus());
}

const outcomeOf = (decision: Decision): ConfirmationOutcome => {
  if ('replayed' in decision && decision.replayed) return 'replayed';
  if ('mismatch' in decision) return 'mismatch';
  if (decision.status === 'done') return 'confirmed';
  return decision.status as ConfirmationOutcome;
};

// Turns every waiting confirmation of the grants or the account to void,
// inside the caller's transaction; answers how many.
export async function voidAssistantConfirmations(
  tx: Tx,
  scope: ConfirmationScope,
): Promise<number> {
  const voided = await tx.assistantConfirmation.updateManyAndReturn({
    data: { decidedAt: new Date(), status: 'void' },
    select: { grantId: true, id: true, tool: true },
    where: {
      status: 'waiting',
      ...('grantIds' in scope
        ? { grantId: { in: scope.grantIds } }
        : { accountId: scope.accountId }),
    },
  });
  for (const row of voided)
    recordConfirmation('void', {
      confirmationId: row.id,
      grantId: row.grantId,
      tool: row.tool,
    });
  return voided.length;
}

// The person's yes to an assistant's action, kept in PostgreSQL: opened on
// the action's first call, decided once by `confirm_action` or elicitation.
@Injectable()
export class AssistantConfirmations {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async open(input: {
    accountId: string;
    argsHash: string;
    grantId: string;
    tool: string;
  }): Promise<OpenedConfirmation> {
    const [opened] = await this.prisma.$queryRaw<OpenedConfirmation[]>`
      INSERT INTO assistant_confirmation
        (grant_id, account_id, tool, args_hash, expires_at)
      VALUES (${input.grantId}::uuid, ${input.accountId}::uuid, ${input.tool},
              ${input.argsHash}, now() + ${LIFETIME}::interval)
      RETURNING id, expires_at AS "expiresAt"`;
    if (!opened) throw new Error('the confirmation was not stored');
    recordConfirmation('opened', {
      confirmationId: opened.id,
      grantId: input.grantId,
      tool: input.tool,
    });
    return opened;
  }

  // The tool a confirmation was opened for, to its own grant only.
  async toolOf(id: string, grantId: string): Promise<string | null> {
    const row = await this.prisma.assistantConfirmation.findFirst({
      select: { tool: true },
      where: { grantId, id },
    });
    return row?.tool ?? null;
  }

  // Locks the row, judges the answer and runs the action at most once, in
  // one transaction: a concurrent answer waits and gets the stored outcome.
  // A failing run is rolled back to its savepoint, stored as failed, and its
  // error thrown to the caller.
  async decide(
    input: Asked & { id: string },
    run: (tx: Tx) => Promise<unknown>,
  ): Promise<Decision> {
    let failure: { error: unknown } | null = null;
    let tool = '';
    const decision = await this.prisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<
          (Stored & { now: Date; tool: string })[]
        >`
          SELECT grant_id AS "grantId", args_hash AS "argsHash", tool,
                 status::text AS status, expires_at AS "expiresAt", outcome,
                 now() AS now
          FROM assistant_confirmation
          WHERE id = ${input.id}::uuid
          FOR UPDATE`;
        tool = row?.tool ?? '';
        const judged = judge(row ?? null, input, row?.now ?? new Date());
        if (judged.kind === 'answer') return judged.decision;
        if (judged.kind === 'close') {
          await this.store(tx, input.id, judged.status, null);
          return judged.decision;
        }
        await tx.$executeRawUnsafe('SAVEPOINT confirmation_run');
        try {
          const output = (await run(tx)) ?? null;
          await this.store(tx, input.id, 'done', { output });
          return { output, replayed: false, status: 'done' } as const;
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT confirmation_run');
          const code = codeOf(error);
          await this.store(tx, input.id, 'failed', { code });
          failure = { error };
          return { code, replayed: true, status: 'failed' } as const;
        }
      },
      { timeout: 30_000 },
    );
    const who = { confirmationId: input.id, grantId: input.grantId, tool };
    if (failure) {
      recordConfirmation('failed', who);
      throw (failure as { error: unknown }).error;
    }
    if (decision.status !== 'not_found')
      recordConfirmation(outcomeOf(decision), who);
    return decision;
  }

  voidForAccount(accountId: string): Promise<number> {
    return this.prisma.$transaction((tx) =>
      voidAssistantConfirmations(tx, { accountId }),
    );
  }

  private async store(
    tx: Tx,
    id: string,
    status: Exclude<Status, 'waiting'>,
    outcome: Prisma.InputJsonValue | null,
  ) {
    await tx.assistantConfirmation.update({
      data: {
        decidedAt: new Date(),
        status,
        ...(outcome !== null && { outcome }),
      },
      where: { id },
    });
  }
}

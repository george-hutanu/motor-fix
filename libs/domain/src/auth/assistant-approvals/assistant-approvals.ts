import type { Role } from '@motor-fix/contracts/capabilities';
import { Inject, Injectable } from '@nestjs/common';

import type {
  ApprovalKind,
  ApprovalOutcome,
  ApprovalStatus,
  AssistantActionApprovalDto,
  AssistantActionApprovalListDto,
} from './assistant-approvals.dto';
import { recordApproval } from './assistant-approvals.metrics';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import {
  type DomainEvent,
  EVENT_PORT,
  type EventPort,
  outbox,
} from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { PRISMA } from '../prisma';

type Tx = Prisma.TransactionClient;
type Decided = Exclude<ApprovalStatus, 'pending'>;
type ApprovalScope = { grantIds: string[] } | { accountId: string };
type ExpiryCode = 'timeout' | 'revoked' | 'switch_off';

// The person deciding, in the role in use, and the call that carried it.
export interface Decider {
  id: string;
  requestId?: string;
  role: Role;
}

// A pending approval held under its row lock, ready to be decided.
export interface LockedApproval {
  accountId: string;
  arguments: Record<string, unknown>;
  editable: string[];
  expiresAt: Date;
  grantId: string;
  id: string;
  kind: ApprovalKind;
  summary: string;
  tool: string;
}

export type Locking = LockedApproval | 'not_found' | { notPending: Decided };

interface Shown {
  arguments: unknown;
  createdAt: Date;
  decidedAt: Date | null;
  editable: string[];
  expiresAt: Date;
  grant: { clientName: string };
  id: string;
  kind: ApprovalKind;
  outcome: unknown;
  status: ApprovalStatus;
  summary: string;
  tool: string;
}

// What a count and its log line name an approval by.
const SIGNED = {
  accountId: true,
  grantId: true,
  id: true,
  kind: true,
  tool: true,
} as const;

const LIFETIME_MS = 30 * 60_000;
const DECIDED_SHOWN_MS = 24 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHOWN = {
  arguments: true,
  createdAt: true,
  decidedAt: true,
  editable: true,
  expiresAt: true,
  grant: { select: { clientName: true } },
  id: true,
  kind: true,
  outcome: true,
  status: true,
  summary: true,
  tool: true,
} as const;

// Whether an approval may still be decided at `now`: a pending one is
// overdue at its expiry itself; a decided one answers its status.
export function judgeApproval(
  row: { expiresAt: Date; status: ApprovalStatus },
  now: Date,
): 'pending' | 'expired' | { notPending: Decided } {
  if (row.status !== 'pending') return { notPending: row.status };
  return now.getTime() >= row.expiresAt.getTime() ? 'expired' : 'pending';
}

export const expiryCodeOf = (scope: ApprovalScope): ExpiryCode =>
  'grantIds' in scope ? 'revoked' : 'switch_off';

// What the person reads of an approval: never an input it did not declare
// editable.
export function approvalView(row: Shown): AssistantActionApprovalDto {
  const args = (row.arguments ?? {}) as Record<string, unknown>;
  return {
    assistantName: row.grant.clientName.trim() || null,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    id: row.id,
    kind: row.kind,
    options: row.editable.map((key) => ({ key, value: args[key] === true })),
    outcome: (row.outcome ?? null) as ApprovalOutcome,
    status: row.status,
    summary: row.summary,
    tool: row.tool,
  };
}

const decidedEvent = (
  row: { accountId: string; id: string; kind: ApprovalKind },
  status: Decided,
): DomainEvent => ({
  audience: { accountId: row.accountId, type: 'account' },
  kind: 'assistant_approval.decided',
  payload: { approvalId: row.id, kind: row.kind, status },
  subjectId: row.id,
});

// Expires every pending approval of the grants or the account inside the
// caller's transaction, for a revoke or the switch turned off; answers how
// many.
export async function expireAssistantApprovals(
  tx: Tx,
  scope: ApprovalScope,
  events: EventPort = outbox,
): Promise<number> {
  const expired = await tx.assistantApproval.updateManyAndReturn({
    data: {
      decidedAt: new Date(),
      outcome: { code: expiryCodeOf(scope) },
      status: 'expired',
    },
    select: SIGNED,
    where: {
      status: 'pending',
      ...('grantIds' in scope
        ? { grantId: { in: scope.grantIds } }
        : { accountId: scope.accountId }),
    },
  });
  for (const row of expired) {
    await events.record(tx, decidedEvent(row, 'expired'));
    recordApproval('expired', row);
  }
  return expired.length;
}

// An assistant's action the person approves in the app after the yes, kept
// in PostgreSQL: saved pending, then decided once.
@Injectable()
export class AssistantApprovals {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  // Saved in the caller's transaction, the yes's, with its event.
  async open(
    tx: Tx,
    input: {
      accountId: string;
      args: Record<string, unknown>;
      editable: readonly string[];
      grantId: string;
      kind: ApprovalKind;
      summary: string;
      tool: string;
    },
  ): Promise<{ expiresAt: Date; id: string }> {
    const now = new Date();
    const opened = await tx.assistantApproval.create({
      data: {
        accountId: input.accountId,
        arguments: input.args as Prisma.InputJsonObject,
        createdAt: now,
        editable: [...input.editable],
        expiresAt: new Date(now.getTime() + LIFETIME_MS),
        grantId: input.grantId,
        kind: input.kind,
        summary: input.summary,
        tool: input.tool,
      },
      select: { expiresAt: true, id: true },
    });
    await this.events.record(tx, {
      audience: { accountId: input.accountId, type: 'account' },
      kind: 'assistant_approval.requested',
      payload: {
        approvalId: opened.id,
        expiresAt: opened.expiresAt.toISOString(),
        kind: input.kind,
        tool: input.tool,
      },
      subjectId: opened.id,
    });
    recordApproval('requested', { ...input, id: opened.id });
    return opened;
  }

  async list(accountId: string): Promise<AssistantActionApprovalListDto> {
    const [pending, decided] = await Promise.all([
      this.prisma.assistantApproval.findMany({
        orderBy: { createdAt: 'asc' },
        select: SHOWN,
        where: { accountId, status: 'pending' },
      }),
      this.prisma.assistantApproval.findMany({
        orderBy: { decidedAt: 'desc' },
        select: SHOWN,
        where: {
          accountId,
          decidedAt: { gte: new Date(Date.now() - DECIDED_SHOWN_MS) },
          status: { not: 'pending' },
        },
      }),
    ]);
    return {
      items: [...pending, ...decided].map(approvalView),
      pending: pending.length,
    };
  }

  // One approval of the account's, in any status; null for anyone else's.
  async get(
    accountId: string,
    id: string,
  ): Promise<AssistantActionApprovalDto | null> {
    if (!UUID.test(id)) return null;
    const row = await this.prisma.assistantApproval.findFirst({
      select: SHOWN,
      where: { accountId, id },
    });
    return row ? approvalView(row) : null;
  }

  // Locks the account's approval for a decision. One past its expiry is
  // closed as expired here and answered as not pending.
  async lockForDecision(
    tx: Tx,
    accountId: string,
    id: string,
  ): Promise<Locking> {
    if (!UUID.test(id)) return 'not_found';
    const [row] = await tx.$queryRaw<
      (LockedApproval & { now: Date; status: ApprovalStatus })[]
    >`
      SELECT id, grant_id AS "grantId", account_id AS "accountId", tool,
             kind::text AS kind, summary, arguments, editable,
             status::text AS status, expires_at AS "expiresAt", now() AS now
      FROM assistant_approval
      WHERE id = ${id}::uuid AND account_id = ${accountId}::uuid
      FOR UPDATE`;
    if (!row) return 'not_found';
    const { now, status, ...locked } = row;
    const judged = judgeApproval({ expiresAt: row.expiresAt, status }, now);
    if (judged === 'pending')
      return { ...locked, editable: locked.editable ?? [] };
    if (judged === 'expired') {
      await this.close(tx, locked, 'expired', { code: 'timeout' });
      return { notPending: 'expired' };
    }
    return judged;
  }

  // Writes a pending approval's decision with its event, and the person's
  // audit entry when a person decided. A decided row is left as it is;
  // answers whether this write decided it.
  async close(
    tx: Tx,
    approval: Pick<
      LockedApproval,
      'accountId' | 'grantId' | 'id' | 'kind' | 'tool'
    >,
    status: Decided,
    outcome: ApprovalOutcome,
    by?: Decider,
  ): Promise<boolean> {
    const { count } = await tx.assistantApproval.updateMany({
      data: {
        decidedAt: new Date(),
        status,
        ...(outcome !== null && { outcome }),
      },
      where: { id: approval.id, status: 'pending' },
    });
    if (count === 0) return false;
    await this.events.record(tx, decidedEvent(approval, status));
    recordApproval(status, approval);
    if (by)
      await this.audit.record(tx, {
        action: 'update',
        actorId: by.id,
        actorRole: by.role,
        field: 'status',
        newValue: status,
        oldValue: 'pending',
        requestId: by.requestId,
        subjectId: approval.id,
        subjectType: 'assistant_approval',
      });
    return true;
  }

  // The person's no: closes the approval unrun and answers its new state.
  async refuse(
    accountId: string,
    id: string,
    actor: { id: string; role: Role },
    requestId?: string,
  ): Promise<AssistantActionApprovalDto | Exclude<Locking, LockedApproval>> {
    const refused = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForDecision(tx, accountId, id);
      if (locked === 'not_found' || 'notPending' in locked) return locked;
      await this.close(tx, locked, 'refused', null, { ...actor, requestId });
      return null;
    });
    if (refused) return refused;
    return (await this.get(accountId, id)) ?? 'not_found';
  }

  // Whose a still pending approval is and when it expires; null once
  // decided or gone.
  waiting(id: string): Promise<{ accountId: string; expiresAt: Date } | null> {
    return this.prisma.assistantApproval.findFirst({
      select: { accountId: true, expiresAt: true },
      where: { id, status: 'pending' },
    });
  }

  // The pending approvals past their expiry, for the sweep.
  async overdue(now: Date): Promise<string[]> {
    const rows = await this.prisma.assistantApproval.findMany({
      select: { id: true },
      where: { expiresAt: { lte: now }, status: 'pending' },
    });
    return rows.map((r) => r.id);
  }

  // One conditional write: only a pending approval past its expiry becomes
  // expired, so a late or repeated timer changes nothing.
  // `sweep` marks the sweep's expiry of an approval whose timer was lost.
  expireOverdue(id: string, now = new Date(), sweep = false): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.assistantApproval.updateManyAndReturn({
        data: {
          decidedAt: now,
          outcome: { code: 'timeout' },
          status: 'expired',
        },
        select: SIGNED,
        where: { expiresAt: { lte: now }, id, status: 'pending' },
      });
      if (!row) return false;
      await this.events.record(tx, decidedEvent(row, 'expired'));
      recordApproval('expired', row, sweep);
      return true;
    });
  }
}

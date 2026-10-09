import { HttpException, NotFoundException } from '@nestjs/common';

import type { AuditPort } from './audit/audit.port';
import type { Role } from './auth/capabilities';
import type { DomainEvent, EventPort } from './events/event.port';
import { Prisma } from './generated/prisma/client';

export type TransitionEntity =
  | 'quote_request'
  | 'request_recipient'
  | 'quote'
  | 'booking'
  | 'job';

// Who moved the row; a move the platform makes on its own has no account.
export interface TransitionActor {
  accountId: string | null;
  role: Role | 'system';
}

// The locked row as the database returns it (snake case), with the columns
// the movers read.
export interface LockedRow {
  status_text: string;
  car_id?: string;
  garage_id?: string;
  started_at?: Date | null;
}

// One status machine: its moves, written once, and the row it lives in.
export interface TransitionSpec<S extends string> {
  entity: TransitionEntity;
  // The SQL table; comes from the spec, never from a request.
  table: string;
  moves: Record<S, readonly S[]>;
  update(
    tx: Prisma.TransactionClient,
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface Move<S extends string> {
  id: string;
  to: S;
  actor: TransitionActor;
  event: Omit<DomainEvent, 'subjectId' | 'payload'> & {
    payload?: Record<string, unknown>;
  };
  // The columns the move sets with the status, given the locked row as read
  // from the database (snake case).
  set?: (row: LockedRow) => Record<string, unknown>;
  // The ids the audit entry is filed under, from the locked row.
  scope?: (row: LockedRow) => {
    garageId?: string;
    carId?: string;
    jobId?: string;
  };
}

export interface TransitionPorts {
  audit: AuditPort;
  events: EventPort;
}

export const invalidTransition = (refusal: {
  entity: TransitionEntity;
  currentStatus: string;
  to: string;
}) => new HttpException({ code: 'invalid_transition', ...refusal }, 409);

// Locks the row, judges the move against the table, then writes the status,
// its audit entry and its event in the caller's transaction: all or none.
// A second move waiting on the lock is judged against the first one's result.
export async function applyTransition<S extends string>(
  tx: Prisma.TransactionClient,
  spec: TransitionSpec<S>,
  ports: TransitionPorts,
  move: Move<S>,
): Promise<{ from: S; row: LockedRow }> {
  const [row] = await tx.$queryRaw<LockedRow[]>`
    SELECT *, status::text AS status_text FROM ${Prisma.raw(`"${spec.table}"`)}
    WHERE id = ${move.id}::uuid FOR UPDATE`;
  if (!row) throw new NotFoundException();
  const from = row.status_text as S;
  if (!spec.moves[from]?.includes(move.to)) {
    throw invalidTransition({
      currentStatus: from,
      entity: spec.entity,
      to: move.to,
    });
  }
  try {
    await spec.update(tx, move.id, { ...move.set?.(row), status: move.to });
  } catch (error) {
    uniqueConflict(error, spec.entity, from);
  }
  await ports.audit.record(tx, {
    action: 'update',
    actorId: move.actor.accountId,
    actorRole: move.actor.role,
    field: 'status',
    newValue: move.to,
    oldValue: from,
    subjectId: move.id,
    subjectType: spec.entity,
    ...move.scope?.(row),
  });
  await ports.events.record(tx, {
    ...move.event,
    payload: { from, to: move.to, ...move.event.payload },
    subjectId: move.id,
  });
  return { from, row };
}

// The one-of rules the database keeps, by the unique index that keeps each.
// The pg driver may name only the columns, so each also lists its table's
// key columns.
const RULES = [
  {
    entity: 'quote',
    fields: ['request_id'],
    index: 'quote_one_accepted_per_request',
    rule: 'one_accepted_quote_per_request',
  },
  {
    entity: 'booking',
    fields: ['quote_id'],
    index: 'booking_quote_id_key',
    rule: 'one_booking_per_quote',
  },
  {
    entity: 'quote',
    fields: ['request_id', 'garage_id'],
    index: 'quote_request_id_garage_id_key',
    rule: 'one_quote_per_garage',
  },
  {
    entity: 'quote',
    fields: ['recipient_id'],
    index: 'quote_recipient_id_key',
    rule: 'one_quote_per_garage',
  },
  {
    entity: 'request_recipient',
    fields: ['request_id', 'garage_id'],
    index: 'request_recipient_request_id_garage_id_key',
    rule: 'one_recipient_per_garage',
  },
  {
    entity: 'job',
    fields: ['booking_id'],
    index: 'job_booking_id_key',
    rule: 'one_job_per_booking',
  },
] as const;

const camel = (field: string) =>
  field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function ruleOf(error: Prisma.PrismaClientKnownRequestError, entity: string) {
  const said = `${error.message} ${JSON.stringify(error.meta ?? {})}`;
  const named = RULES.find((r) => said.includes(r.index));
  if (named) return named.rule;
  const target = keyColumns(error.meta);
  return RULES.find(
    (r) =>
      r.entity === entity &&
      r.fields.length === target.length &&
      r.fields.every((f) => target.includes(f) || target.includes(camel(f))),
  )?.rule;
}

// The columns a unique violation names, wherever the driver put them.
function keyColumns(meta: unknown): string[] {
  const m = (meta ?? {}) as {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
  };
  const fields = m.target ?? m.driverAdapterError?.cause?.constraint?.fields;
  return Array.isArray(fields) ? fields.map(String) : [];
}

// A write that broke one of the one-of rules becomes the 409 the caller can
// show, never a 500; any other error goes on as it was.
export function uniqueConflict(
  error: unknown,
  entity: TransitionEntity,
  currentStatus?: string,
): never {
  const rule =
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
      ? ruleOf(error, entity)
      : undefined;
  if (!rule) throw error;
  throw new HttpException(
    {
      code: 'invalid_transition',
      ...(currentStatus && { currentStatus }),
      entity,
      rule,
    },
    409,
  );
}

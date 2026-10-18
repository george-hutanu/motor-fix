import {
  SYSTEM_LOG_PAGE,
  SYSTEM_LOG_RETENTION_DAYS,
  type SystemLogDto,
  type SystemLogEntryDto,
  type SystemLogQueryDto,
} from '@motor-fix/contracts';
import { BadRequestException } from '@nestjs/common';

import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { decodeCursor, encodeCursor } from '../cursor';

const DAY = 86_400_000;

const refused = (message: string) =>
  new BadRequestException({ code: 'validation_failed', message });

// The search as literal text inside a LIKE pattern.
const contained = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

interface Row {
  id: string;
  at: Date;
  kind: SystemLogEntryDto['kind'];
  source: SystemLogEntryDto['source'];
  severity: SystemLogEntryDto['severity'];
  message: string;
  context: Record<string, unknown>;
  count: number;
}

function cursorOf(cursor: string | undefined) {
  if (cursor === undefined) return undefined;
  try {
    return decodeCursor(cursor);
  } catch {
    throw refused('cursor is not one this list gave out');
  }
}

// One array parameter cast to the column's enum, so the comparison stays on
// the enum and system_log_entry_kind_at_idx can serve it.
const anyOf = (
  column: 'kind' | 'severity' | 'source',
  values: readonly string[] | undefined,
) =>
  values?.length
    ? Prisma.sql`${Prisma.raw(column)} = ANY(${values}::${Prisma.raw(`system_log_${column}`)}[])`
    : undefined;

function where(
  query: SystemLogQueryDto,
  range: { from: Date; to?: Date },
  after?: { at: Date; id: string },
) {
  const parts = [
    Prisma.sql`at >= ${range.from}`,
    range.to && Prisma.sql`at < ${range.to}`,
    anyOf('kind', query.kind),
    anyOf('severity', query.severity),
    anyOf('source', query.source),
    query.q &&
      Prisma.sql`account_fold(message) LIKE account_fold(${contained(query.q)})`,
    after && Prisma.sql`(at, id) < (${after.at}, ${after.id}::uuid)`,
  ];
  return Prisma.join(
    parts.filter((part): part is Prisma.Sql => !!part),
    ' AND ',
  );
}

const entryOf = (row: Row): SystemLogEntryDto => ({
  at: row.at.toISOString(),
  context: row.context,
  count: row.count,
  id: row.id,
  kind: row.kind,
  message: row.message,
  severity: row.severity,
  source: row.source,
});

// Newest first, keyed on the instant and then the id, so a page never
// repeats or skips an entry even when new ones arrive between reads. The
// end is checked against the start as asked, before the start is clamped
// to the retention.
export async function listSystemLog(
  prisma: PrismaClient,
  query: SystemLogQueryDto,
  now: Date,
): Promise<SystemLogDto> {
  const asked = new Date(query.from);
  const to = query.to === undefined ? undefined : new Date(query.to);
  if (to && to <= asked) throw refused('to must be after from');
  const after = cursorOf(query.cursor);
  const oldest = new Date(now.getTime() - SYSTEM_LOG_RETENTION_DAYS * DAY);
  const from = asked < oldest ? oldest : asked;
  if (to && from >= to) return { items: [], nextCursor: null };

  const limit = query.limit ?? SYSTEM_LOG_PAGE;
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, at, kind, source, severity, message, context, count
    FROM system_log_entry
    WHERE ${where(query, { from, to }, after)}
    ORDER BY at DESC, id DESC
    LIMIT ${limit + 1}`;
  const last = rows.length > limit ? rows[limit - 1] : undefined;
  return {
    items: rows.slice(0, limit).map(entryOf),
    nextCursor: last ? encodeCursor(last.at, last.id) : null,
  };
}

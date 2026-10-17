import {
  SYSTEM_LOG_KINDS,
  SYSTEM_LOG_SOURCES,
  type SystemLogKind,
  type SystemLogSource,
} from '@motor-fix/contracts';
import { scrubDeep } from '@motor-fix/observability';
import { Logger } from '@nestjs/common';

import { type Contexts, entryOf, minuteOf } from './entry';
import { audienceOf } from '../../events/audience';
import { type LivePublisher, publishLive } from '../../events/live/live.hub';
import type { PrismaClient } from '../../generated/prisma/client';
import { countSystemLogEntry } from '../../metrics/product-counters';

export type Outcome = 'written' | 'grouped' | 'dropped';

interface Ports {
  prisma: PrismaClient;
  redis: LivePublisher;
}

const logger = new Logger('SystemLog');
const ADMINS = audienceOf({ adminOnly: true, type: 'platform' });
let ports: Ports | null = null;

const known = (kind: unknown): kind is SystemLogKind =>
  (SYSTEM_LOG_KINDS as readonly unknown[]).includes(kind);
const listed = (source: unknown): source is SystemLogSource =>
  (SYSTEM_LOG_SOURCES as readonly unknown[]).includes(source);

// One entry per kind, source, fingerprint and minute: a repeat in the same
// minute only counts one more, even when many arrive at once. The entry is
// written on the writer's own connection, so a caller rolling its work back
// keeps it, and a failure here is never the caller's.
async function store<K extends SystemLogKind>(
  { prisma, redis }: Ports,
  kind: K,
  source: SystemLogSource,
  context: Contexts[K],
  at: Date,
): Promise<Outcome> {
  const masked = scrubDeep(context);
  const entry = entryOf(kind, source, masked as Contexts[K], at);
  const [row] = await prisma.$queryRaw<{ id: string; inserted: boolean }[]>`
    INSERT INTO system_log_entry
      (id, at, minute, kind, source, severity, fingerprint, message, context)
    VALUES (
      gen_random_uuid(), ${at}, ${minuteOf(at)},
      ${kind}::system_log_kind, ${source}::system_log_source,
      ${entry.severity}::system_log_severity,
      ${entry.fingerprint}, ${entry.message}, ${JSON.stringify(masked)}::jsonb
    )
    ON CONFLICT (kind, source, fingerprint, minute)
    DO UPDATE SET count = system_log_entry.count + 1
    RETURNING id, (xmax = 0) AS inserted`;
  if (!row?.inserted) return 'grouped';
  try {
    await publishLive(
      redis,
      { at: at.toISOString(), id: row.id, kind: 'system_log.added' },
      ADMINS,
    );
  } catch {
    logger.warn(`System log entry ${row.id} written; the live nudge failed`);
  }
  return 'written';
}

// The one writer of the system status log. It runs between start and stop;
// a write outside that, or one it cannot store, is dropped with one line
// naming only its kind and source. It never rejects.
export const systemLog = {
  start(next: Ports): void {
    ports = next;
  },
  // Stopped by the one who started it, or by anyone when no owner is named.
  stop(owner?: Ports): void {
    if (!owner || ports === owner) ports = null;
  },
  async write<K extends SystemLogKind>(
    kind: K,
    source: SystemLogSource,
    context: Contexts[K],
    at: Date = new Date(),
  ): Promise<Outcome> {
    // A kind or source outside the log's lists is never stored or counted.
    if (!known(kind) || !listed(source)) return 'dropped';
    const outcome = await (ports
      ? store(ports, kind, source, context, at).catch(() => {
          logger.error(`System log entry dropped: ${kind} from ${source}`);
          return 'dropped' as const;
        })
      : Promise.resolve('dropped' as const));
    countSystemLogEntry(kind, outcome);
    return outcome;
  },
};

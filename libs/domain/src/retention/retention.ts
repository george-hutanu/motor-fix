import { anonymiseAudit } from './audit';
import { sweepLegalDocuments } from './legal-documents';
import { sweepNotifications } from './notifications';
import type { RetentionKind } from './retention.config';
import { SECRET_KINDS, sweepExpired } from './secrets';
import type { PrismaClient } from '../generated/prisma/client';
import { countRetention } from '../metrics/product-counters';
import type { StorageService } from '../storage/storage.service';

interface RetentionDeps {
  prisma: PrismaClient;
  storage: Pick<StorageService, 'deleteObject'>;
  logger: { log(line: string): void; error(line: string): void };
}

type Sweep = (deps: RetentionDeps, now: Date) => Promise<number>;

// Every kind the nightly run sweeps, in its order.
export const RETENTION_SWEEPS: readonly (readonly [RetentionKind, Sweep])[] = [
  ...SECRET_KINDS.map(
    (kind) =>
      [
        kind,
        ({ prisma }: RetentionDeps, now: Date) =>
          sweepExpired(prisma, kind, now),
      ] as const,
  ),
  ['notification', ({ prisma }, now) => sweepNotifications(prisma, now)],
  ['legal_document', (deps, now) => sweepLegalDocuments(deps, now)],
  ['audit_entry', ({ prisma }, now) => anonymiseAudit(prisma, now)],
];

const VERB: Partial<Record<RetentionKind, string>> = {
  audit_entry: 'anonymised',
};

// The error's class only: its message can carry storage keys or row values.
function errorKind(error: unknown): string {
  if (error instanceof Error) return error.name;
  return error === null ? 'null' : typeof error;
}

// Runs every sweep in turn; one that fails does not stop the others. Logs and
// counts each kind's rows (kinds and counts only), then the run's duration,
// and fails as one error after the last sweep when any failed.
export async function runRetention(
  deps: RetentionDeps,
  now: Date,
  sweeps: readonly (readonly [RetentionKind, Sweep])[] = RETENTION_SWEEPS,
): Promise<{ counts: Record<RetentionKind, number>; ms: number }> {
  const started = performance.now();
  const counts = {} as Record<RetentionKind, number>;
  const failed: RetentionKind[] = [];
  const errors: unknown[] = [];
  for (const [kind, sweep] of sweeps) {
    try {
      counts[kind] = await sweep(deps, now);
      deps.logger.log(
        `retention ${kind} ${VERB[kind] ?? 'removed'} ${counts[kind]}`,
      );
      countRetention(kind, counts[kind]);
    } catch (error) {
      failed.push(kind);
      errors.push(error);
      deps.logger.error(`retention ${kind} failed: ${errorKind(error)}`);
    }
  }
  const ms = Math.round(performance.now() - started);
  deps.logger.log(`retention run took ${ms} ms`);
  if (failed.length)
    throw new AggregateError(errors, `retention: ${failed.join(', ')} failed`);
  return { counts, ms };
}

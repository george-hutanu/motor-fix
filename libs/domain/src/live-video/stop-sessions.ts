import type { AuditPort } from '../audit/audit.port';
import { outbox } from '../events/event.port';
import { Prisma } from '../generated/prisma/client';

type Scope = { jobId: string } | { garageId: string };
type Reason = 'job_closed' | 'feature_off';

interface Stopped {
  id: string;
  job_id: string;
  garage_id: string;
  driver_id: string;
  mechanic_id: string | null;
}

// Ends every live session in scope inside the caller's transaction. Its event
// goes to the outbox even when the caller records none of its own, so a
// viewer always learns the stream is over.
export async function stopLiveSessions(
  tx: Prisma.TransactionClient,
  audit: AuditPort,
  scope: Scope,
  reason: Reason,
): Promise<number> {
  const inScope =
    'jobId' in scope
      ? Prisma.sql`s.job_id = ${scope.jobId}::uuid`
      : Prisma.sql`s.garage_id = ${scope.garageId}::uuid`;
  const rows = await tx.$queryRaw<Stopped[]>`
    UPDATE live_session s
    SET stopped_at = now(), stop_reason = ${reason}::live_stop_reason
    FROM job j
    WHERE j.id = s.job_id AND s.stopped_at IS NULL AND ${inScope}
    RETURNING s.id, s.job_id, s.garage_id, j.driver_id, j.mechanic_id`;
  for (const row of rows) {
    await audit.record(tx, {
      action: 'update',
      actorId: null,
      actorRole: 'system',
      field: 'status',
      garageId: row.garage_id,
      jobId: row.job_id,
      newValue: 'stopped',
      oldValue: 'live',
      subjectId: row.id,
      subjectType: 'live_session',
    });
    await outbox.record(tx, {
      audience: {
        driverAccountId: row.driver_id,
        garageId: row.garage_id,
        mechanicId: row.mechanic_id,
        type: 'job',
      },
      kind: 'live.stopped',
      payload: { jobId: row.job_id, liveSessionId: row.id, reason },
      subjectId: row.job_id,
    });
  }
  return rows.length;
}

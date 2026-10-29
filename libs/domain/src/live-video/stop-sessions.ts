import type { LiveStoppedPayload } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';

import type { AuditPort } from '../audit/audit.port';
import { outbox } from '../events/event.port';
import { Prisma } from '../generated/prisma/client';
import { registerLiveRecording } from '../media/media.recording';

type Scope = { jobId: string } | { garageId: string } | { sessionId: string };
type Reason = 'job_closed' | 'feature_off' | 'sender';

interface Row {
  id: string;
  job_id: string;
  garage_id: string;
  driver_id: string;
  mechanic_id: string | null;
  provider_input_id: string;
  keep_recording: boolean;
  started_at: Date;
  stopped_at: Date;
}

interface StoppedSession {
  id: string;
  providerInputId: string;
  stoppedAt: Date;
  keep: boolean;
  seconds: number;
  recordingMediaId: string | null;
}

const SECOND_MS = 1000;

function inScope(scope: Scope) {
  if ('sessionId' in scope) return Prisma.sql`s.id = ${scope.sessionId}::uuid`;
  if ('jobId' in scope) return Prisma.sql`s.job_id = ${scope.jobId}::uuid`;
  return Prisma.sql`s.garage_id = ${scope.garageId}::uuid`;
}

// Ends every live session in scope inside the caller's transaction, keeping
// or not its recording as the session says. Its event goes to the outbox
// even when the caller records none of its own, so a viewer always learns
// the stream is over. No actor means the system stopped it.
export async function stopLiveSessions(
  tx: Prisma.TransactionClient,
  audit: AuditPort,
  scope: Scope,
  reason: Reason,
  actor?: { accountId: string; role: Role },
): Promise<StoppedSession[]> {
  // Jobs before sessions, the order a job's own close takes them: a kept
  // recording's media item holds its job, so a stop that took the session
  // first could wait on a close that waits on the session.
  await tx.$queryRaw`
    SELECT j.id FROM job j JOIN live_session s ON s.job_id = j.id
    WHERE s.stopped_at IS NULL AND ${inScope(scope)}
    ORDER BY j.id FOR KEY SHARE OF j`;
  const rows = await tx.$queryRaw<Row[]>`
    UPDATE live_session s
    SET stopped_at = now(), stop_reason = ${reason}::live_stop_reason
    FROM job j
    WHERE j.id = s.job_id AND s.stopped_at IS NULL AND ${inScope(scope)}
    RETURNING s.id, s.job_id, s.garage_id, j.driver_id, j.mechanic_id,
      s.provider_input_id, s.keep_recording, s.started_at, s.stopped_at`;
  const stopped: StoppedSession[] = [];
  for (const row of rows) {
    await audit.record(tx, {
      action: 'update',
      actorId: actor?.accountId ?? null,
      actorRole: actor?.role ?? 'system',
      field: 'status',
      garageId: row.garage_id,
      jobId: row.job_id,
      newValue: 'stopped',
      oldValue: 'live',
      subjectId: row.id,
      subjectType: 'live_session',
    });
    const payload: LiveStoppedPayload = {
      jobId: row.job_id,
      keep: row.keep_recording,
      liveSessionId: row.id,
      reason,
    };
    await outbox.record(tx, {
      audience: {
        driverAccountId: row.driver_id,
        garageId: row.garage_id,
        mechanicId: row.mechanic_id,
        type: 'job',
      },
      kind: 'live.stopped',
      payload,
      subjectId: row.job_id,
    });
    const seconds = Math.max(
      0,
      Math.floor(
        (row.stopped_at.getTime() - row.started_at.getTime()) / SECOND_MS,
      ),
    );
    let recordingMediaId: string | null = null;
    if (row.keep_recording) {
      const item = await registerLiveRecording(
        tx,
        { audit, events: outbox },
        {
          garageId: row.garage_id,
          jobId: row.job_id,
          providerRef: row.provider_input_id,
          seconds,
          sentAt: row.stopped_at,
        },
      );
      recordingMediaId = item.id;
      await tx.liveSession.update({
        data: { recordingMediaId },
        where: { id: row.id },
      });
    }
    stopped.push({
      id: row.id,
      keep: row.keep_recording,
      providerInputId: row.provider_input_id,
      recordingMediaId,
      seconds,
      stoppedAt: row.stopped_at,
    });
  }
  return stopped;
}

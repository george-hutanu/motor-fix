import { recordedRole } from '../audit/audit.port';
import type { Prisma } from '../generated/prisma/client';
import type { JobStatus } from '../generated/prisma/enums';
import { stopLiveSessions } from '../live-video/stop-sessions';
import {
  applyTransition,
  type LockedRow,
  type Move,
  type TransitionPorts,
  type TransitionSpec,
} from '../transitions';

export const JOB_MOVES: Record<JobStatus, readonly JobStatus[]> = {
  // Within the no-show undo only; the caller checks.
  cancelled: ['to_do'],
  done: [],
  in_work: ['paused', 'done'],
  paused: ['in_work', 'done'],
  to_do: ['in_work', 'cancelled'],
};

const JOB: TransitionSpec<JobStatus> = {
  entity: 'job',
  moves: JOB_MOVES,
  table: 'job',
  update: (tx, id, data) =>
    tx.job.update({
      data: data as Prisma.JobUncheckedUpdateInput,
      where: { id },
    }),
};

// A resumed job keeps the time it first started. The running stretch lives in
// in_work_since: set on the way into work, folded into worked_seconds and
// cleared on the way out.
function jobColumns(to: JobStatus, row: LockedRow, at: Date) {
  const since = row.in_work_since;
  return {
    ...(to === 'in_work' && !row.started_at && { startedAt: at }),
    ...(to === 'paused' && { pausedAt: at }),
    ...(to === 'done' && { finishedAt: at }),
    ...(since && {
      workedSeconds: {
        increment: Math.max(
          0,
          Math.floor((at.getTime() - since.getTime()) / 1000),
        ),
      },
    }),
    inWorkSince: to === 'in_work' ? at : null,
  };
}

// Every move also adds a stage entry, the tracker's history, with the
// garage's own words for the driver when it gave some, the job's mechanic at
// that moment and whether the platform made the move on its own.
export async function moveJob(
  tx: Prisma.TransactionClient,
  ports: TransitionPorts,
  move: Omit<Move<JobStatus>, 'set' | 'scope'> & {
    text?: string;
    auto?: boolean;
  },
) {
  const { text, auto = false, ...rest } = move;
  // One clock, this process's, writes the entry's time and the job's clock
  // and measures from them, so a database clock running apart cannot shave
  // or add seconds.
  const at = new Date();
  const moved = await applyTransition(tx, JOB, ports, {
    ...rest,
    scope: (row) => ({
      carId: row.car_id,
      garageId: row.garage_id,
      jobId: move.id,
    }),
    set: (row) => jobColumns(move.to, row, at),
  });
  if (move.to === 'done' || move.to === 'cancelled')
    await stopLiveSessions(tx, ports.audit, { jobId: move.id }, 'job_closed');
  await tx.jobStageEntry.create({
    data: {
      actorId: move.actor.accountId,
      actorRole: recordedRole(move.actor.role),
      at,
      auto,
      fromStatus: moved.from,
      jobId: move.id,
      mechanicId: moved.row.mechanic_id ?? null,
      text,
      toStatus: move.to,
    },
  });
  return moved;
}

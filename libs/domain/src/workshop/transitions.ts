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

// A resumed job keeps the time it first started.
function jobColumns(to: JobStatus, row: LockedRow) {
  const now = new Date();
  if (to === 'in_work') return row.started_at ? {} : { startedAt: now };
  if (to === 'paused') return { pausedAt: now };
  if (to === 'done') return { finishedAt: now };
  return {};
}

// Every move also adds a stage entry, the tracker's history, with the
// garage's own words for the driver when it gave some, the job's mechanic at
// that moment and whether the platform made the move on its own. A move out
// of work adds the whole seconds since the latest move into it.
export async function moveJob(
  tx: Prisma.TransactionClient,
  ports: TransitionPorts,
  move: Omit<Move<JobStatus>, 'set' | 'scope'> & {
    text?: string;
    auto?: boolean;
  },
) {
  const { text, auto = false, ...rest } = move;
  const moved = await applyTransition(tx, JOB, ports, {
    ...rest,
    scope: (row) => ({
      carId: row.car_id,
      garageId: row.garage_id,
      jobId: move.id,
    }),
    set: (row) => jobColumns(move.to, row),
  });
  // One clock, this process's, writes every entry's time and measures from
  // it, so a database clock running apart cannot shave or add seconds.
  const at = new Date();
  if (moved.from === 'in_work') {
    const since = await tx.jobStageEntry.findFirst({
      orderBy: { at: 'desc' },
      select: { at: true },
      where: { jobId: move.id, toStatus: 'in_work' },
    });
    const seconds = since
      ? Math.max(0, Math.floor((at.getTime() - since.at.getTime()) / 1000))
      : 0;
    await tx.job.update({
      data: { workedSeconds: { increment: seconds } },
      where: { id: move.id },
    });
  }
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

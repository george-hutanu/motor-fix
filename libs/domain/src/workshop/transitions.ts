import { recordedRole } from '../audit/audit.port';
import type { Prisma } from '../generated/prisma/client';
import type { JobStatus } from '../generated/prisma/enums';
import {
  applyTransition,
  type LockedRow,
  type Move,
  type TransitionPorts,
  type TransitionSpec,
} from '../transitions';

export const JOB_MOVES: Record<JobStatus, readonly JobStatus[]> = {
  cancelled: [],
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
  if (moved.from === 'in_work') {
    await tx.$executeRaw`
      UPDATE job SET worked_seconds = worked_seconds + COALESCE((
        SELECT GREATEST(0, floor(extract(epoch FROM clock_timestamp() - max(at))))::int
        FROM job_stage_entry
        WHERE job_id = ${move.id}::uuid AND to_status = 'in_work'
      ), 0)
      WHERE id = ${move.id}::uuid`;
  }
  await tx.jobStageEntry.create({
    data: {
      actorId: move.actor.accountId,
      actorRole: recordedRole(move.actor.role),
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

import { addMonths, atLocal } from '../../bucharest';
import type { PrismaClient } from '../../generated/prisma/client';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type StageShare = Record<
  | 'admin'
  | 'auto'
  | 'driver'
  | 'mechanic'
  | 'owner'
  | 'receptionist'
  | 'system',
  number
>;

// Who moved the garage's jobs in one Bucharest month: each role's count, and
// the pauses the platform made on its own apart under `auto`, so the share
// shows how much of the job status the mechanics keep themselves.
export async function stageShare(
  db: PrismaClient,
  garageId: string,
  month: string,
): Promise<StageShare> {
  if (!MONTH.test(month)) throw new Error(`Not a YYYY-MM month: ${month}`);
  const first = `${month}-01`;
  const from = atLocal(first, 0);
  const to = atLocal(addMonths(first, 1), 0);
  const rows = await db.$queryRaw<{ bucket: string; moves: bigint }[]>`
    SELECT CASE WHEN e.auto THEN 'auto' ELSE e.actor_role::text END AS bucket,
           count(*) AS moves
      FROM job_stage_entry e
      JOIN job j ON j.id = e.job_id
     WHERE j.garage_id = ${garageId}::uuid
       AND e.at >= ${from} AND e.at < ${to}
     GROUP BY bucket`;
  const share: StageShare = {
    admin: 0,
    auto: 0,
    driver: 0,
    mechanic: 0,
    owner: 0,
    receptionist: 0,
    system: 0,
  };
  for (const { bucket, moves } of rows)
    share[bucket as keyof StageShare] = Number(moves);
  return share;
}

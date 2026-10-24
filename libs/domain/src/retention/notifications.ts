import {
  RETENTION,
  RETENTION_BATCH,
  retentionCutoff,
} from './retention.config';
import type { PrismaClient } from '../generated/prisma/client';

// Deletes every notification created before the period, a batch at a time,
// and answers how many. In the same statement each account's unread count
// drops by the unread in-app rows it lost, as the bell lowers it, so a count
// raised meanwhile by a new notification is never overwritten. A younger row
// loses only its reference to a deleted one (the foreign keys set it to NULL).
export async function sweepNotifications(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  const cutoff = retentionCutoff(now, RETENTION.notifications.days);
  let total = 0;
  for (;;) {
    const [{ deleted }] = await prisma.$queryRaw<{ deleted: number }[]>`
      WITH gone AS (
        DELETE FROM notification WHERE id IN (
          SELECT id FROM notification WHERE created_at < ${cutoff} LIMIT ${RETENTION_BATCH})
        RETURNING account_id, channel, read_at
      ),
      lowered AS (
        UPDATE account a SET unread_count = GREATEST(a.unread_count - unread.n, 0)
          FROM (SELECT account_id, count(*)::int AS n FROM gone
                 WHERE account_id IS NOT NULL AND channel = 'in_app' AND read_at IS NULL
                 GROUP BY account_id) unread
         WHERE a.id = unread.account_id
      )
      SELECT count(*)::int AS deleted FROM gone`;
    total += deleted;
    if (deleted < RETENTION_BATCH) return total;
  }
}

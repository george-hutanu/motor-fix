import {
  ANONYMISED,
  RETENTION,
  RETENTION_BATCH,
  retentionCutoff,
} from './retention.config';
import type { PrismaClient } from '../generated/prisma/client';

// Anonymises every audit entry whose owner closed before the period, a batch
// at a time, and answers how many. The owner, by precedence: the entry's
// garage (from its closure; a garage no longer there leaves the entry to its
// own time); else the account it is about (from that account's deletion);
// else its actor's account; else the entry's own time. An owner still open has
// no closure, which never compares, so its entries stay. The write is the one
// the database's trigger admits; an entry already anonymised is not taken.
export async function anonymiseAudit(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  const cutoff = retentionCutoff(now, RETENTION.auditHistory.days);
  let total = 0;
  for (;;) {
    const anonymised = await prisma.$executeRaw`
      WITH closed_account AS (
        SELECT subject_id AS account_id, min(at) AS closed_at
          FROM activity_log
         WHERE kind = 'account_deleted' AND subject_type = 'account'
         GROUP BY subject_id
        UNION ALL
        SELECT a.id, coalesce(a.last_active_at, a.created_at)
          FROM account a
         WHERE a.status = 'deleted' AND NOT EXISTS (
           SELECT FROM activity_log d
            WHERE d.kind = 'account_deleted' AND d.subject_type = 'account' AND d.subject_id = a.id)
      ),
      due AS (
        SELECT l.id FROM activity_log l
          LEFT JOIN garage g ON g.id = l.garage_id
          LEFT JOIN closed_account s ON l.subject_type = 'account' AND s.account_id = l.subject_id
          LEFT JOIN closed_account c ON c.account_id = l.actor_id
         WHERE CASE
                 WHEN l.garage_id IS NOT NULL THEN
                   CASE WHEN g.id IS NULL THEN l.at ELSE g.closed_at END
                 WHEN l.subject_type = 'account' THEN s.closed_at
                 WHEN l.actor_id IS NOT NULL THEN c.closed_at
                 ELSE l.at
               END < ${cutoff}
           AND NOT (l.actor_id IS NULL AND l.actor_name = ${ANONYMISED}
                    AND l.old_value IS NULL AND l.new_value IS NULL AND l.text IS NULL)
         LIMIT ${RETENTION_BATCH}
      )
      UPDATE activity_log SET actor_id = NULL, actor_name = ${ANONYMISED},
             old_value = NULL, new_value = NULL, text = NULL
       WHERE id IN (SELECT id FROM due)`;
    total += anonymised;
    if (anonymised < RETENTION_BATCH) return total;
  }
}

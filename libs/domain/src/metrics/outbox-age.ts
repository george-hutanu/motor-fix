import type { MonitorSession } from '@motor-fix/observability';

// Seconds since the oldest outbox event not yet relayed was written, 0 when
// none waits. One SELECT on the relayed_at index.
export async function oldestPendingSeconds(
  db: MonitorSession,
): Promise<number> {
  const [row] = await db.query<{ age: number | null }>(
    `SELECT extract(epoch FROM now() - min(created_at))::float8 AS age
    FROM outbox_event WHERE relayed_at IS NULL`,
  );
  return row?.age ?? 0;
}

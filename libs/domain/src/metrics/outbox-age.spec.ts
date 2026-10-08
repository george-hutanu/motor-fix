import type { MonitorSession } from '@motor-fix/observability';

import { oldestPendingSeconds } from './outbox-age';

const session = (
  rows: { age: number | null }[],
): MonitorSession & { sql: string[] } => {
  const sql: string[] = [];
  return {
    query: async <T>(text: string): Promise<T[]> => {
      sql.push(text);
      return rows as T[];
    },
    sql,
  };
};

// @traces 878-FR-006
// @traces 878-FR-008
describe('oldestPendingSeconds', () => {
  it('is 0 when no outbox event waits', async () => {
    expect(await oldestPendingSeconds(session([{ age: null }]))).toBe(0);
  });

  it('is 0 when the reading returns no row', async () => {
    expect(await oldestPendingSeconds(session([]))).toBe(0);
  });

  it('is the age in seconds of the oldest event not yet relayed', async () => {
    expect(await oldestPendingSeconds(session([{ age: 42.5 }]))).toBe(42.5);
  });

  it('reads with one SELECT on the events not yet relayed', async () => {
    const client = session([{ age: null }]);
    await oldestPendingSeconds(client);
    expect(client.sql).toHaveLength(1);
    expect(client.sql[0]?.trim()).toMatch(/^SELECT\b/i);
    expect(client.sql[0]).toContain('outbox_event');
    expect(client.sql[0]).toContain('relayed_at IS NULL');
  });
});

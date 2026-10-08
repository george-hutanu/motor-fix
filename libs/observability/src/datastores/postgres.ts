import { logs, SeverityNumber } from '@opentelemetry/api-logs';

import { figure } from './figure';
import { scrub } from '../scrub/scrub';

// A read-only session as the monitoring role; pg.Pool fits.
export interface MonitorSession {
  query<T>(text: string): Promise<T[]>;
}

export interface SlowRow {
  calls: number;
  max_exec_time: number;
  mean_exec_time: number;
  query: string;
  queryid: string;
}

type ConnectionState = 'active' | 'idle' | 'idle_in_transaction' | 'other';

export interface PostgresReading {
  connections: Record<ConnectionState, number>;
  connectionsMax: number;
  databaseSizeBytes: number;
  deadlocks: number;
  locksWaiting: number;
  // Left out when pg_stat_statements cannot be read.
  slowStatements?: number;
  transactions: { commit: number; rollback: number };
}

// Calls seen per statement at the previous reading.
export type SlowBaseline = Record<string, number>;

const SLOW_MS = 500;
const LOGGED_PER_READING = 10;
// Not loaded through shared_preload_libraries, or no extension at all.
const VIEW_UNREADABLE = new Set(['55000', '42P01']);

// The size comes from the catalogue, as VACUUM and ANALYZE last counted it:
// pg_database_size() reads every file and missed the 5 s limit under load.
const STATS_SQL = `SELECT d.xact_commit::float8 AS commit,
  d.xact_rollback::float8 AS rollback,
  d.deadlocks::float8 AS deadlocks,
  (SELECT sum(relpages)::float8 FROM pg_class)
    * current_setting('block_size')::float8 AS size,
  current_setting('max_connections')::int AS max,
  (SELECT count(*)::int FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE NOT l.granted AND a.datname = current_database()) AS locks
FROM pg_stat_database d WHERE d.datname = current_database()`;

const CONNECTIONS_SQL = `SELECT state, count(*)::int AS count
FROM pg_stat_activity
WHERE datname = current_database() AND backend_type = 'client backend'
GROUP BY state`;

const SLOW_SQL = `SELECT queryid::text AS queryid, query, calls::float8 AS calls,
  mean_exec_time, max_exec_time
FROM pg_stat_statements
WHERE queryid IS NOT NULL AND mean_exec_time > ${SLOW_MS}
  AND dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;

export function foldConnections(
  rows: { count: number | string; state: string | null }[],
): Record<ConnectionState, number> {
  const folded = { active: 0, idle: 0, idle_in_transaction: 0, other: 0 };
  for (const row of rows) {
    const state =
      row.state === 'active' || row.state === 'idle'
        ? row.state
        : row.state === 'idle in transaction'
          ? 'idle_in_transaction'
          : 'other';
    folded[state] += figure(row.count);
  }
  return folded;
}

// pg_stat_statements keeps one row per role (and top-level flag) for the
// same normalised statement; they are one statement here, its calls summed,
// its mean weighted by calls and its max the largest, so neither the row
// order nor a second role makes it look grown.
function byStatement(rows: SlowRow[]): SlowRow[] {
  const merged = new Map<string, SlowRow>();
  for (const row of rows) {
    const calls = Number(row.calls);
    const seen = merged.get(row.queryid);
    if (!seen) {
      merged.set(row.queryid, { ...row, calls });
      continue;
    }
    const total = seen.calls + calls;
    seen.mean_exec_time =
      total > 0
        ? (seen.mean_exec_time * seen.calls + row.mean_exec_time * calls) /
          total
        : Math.max(seen.mean_exec_time, row.mean_exec_time);
    seen.max_exec_time = Math.max(seen.max_exec_time, row.max_exec_time);
    seen.calls = total;
  }
  return [...merged.values()];
}

// Statements over the threshold whose calls grew, or that are new, since
// the previous reading. The first reading only takes the baseline.
export function slowStatements(
  read: SlowRow[],
  baseline: SlowBaseline | undefined,
) {
  const rows = byStatement(read);
  const next: SlowBaseline = {};
  for (const row of rows) next[row.queryid] = row.calls;
  if (!baseline) return { baseline: next, count: 0, grown: [] as SlowRow[] };
  const grown = rows.filter((row) => row.calls > (baseline[row.queryid] ?? 0));
  return {
    baseline: next,
    count: grown.length,
    grown: grown
      .sort((a, b) => b.mean_exec_time - a.mean_exec_time)
      .slice(0, LOGGED_PER_READING),
  };
}

// One WARN record per slow statement: the normalised text, masked, and its
// times. Statement text never carries parameter values.
export function logSlowStatements(rows: SlowRow[]): void {
  const logger = logs.getLogger('motorfix');
  for (const row of rows) {
    logger.emit({
      attributes: {
        calls: Number(row.calls),
        max_ms: row.max_exec_time,
        mean_ms: row.mean_exec_time,
        query: scrub(row.query),
      },
      body: 'slow statement',
      severityNumber: SeverityNumber.WARN,
      severityText: 'WARN',
    });
  }
}

type StatsRow = Record<
  'commit' | 'deadlocks' | 'locks' | 'max' | 'rollback' | 'size',
  number | string
>;

// Reads the statement view; an unreadable one gives its reason instead.
function readSlow(db: MonitorSession) {
  return db.query<SlowRow>(SLOW_SQL).then(
    (rows) => ({ rows }),
    (error: Error & { code?: string }) => {
      if (!VIEW_UNREADABLE.has(error.code ?? '')) throw error;
      return { viewError: error.message };
    },
  );
}

// One reading of the catalogue, SELECTs only. An unreadable statement view
// leaves the slow figure out (viewError says why); any other failure fails
// the reading.
export async function readPostgres(
  db: MonitorSession,
  baseline: SlowBaseline | undefined,
) {
  const [[stats], connections, slow] = await Promise.all([
    db.query<StatsRow>(STATS_SQL),
    db.query<{ count: number | string; state: string | null }>(CONNECTIONS_SQL),
    readSlow(db),
  ]);
  const stat = (name: keyof StatsRow) => figure(stats?.[name]);
  const statements =
    'rows' in slow ? slowStatements(slow.rows, baseline) : undefined;
  const reading: PostgresReading = {
    connections: foldConnections(connections),
    connectionsMax: stat('max'),
    databaseSizeBytes: stat('size'),
    deadlocks: stat('deadlocks'),
    locksWaiting: stat('locks'),
    transactions: { commit: stat('commit'), rollback: stat('rollback') },
    ...(statements && { slowStatements: statements.count }),
  };
  return {
    baseline: statements?.baseline ?? baseline,
    reading,
    slow: statements?.grown ?? [],
    ...('viewError' in slow && { viewError: slow.viewError }),
  };
}

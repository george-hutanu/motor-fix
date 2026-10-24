// Empties activity_log in a test database before the integration suite, so
// the rows earlier runs left behind do not pile up. The table's triggers refuse
// DELETE and TRUNCATE to every role, the superuser included, and stay as they
// are: the TRUNCATE runs as motorfix_migrator, a role made here that cannot
// sign in and may only truncate this table and switch the triggers off for its
// own transaction. No migration creates it, so a deployed database never holds
// it (OD-34), and the script refuses any database not on this machine.
//
//   node scripts/clear-activity-log.ts      (reads DATABASE_URL)
import { Client } from 'pg';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export const ENSURE_ROLE = `DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'motorfix_migrator') THEN
    CREATE ROLE motorfix_migrator NOLOGIN;
  END IF;
  GRANT TRUNCATE ON TABLE activity_log TO motorfix_migrator;
  GRANT SET ON PARAMETER session_replication_role TO motorfix_migrator;
END
$$`;

// SET LOCAL ends with the transaction, so the triggers fire again for the
// next statement on this connection.
export const CLEAR_STATEMENTS = [
  'BEGIN',
  'SET LOCAL ROLE motorfix_migrator',
  "SET LOCAL session_replication_role = 'replica'",
  'TRUNCATE TABLE activity_log',
  'COMMIT',
];

export interface Session {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
}

export function assertLoopback(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL unset');
  const parsed = new URL(url);
  if (
    !LOOPBACK.has(parsed.hostname) ||
    parsed.searchParams.has('host') ||
    parsed.searchParams.has('hostaddr')
  ) {
    throw new Error(
      `${parsed.hostname || 'an empty host'} is not a database on this machine`,
    );
  }
  return url;
}

export async function clearActivityLog(
  source: Record<string, string | undefined> = process.env,
  open: (url: string) => Session = (url) =>
    new Client({ connectionString: url }),
): Promise<string> {
  const session = open(assertLoopback(source['DATABASE_URL']));
  await session.connect();
  try {
    await session.query(ENSURE_ROLE);
    try {
      for (const sql of CLEAR_STATEMENTS) await session.query(sql);
    } catch (error) {
      await session.query('ROLLBACK');
      throw error;
    }
  } finally {
    await session.end();
  }
  return 'activity log: cleared';
}

if (process.argv[1]?.endsWith('clear-activity-log.ts')) {
  clearActivityLog().then(
    (message) => console.log(message),
    (error: Error) => {
      console.error(`activity log: ${error.message}`);
      process.exitCode = 1;
    },
  );
}

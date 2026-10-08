// The api's pre-deploy step, after the migrations: sets the password of the
// read-only motorfix_monitor role from MONITOR_DATABASE_PASSWORD, so the
// password lives in Railway's variables and never in a migration. Unset, it
// skips. The password is never printed, failure or not. pg_stat_statements
// keeps the ALTER ROLE text, readable only by superusers and pg_read_all_stats
// members, which is motorfix_monitor itself: accepted.
//
//   node scripts/monitor-password.ts
import { Client, escapeLiteral } from 'pg';

export interface Session {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
}

export async function applyMonitorPassword(
  source: Record<string, string | undefined> = process.env,
  open: (url: string) => Session = (url) =>
    new Client({ connectionString: url }),
): Promise<string> {
  const password = source['MONITOR_DATABASE_PASSWORD'];
  if (!password) {
    return 'monitor password: MONITOR_DATABASE_PASSWORD unset, skipped';
  }
  const url = source['DATABASE_URL'];
  if (!url) throw new Error('monitor password: DATABASE_URL unset');
  const session = open(url);
  await session.connect();
  try {
    await session.query(
      `ALTER ROLE motorfix_monitor PASSWORD ${escapeLiteral(password)}`,
    );
  } finally {
    await session.end();
  }
  return 'monitor password: applied';
}

if (process.argv[1]?.endsWith('monitor-password.ts')) {
  applyMonitorPassword().then(
    (message) => console.log(message),
    (error: Error) => {
      console.error(`monitor password: ${error.message}`);
      process.exitCode = 1;
    },
  );
}

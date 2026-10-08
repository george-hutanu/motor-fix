// The api's pre-deploy step, after the migrations: sets the password of the
// read-only motorfix_monitor role from MONITOR_DATABASE_PASSWORD, so the
// password lives in Railway's variables and never in a migration. Unset, it
// skips. The password is never printed, failure or not, and never sent:
// pg_stat_statements keeps the ALTER ROLE text, which motorfix_monitor reads
// and the slow-statement log can export, so the statement carries only the
// SCRAM-SHA-256 verifier computed here, which PostgreSQL stores as it is.
//
//   node scripts/monitor-password.ts
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

import { Client, escapeLiteral } from 'pg';

const SCRAM_ITERATIONS = 4096;

// RFC 5802 / 7677, PostgreSQL's stored form. node-pg signs in with the
// password's raw UTF-8 bytes, so they are used here the same way.
export function scramVerifier(
  password: string,
  salt: Buffer = randomBytes(16),
): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const hmac = (text: string) =>
    createHmac('sha256', salted).update(text).digest();
  const stored = createHash('sha256').update(hmac('Client Key')).digest();
  const b64 = (bytes: Buffer) => bytes.toString('base64');
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${b64(salt)}$${b64(stored)}:${b64(hmac('Server Key'))}`;
}

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
      `ALTER ROLE motorfix_monitor PASSWORD ${escapeLiteral(scramVerifier(password))}`,
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

// @traces 456-FR-001 456-FR-003 456-FR-005
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertLoopback,
  CLEAR_STATEMENTS,
  clearActivityLog,
  ENSURE_ROLE,
  type Session,
} from './clear-activity-log.ts';

function fakeSession(failOn?: string) {
  const calls: string[] = [];
  const session: Session = {
    connect: async () => {
      calls.push('connect');
    },
    end: async () => {
      calls.push('end');
    },
    query: async (sql: string) => {
      calls.push(sql);
      if (sql === failOn) throw new Error(`refused: ${sql}`);
      return {};
    },
  };
  return { calls, session };
}

const local = {
  DATABASE_URL: 'postgresql://motorfix:motorfix@127.0.0.1:55432/motorfix',
};

describe('clearActivityLog', () => {
  it('makes the cleaning role, then empties the table in one transaction', async () => {
    const { calls, session } = fakeSession();

    await clearActivityLog(local, () => session);

    expect(calls).toEqual(['connect', ENSURE_ROLE, ...CLEAR_STATEMENTS, 'end']);
  });

  it('runs the TRUNCATE as the cleaning role with the triggers off for that transaction only', () => {
    expect(CLEAR_STATEMENTS).toEqual([
      'BEGIN',
      'SET LOCAL ROLE motorfix_migrator',
      "SET LOCAL session_replication_role = 'replica'",
      'TRUNCATE TABLE activity_log',
      'COMMIT',
    ]);
  });

  it('makes a role that cannot sign in and holds only the two rights it needs', () => {
    expect(ENSURE_ROLE).toContain('CREATE ROLE motorfix_migrator NOLOGIN');
    expect(ENSURE_ROLE).toContain('IF NOT EXISTS');
    expect(ENSURE_ROLE).toContain(
      'GRANT TRUNCATE ON TABLE activity_log TO motorfix_migrator',
    );
    expect(ENSURE_ROLE).toContain(
      'GRANT SET ON PARAMETER session_replication_role TO motorfix_migrator',
    );
    expect(ENSURE_ROLE).not.toMatch(/PASSWORD|SUPERUSER|DELETE|UPDATE/);
  });
});

describe('assertLoopback', () => {
  it.each([
    'postgresql://motorfix:motorfix@localhost:5432/motorfix',
    'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
    'postgresql://postgres:postgres@[::1]:5432/postgres',
  ])('accepts a database on this machine: %s', (url) => {
    expect(assertLoopback(url)).toBe(url);
  });

  it.each([
    ['a remote host', 'postgresql://app:pw@db.example.com:5432/motorfix'],
    ['an empty host', 'postgresql:///motorfix'],
    [
      'a host parameter',
      'postgresql://u:p@localhost/motorfix?host=db.example.com',
    ],
    [
      'a hostaddr parameter',
      'postgresql://u:p@localhost/motorfix?hostaddr=10.0.0.5',
    ],
  ])('refuses %s', (_, url) => {
    expect(() => assertLoopback(url)).toThrow(/not a database on this machine/);
  });

  it('refuses a value that is not a URL', () => {
    expect(() => assertLoopback('not a url')).toThrow(/Invalid URL/);
  });

  it('refuses an unset DATABASE_URL', () => {
    expect(() => assertLoopback(undefined)).toThrow(/DATABASE_URL unset/);
  });
});

describe('node scripts/clear-activity-log.ts', () => {
  it('exits 1 with the reason when the database is not on this machine', () => {
    const run = spawnSync(
      process.execPath,
      [join(__dirname, 'clear-activity-log.ts')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://app:pw@db.example.com/motorfix',
        },
      },
    );

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      'activity log: db.example.com is not a database on this machine',
    );
  });
});

// A deployed database never holds a role that may empty the audit history:
// only this script makes it, never a migration.
describe('the cleaning role in deployed databases', () => {
  it('is created by no migration', () => {
    const migrations = join(__dirname, '..', 'libs/domain/prisma/migrations');
    const creating = readdirSync(migrations, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) =>
        readFileSync(
          join(migrations, entry.name, 'migration.sql'),
          'utf8',
        ).includes('motorfix_migrator'),
      );

    expect(creating).toEqual([]);
  });
});

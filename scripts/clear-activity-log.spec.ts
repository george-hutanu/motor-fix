// @traces 456-FR-001 456-FR-003
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

  it('rolls back, closes the connection and passes the database error on', async () => {
    const { calls, session } = fakeSession('TRUNCATE TABLE activity_log');

    await expect(clearActivityLog(local, () => session)).rejects.toThrow(
      'refused: TRUNCATE TABLE activity_log',
    );
    expect(calls.slice(-2)).toEqual(['ROLLBACK', 'end']);
    expect(calls).not.toContain('COMMIT');
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

  it('refuses an unset DATABASE_URL', () => {
    expect(() => assertLoopback(undefined)).toThrow(/DATABASE_URL unset/);
  });

  it('never opens a connection to a remote database', async () => {
    const open = jest.fn();

    await expect(
      clearActivityLog(
        { DATABASE_URL: 'postgresql://app:pw@db.example.com/motorfix' },
        open,
      ),
    ).rejects.toThrow(/not a database on this machine/);
    expect(open).not.toHaveBeenCalled();
  });
});

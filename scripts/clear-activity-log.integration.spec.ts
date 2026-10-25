// @traces 456-FR-002 456-FR-004
import { randomBytes, randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { CLEAR_STATEMENTS, ENSURE_ROLE } from './clear-activity-log.ts';

// Every case runs in a transaction it rolls back, so the parallel specs that
// write and read activity_log keep their rows.
const db = new Client({ connectionString: process.env['DATABASE_URL'] });
const plainRole = `mf_spec_${randomBytes(6).toString('hex')}`;

const refusal = /activity_log is append-only/;

async function inTransaction(body: () => Promise<unknown>) {
  await db.query('BEGIN');
  try {
    return await body();
  } finally {
    await db.query('ROLLBACK');
  }
}

async function addEntry() {
  const subjectId = randomUUID();
  await db.query(
    `INSERT INTO activity_log (id, action, actor_name, actor_role, subject_id, subject_type)
     VALUES (gen_random_uuid(), 'create', 'Ion', 'system', $1, 'garage')`,
    [subjectId],
  );
  return subjectId;
}

const count = async () =>
  Number((await db.query('SELECT count(*) FROM activity_log')).rows[0].count);

beforeAll(async () => {
  await db.connect();
  await db.query(ENSURE_ROLE);
  await db.query(`CREATE ROLE ${plainRole} NOLOGIN`);
  await db.query(
    `GRANT SELECT, INSERT, DELETE, TRUNCATE ON TABLE activity_log TO ${plainRole}`,
  );
});

afterAll(async () => {
  await db.query(`REVOKE ALL ON TABLE activity_log FROM ${plainRole}`);
  await db.query(`DROP ROLE ${plainRole}`);
  await db.end();
});

describe("the application's role", () => {
  it('is refused a delete', async () => {
    await expect(
      inTransaction(async () => {
        const subjectId = await addEntry();
        await db.query('DELETE FROM activity_log WHERE subject_id = $1', [
          subjectId,
        ]);
      }),
    ).rejects.toThrow(refusal);
  });

  it('is refused a truncate', async () => {
    await expect(
      inTransaction(() => db.query('TRUNCATE TABLE activity_log')),
    ).rejects.toThrow(refusal);
  });
});

describe('a role that is not superuser and holds DELETE and TRUNCATE', () => {
  // The row is written first, so the row-level delete trigger has a row.
  const asPlainRole = (sql: string) =>
    inTransaction(async () => {
      await addEntry();
      await db.query(`SET LOCAL ROLE ${plainRole}`);
      await db.query(sql);
    });

  it('is refused a delete and a truncate by the trigger', async () => {
    await expect(asPlainRole('DELETE FROM activity_log')).rejects.toThrow(
      refusal,
    );
    await expect(asPlainRole('TRUNCATE TABLE activity_log')).rejects.toThrow(
      refusal,
    );
  });

  // SET ROLE is checked against the session's user, so the session becomes
  // the plain role first: from there the cleaning role is out of reach.
  it('cannot become the cleaning role', async () => {
    await expect(
      inTransaction(async () => {
        await db.query(`SET LOCAL SESSION AUTHORIZATION ${plainRole}`);
        await db.query('SET LOCAL ROLE motorfix_migrator');
      }),
    ).rejects.toThrow(/permission denied to set role "motorfix_migrator"/);
  });

  it('cannot switch the triggers off', async () => {
    await expect(
      asPlainRole("SET LOCAL session_replication_role = 'replica'"),
    ).rejects.toThrow(
      /permission denied to set parameter "session_replication_role"/,
    );
  });
});

describe('the cleaning role', () => {
  it('empties the table, takes new entries, and the trigger refuses the next delete again', async () => {
    const left = await inTransaction(async () => {
      await addEntry();
      for (const sql of CLEAR_STATEMENTS.slice(1, -1)) await db.query(sql);
      await db.query('RESET ROLE');
      const afterClear = await count();
      await addEntry();
      return [afterClear, await count()];
    });

    expect(left).toEqual([0, 1]);
    await expect(
      inTransaction(async () => {
        const subjectId = await addEntry();
        await db.query('DELETE FROM activity_log WHERE subject_id = $1', [
          subjectId,
        ]);
      }),
    ).rejects.toThrow(refusal);
  });

  it('cannot sign in', async () => {
    const { rows } = await db.query(
      "SELECT rolcanlogin, rolsuper FROM pg_roles WHERE rolname = 'motorfix_migrator'",
    );

    expect(rows).toEqual([{ rolcanlogin: false, rolsuper: false }]);
  });
});

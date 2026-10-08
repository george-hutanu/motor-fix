import { Pool } from 'pg';

import { serialDatabase } from './serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
serialDatabase(databaseUrl);

// A spec's own teardown (closing its app, queues and workers)
// can still write, so the turn must outlast every afterAll the spec declares
// after taking it. Jest runs afterAll hooks in the order they were declared.
afterAll(async () => {
  const other = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const { rows } = await other.query<{ got: boolean }>(
      'SELECT pg_try_advisory_lock(79079) AS got',
    );
    if (rows[0]?.got) await other.query('SELECT pg_advisory_unlock(79079)');
    expect(rows[0]?.got).toBe(false);
  } finally {
    await other.end();
  }
});

it('holds the database turn while the spec runs', async () => {
  const other = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const { rows } = await other.query<{ got: boolean }>(
      'SELECT pg_try_advisory_lock(79079) AS got',
    );
    if (rows[0]?.got) await other.query('SELECT pg_advisory_unlock(79079)');
    expect(rows[0]?.got).toBe(false);
  } finally {
    await other.end();
  }
});

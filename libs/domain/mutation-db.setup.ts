import pg from 'pg';

// A mutation worker's database is a copy of the migrated one the workflow
// prepared (TEMPLATE copies its schema and migration history). The copy is
// made from template1, as no session may sit on the database being copied.
export default async function setup(): Promise<void> {
  const worker = process.env['STRYKER_MUTATOR_WORKER'];
  const template = process.env['MUTATION_TEMPLATE_URL'];
  if (worker === undefined || !template) return;
  const source = new URL(template);
  const from = decodeURIComponent(source.pathname.slice(1));
  const name = `postgres_w${Number(worker)}`;
  source.pathname = '/template1';
  source.search = '';
  const client = new pg.Client({ connectionString: source.toString() });
  await client.connect();
  try {
    const found = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (found.rowCount === 0)
      await client.query(
        `CREATE DATABASE ${client.escapeIdentifier(name)} TEMPLATE ${client.escapeIdentifier(from)}`,
      );
  } finally {
    await client.end();
  }
}
